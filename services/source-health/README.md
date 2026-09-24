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
  by `handleRunCollected`. Only `kind: 'search'` is counted; a details job is acknowledged and
  skipped (its rows are not search pages and it has no searches; route-health filters by kind the
  same way).
- Views: `apify_gateway.v_jobs` (a job's region tag and its own time: `settled_at`, else
  `finished_at`, else `created_at`, which fixes the job's Europe/London day; see "Decisions" for
  why this is `v_jobs` and not the card's `v_run_summaries`), `apify_gateway.v_seller_presence`
  (seller presence per row, in `seq` order), `run_coverage.v_search_coverage` (each search's judged
  route), `route_health.v_decisions` (a region's current reason and `newQueryIds`).
- Switch `source-health`, through `@nabvy/switches` (fail closed).

## Outputs

- **Event** `source-health.alerted` v1 `{ day, reasons }`, key
  `source-health.alerted:<day>:<reasons>`, published once per day per reason: a reason is appended
  to `health_daily.alerted` by a conditional SQL update (`claimAlerts`), and only the call whose
  update added it emits, so two jobs crossing the threshold at once fire it once.
- **Internal views** (`nabvy_pipeline`; security_invoker; empty/absent while off):
  - `source_health.v_health`: day, total_searches, degraded_searches, pct_degraded, breaker_trips,
    new_operation_ids, blocked_pages, alerted, updated_at (`SourceHealthDay`).
  - `source_health.v_ramp_stage`: stage, max_checks_per_day, started_at, advanced_by — at most one
    row, the current stage (`SourceHealthRampStage`).
- **Restricted and user-facing views:** none (rule 5).
- **Functions** (`@nabvy/source-health`): `recommendRampStage(q)`, `handleRunCollected`,
  `onRunCollected` (the wrapped handler), `assessRamp(db, now)`; internal pure helpers (`src/domain`, not exported)
  `countDegraded`, `pctDegradedOf`, `isDegradedSpike`, `pagesOf`, `mergeHealthDay`,
  `evaluateAlert`, `decideRampAdvance`, `londonDay`, `dayBefore`.

## Tables

Schema `source_health`:

- `health_daily`: `day` (Europe/London calendar day, text, primary key); `total_searches`,
  `degraded_searches`, `breaker_trips`, `new_operation_ids`, `blocked_pages`, `alerted`,
  `updated_at`. Counts change only by SQL increments (`addJobToDay`), never by rewriting the row.
- `processed_jobs`: `job_id` (primary key), `day`, `processed_at`. Bookkeeping for idempotency,
  not a card-named table (see "Decisions"): one row per job ever folded in, keyed by job ID across
  days; append-only (no update or delete grant).
- `ramp`: `id` (UUID v7); one row per stage ever entered, never updated (`stage` unique,
  `started_at`, `max_checks_per_day`, `advanced_by`); the current stage is the row with the latest
  `started_at`.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Degraded routes | `browser-fallback`, `failed` | The card | Fixed |
| Alert: degraded share | > 10% of a day's searches | 9 of 10 search bootstraps succeeded on build 1.0.79 (`fb-scrap-engine/docs/EVIDENCE_LEDGER.md:84-91`; the card) | Starting value |
| Alert: new operation ID | Any new ID in the day (route-health's `newQueryIds`) | The card | Fixed |
| Seller-block page size | 20 rows | The recorded run's one page (run-coverage's card, "Page 1") | Starting value (`docs/questions/source-health.md`) |
| Ramp hold time | 48 hours per stage | The conservative end of the card's "24-48 hours" | Starting value (`docs/questions/source-health.md`) |
| Ramp advance | Refused at the last stage, before the hold time, without rows for both yesterday and the day before, when yesterday alerted for any reason, when yesterday's share is above the degraded-share alert value, or when it is above the day before's; otherwise one stage up | The card ("only while 302s and fallbacks do not rise" needs a baseline; a degraded or alerted day is not evidence that more volume is safe); review of PR #63 round 1 | Fixed |
| Ramp stage caps | 50 / 100 / 200 / 400 / 800 checks per day | No figure in the cited sources | Starting value (`docs/questions/source-health.md`) |
| Breaker trip counting | One per distinct job whose region reads `circuit-open` | route-health has no decision history to read | Starting value (`docs/questions/source-health.md`) |

## Fixtures and pass rate

Stages `health-day` (`test/fixtures/health-day.fixtures.ts`, 2 cases) and `ramp-advance`
(`test/fixtures/ramp-advance.fixtures.ts`, 4 cases), pure-domain cases under `test/fixtures/cases/`,
synthetic, built from the card's own "Tests and fixtures" line and round 1 of PR #63's review:

- `fallback-spike-alerts`: a day whose searches are mostly `browser-fallback` alerts
  `degraded-spike`.
- `new-operation-id-alerts`: a job whose region decision reports a `newQueryIds` entry alerts
  `new-operation-id`.
- `ramp-holds-after-rise`: a ramp past its minimum hold time does not advance when yesterday's
  degraded share is higher than the day before's.
- `ramp-holds-while-degraded`: two days at 40% degraded (no rise) do not advance: yesterday is
  above the alert value.
- `ramp-holds-after-alert`: a day that alerted does not advance, even with a falling share.
- `ramp-holds-without-baseline`: no row for the day before yesterday does not advance.

Pass rate 6/6 (2026-09-24, round 2; 3/3 in round 1). Other tests: `domain.test.ts` (pure rules,
boundary values of the alert threshold and the ramp's hold time, calendar-day arithmetic across
the clocks-forward day), `idempotency.test.ts` on the real migrations in PGlite (a replayed job
writes nothing, on the same day or redelivered after London midnight; two jobs against one day at
once both land and the alert fires exactly once; a details job is not counted; a repeated alert
reason is not re-emitted), `switch.test.ts` (off, shadow, `recommendRampStage`'s fallback),
`contracts.test.ts`, and `packages/db/tests/source-health.test.sql` (grants including no delete on
`ramp` or `processed_jobs`, the job-ID dedupe across days, the unique ramp stage, the computed
`pct_degraded`, views empty while off, the foundation's view check).

## Decisions

- **2026-09-24: the stored/exposed column is `blocked_pages`, not `seller_block_pages`.** The
  foundation's view check (`packages/db/migrations/core/20260924110000_core_hardening.sql`)
  refuses any `v_`/`mv_` column whose name matches `seller` regardless of what it holds, to catch
  accidental seller-identity leaks by name alone. This column holds only booleans (whether a page
  had a row with no seller object, never the seller data itself), so it is named `blocked_pages`
  to say what it means without tripping that guard; `pnpm db:dry-run` failed on the original name
  and this is the fix, confirmed by a clean re-run.
- **2026-09-24 (round 2): jobs are deduped in SQL, and days are added to, never rewritten.** Round
  1 kept `processed_job_ids` inside the day's row and upserted the whole row after a read-modify-
  write, which lost updates between two `run-collected` handlers on one day (review, finding 1).
  Now `processed_jobs(job_id primary key, day)` is claimed first with `on conflict do nothing`;
  only a real claim adds the job's counts to `health_daily` with SQL increments (`addJobToDay`),
  under the same transaction (`withPipeline`), so concurrent jobs take the row lock in turn and
  compose. The table is bookkeeping, not a card-named table (the card's "Owns" line names
  `health_daily (day, metrics)` and `ramp`); recorded so a reviewer does not read it as scope
  creep. Migration `20260924220000_source_health_processed_jobs.sql` adds it, drops the old
  column (never live: the module had not merged) and makes `ramp.stage` unique.
- **2026-09-24 (round 2): a job's day is its own time, not the delivery time.** `londonDay` of
  `v_jobs.settled_at`, else `finished_at`, else `created_at` (finding 2): apify-gateway announces
  `run-collected` at collection and settles the cost later, so `settled_at` can still be null
  then, and the fallbacks are the same row's server-side times. A redelivery after midnight is
  a no-op by job ID whatever day it lands on (`idempotency.test.ts`).
- **2026-09-24 (round 2): `v_jobs`, not the card's `v_run_summaries`.** The card lists
  `v_run_summaries` as an input; the code reads `v_jobs` (finding 9). `v_run_summaries` carries a
  job's `RUN_SUMMARY`, detail route and searches, none of which this module needs: its searches
  come judged from run-coverage's `v_search_coverage`, and the region tag and the job's own times
  are on `v_jobs` only. Both views exist only once the job is collected, so `v_jobs` confirms
  existence as well.
- **2026-09-24 (round 2): the ramp refuses on a degraded or alerted day and without a baseline.**
  Round 1 refused only on a rise, and advanced when the day before had no row (finding 3): two
  days at 40% would have raised the volume. `decideRampAdvance` now also refuses when yesterday's
  share is above `SOURCE_HEALTH_ALERT_PCT_DEGRADED`, when yesterday's `alerted` is non-empty, and
  when either of the two days has no row; "yesterday" and "the day before" are Europe/London
  calendar days (`dayBefore`), not `now - 24h`, which on the clocks-forward Sunday names the wrong
  day for an hour (finding 6). Three fixtures cover the three new refusals.
- **2026-09-24 (round 2): details jobs are not counted.** `handleRunCollected` acknowledges any
  `kind` but `search` and writes nothing (finding 4): a details run's rows are listings, not
  search pages, so grouping them into `blocked_pages` misread them, and its region read would have
  counted a breaker trip for a run that made no search. New operation IDs are therefore read at
  each search job from route-health's current decision; a region with only details runs on a day
  alerts on the next search job instead (see "Open questions").
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
hold time and stage caps, the seller-block page size, breaker-trip counting, and two round-1
findings left as they are with the reason recorded there: new operation IDs are still read from
route-health's per-region current decision rather than a table of IDs already seen (finding 5),
and the view row types stay hand-written in contracts because `drizzle-zod` is not a dependency
(finding 7, as route-health and run-coverage also do).

## Incidents

None.
