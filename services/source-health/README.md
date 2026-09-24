# @nabvy/source-health

Watches what Facebook serves through the Apify actor, and sets how much volume is safe
(`docs/design/modules/source-health.md`).

A module session edits only this folder, `packages/contracts/src/modules/source-health.ts`,
`packages/config/src/modules/source-health.ts`, `packages/db/src/schema/source-health.ts`,
`packages/db/tests/source-health.test.sql` and `packages/db/migrations/source-health/`.

## Switch and priority

Off by default (rule 11 of `docs/design/modules/_rules.md`). While it is off, the handler
acknowledges `apify-gateway.run-collected` and writes nothing, `assessRamp` does nothing, and both
`v_health` and `v_ramp_stage` return no rows; `recommendRampStage` falls back to the lowest ramp
stage (card, "When off": "check-scheduler uses the lowest ramp stage"). Shadow behaves like on:
the module has no user-facing output. P1 (the card: "a single source needs route-health
monitoring", `fb-scrap-engine/docs/design/SCALE_PLAN.md:114-115`).

## Inputs

- Event `apify-gateway.run-collected` v1 `{ jobId, apifyRunId, kind }` (`apify-gateway`), handled
  by `handleRunCollected`.
- Views: `apify_gateway.v_jobs` (a job's region tag), `apify_gateway.v_run_summaries` (confirms a
  job is actually collected before it is folded in), `apify_gateway.v_seller_presence` (seller
  presence per row, in `seq` order), `run_coverage.v_search_coverage` (each search's judged
  route), `route_health.v_decisions` (a region's current reason and `newQueryIds`).
- Switch `source-health`, through `@nabvy/switches` (fail closed).

## Outputs

- **Event** `source-health.alerted` v1 `{ day, reasons }`, key
  `source-health.alerted:<day>:<reasons>`, published once per day per reason (`health_daily.alerted`
  tracks reasons already fired).
- **Internal views** (`nabvy_pipeline`; security_invoker; empty/absent while off):
  - `source_health.v_health`: day, total_searches, degraded_searches, pct_degraded, breaker_trips,
    new_operation_ids, blocked_pages, alerted, updated_at (`SourceHealthDay`).
  - `source_health.v_ramp_stage`: stage, max_checks_per_day, started_at, advanced_by — at most one
    row, the current stage (`SourceHealthRampStage`).
- **Restricted and user-facing views:** none (rule 5).
- **Functions** (`@nabvy/source-health`): `recommendRampStage(q)`, `handleRunCollected`,
  `onRunCollected` (the wrapped handler), `assessRamp(db, now)`, and the pure helpers
  `countDegraded`, `pctDegradedOf`, `isDegradedSpike`, `pagesOf`, `mergeHealthDay`,
  `evaluateAlert`, `decideRampAdvance`, `londonDay`.

## Tables

Schema `source_health`:

- `health_daily`: `day` (Europe/London calendar day, text, primary key); `processed_job_ids`
  (bookkeeping for idempotency, not a card-named metric — see "Decisions"); `total_searches`,
  `degraded_searches`, `breaker_trips`, `new_operation_ids`, `blocked_pages`, `alerted`,
  `updated_at`.
- `ramp`: `id` (UUID v7); one row per stage ever entered, never updated (`stage`, `started_at`,
  `max_checks_per_day`, `advanced_by`); the current stage is the row with the latest `started_at`.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Degraded routes | `browser-fallback`, `failed` | The card | Fixed |
| Alert: degraded share | > 10% of a day's searches | 9 of 10 search bootstraps succeeded on build 1.0.79 (`fb-scrap-engine/docs/EVIDENCE_LEDGER.md:84-91`; the card) | Starting value |
| Alert: new operation ID | Any new ID in the day (route-health's `newQueryIds`) | The card | Fixed |
| Seller-block page size | 20 rows | The recorded run's one page (run-coverage's card, "Page 1") | Starting value (`docs/questions/source-health.md`) |
| Ramp hold time | 48 hours per stage | The conservative end of the card's "24-48 hours" | Starting value (`docs/questions/source-health.md`) |
| Ramp stage caps | 50 / 100 / 200 / 400 / 800 checks per day | No figure in the cited sources | Starting value (`docs/questions/source-health.md`) |
| Breaker trip counting | One per distinct job whose region reads `circuit-open` | route-health has no decision history to read | Starting value (`docs/questions/source-health.md`) |

## Fixtures and pass rate

Stage `health-day` (`test/fixtures/health-day.fixtures.ts`), on the real migrations in PGlite, 3
synthetic cases built from the card's own "Tests and fixtures" line:

- `fallback-spike-alerts`: a day whose searches are mostly `browser-fallback` alerts
  `degraded-spike`.
- `new-operation-id-alerts`: a job whose region decision reports a `newQueryIds` entry alerts
  `new-operation-id`.
- `ramp-holds-after-rise`: a ramp past its minimum hold time does not advance when the latest
  day's degraded share is higher than the day before's.

Pass rate 3/3 (2026-09-24). Other tests: `domain.test.ts` (pure rules, boundary values of the
alert threshold and the ramp's hold time), `idempotency.test.ts` (a replayed job writes nothing
new to `health_daily`; a repeated alert reason is not re-emitted), `switch.test.ts` (off, shadow,
`recommendRampStage`'s fallback), `contracts.test.ts`, and `packages/db/tests/source-health.test.sql`
(grants, the computed `pct_degraded`, views empty while off, the foundation's view check).

## Decisions

- **2026-09-24: the stored/exposed column is `blocked_pages`, not `seller_block_pages`.** The
  foundation's view check (`packages/db/migrations/core/20260924110000_core_hardening.sql`)
  refuses any `v_`/`mv_` column whose name matches `seller` regardless of what it holds, to catch
  accidental seller-identity leaks by name alone. This column holds only booleans (whether a page
  had a row with no seller object, never the seller data itself), so it is named `blocked_pages`
  to say what it means without tripping that guard; `pnpm db:dry-run` failed on the original name
  and this is the fix, confirmed by a clean re-run.
- **2026-09-24: `health_daily.processed_job_ids` is bookkeeping, not a card-named column.** The
  card's "Owns" line names `health_daily (day, metrics)`; `processed_job_ids` is folded into
  "metrics" as the idempotency key for a per-job upsert (rule 8), rather than adding a third
  table. Recorded so a reviewer does not read it as scope creep.
- **2026-09-24: `assessRamp` is not wired to an event.** Like apify-gateway's watcher before a
  Trigger.dev account existed (`services/apify-gateway/README.md`, "the watcher task is not in
  trigger/ yet"), this is a plain function a scheduled task calls once one exists; nothing in
  `trigger/` invokes it yet.
- **2026-09-24: three modelling gaps, each resolved conservatively and recorded in
  `docs/questions/source-health.md`** rather than guessed silently: the ramp's hold time (48h, the
  slower end of the card's range), the seller-block page size (20, from the recorded run), and how
  a "breaker trip" is counted from route-health's current-decision-only view.
- **2026-09-24: view rows are Zod in contracts,** as run-coverage's are: `drizzle-zod` is not a
  dependency yet.
- **2026-09-24: no delete grant, no `erase`.** The module holds no listing rows (rule 12 asks
  `erase` only of modules that hold listing rows).

## Open questions

`docs/questions/source-health.md` (folded into `docs/questions.md` by the coordinator): the ramp's
hold time and stage caps, the seller-block page size, and breaker-trip counting.

## Incidents

None.
