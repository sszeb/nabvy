# @nabvy/spend-governor

Keeps every paid call inside the owner's budgets: it sums settled and reserved costs per budget,
forecasts the month, and publishes a throttle level that paying modules obey before they spend
(`docs/design/modules/spend-governor.md`).

A module session edits only this folder, `packages/contracts/src/modules/spend-governor.ts`,
`packages/config/src/modules/spend-governor.ts`, `packages/db/src/schema/spend-governor.ts`,
`packages/db/migrations/spend-governor/`, `packages/db/tests/spend-governor.test.sql` and
`fixtures/contracts/spend-governor/`.

## Switch and priority

Off by default (rule 11). The governor **fails closed**: while `spend-governor` or `cost-meter` is
off, `spend_governor.v_throttle` reads `hold-new` for every budget and `readThrottle` returns
`hold-new`, so paid work holds; `recompute` writes nothing and returns `spend-governor.off`;
`v_budgets` returns no rows. A budget never computed, or whose last recompute is older than its
validity window (an hour), also reads `hold-new`. Users lose new searches while it holds; queued
work is never dropped. Shadow behaves like on: the governor has no user-facing output. The
gateway's hard cap (`apify_gateway.spend`, $150 a month) applies regardless.

P1 (the card; `docs/architecture.md:99`).

## Inputs

- `cost_meter.v_costs` (cost-meter): every metered call, amounts in integer micros.
- `apify_gateway.v_jobs` (apify-gateway): the provisional cost of unsettled runs, runs queued or
  started but not yet metered, and the month's settled runs (for proxy GB).
- `switches.state()` / `@nabvy/switches` `state()`: `spend-governor` and `cost-meter`.
- Event `apify-gateway.run-settled` (handler `onRunSettled`, one recompute per batch). A scheduled
  recompute task (`trigger/spend-governor-recompute.ts`, backlog 1.2m) calls `recompute` directly
  every 15 minutes to keep rows valid; it does not run live yet (no Trigger.dev account,
  `trigger/README.md`).

## Outputs

- **Event** `spend-governor.budget-alerted` v1 `{ budget, level, periodStart }`, key
  `spend-governor.budget-alerted:<budget>@<periodStart>@<level>`: a budget's level rose above
  `none` this period. Returned by `recompute`; the caller publishes after commit.
- **Internal views** (`nabvy_pipeline`, security_invoker):
  - `spend_governor.v_throttle` (row `SpendGovernorThrottle`): budget, level, reason, since,
    computed_at. One row per budget always, even while off (reads `hold-new`, reason `off`).
  - `spend_governor.v_budgets` (row `SpendGovernorBudget`): name, provider, unit, period,
    limit_micros, committed_micros, remaining_micros, forecast_micros, level, period_start,
    computed_at, set_by. Empty while off.
- **User-facing views:** none.
- **Functions** (`@nabvy/spend-governor`): `recompute(q, { now, usdGbpRate })`,
  `readThrottle(q)` → `{ level, budgets }` (highest level over all budgets), `readBudgets(q)`,
  `readAdvice(q)` (forecast over a limit; a Scale plan may pay: for the owner, never acted on),
  and the pure `levelFor`, `londonMonth`, `overallLevel`.

## Tables

- `spend_governor.budgets`: `name` (primary key), `provider` (null: all), `unit` (`USD | GBP | GB`),
  `period` (`month`), `limit_micros`, `set_by`. Set by migrations only; the pipeline reads it.
- `spend_governor.throttle`: `budget` (primary key, references `budgets`), `level`, `since`,
  `period_start`, `committed_micros`, `forecast_micros` (both null: unmeasured), `computed_at`,
  `valid_until`. The pipeline selects, inserts and updates; nobody deletes.

Seeded budgets: `apify-monthly` $150 USD (owner, `docs/decisions.md`), `apify-plan-usage` $85 USD
and `apify-residential-proxy` 10 GB (the account's recorded plan caps,
`fb-scrap-engine/docs/EVIDENCE_LEDGER.md:321-322`), each a calendar month in Europe/London.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Committed spend | Settled calls at their settlement; unsettled at the larger of reservation and provisional cost; gateway runs not yet metered as the gateway counts them (queued: reservation) | Card; `supabase/README.md`, "Spend"; displayed costs up to 45% low (`EVIDENCE_LEDGER.md:17-18`) | Fixed |
| Period | Calendar month, Europe/London; unsettled calls count whatever month they began in | The gateway's cap (`apify-gateway` README) | Fixed |
| Throttle levels | `slow-free` 80%, `slow-paid` 85%, `slow-sweeps` 90%, `hold-new` 95% of a budget | 80% is the brief's (`CONTAINER_LISTINGS.md:202-203`); steps spread to 95% | Starting value |
| Overall level | The highest level over all budgets | Every budget binds | Fixed |
| Refresh | A recompute rewrites an unchanged row after 15 minutes | A quarter of the validity window | Starting value |
| Validity | A row older than 1 hour reads `hold-new` (reason `stale`) | Fail closed if the governor stops | Starting value |
| Forecast | committed × month ÷ elapsed, elapsed at least 1 day | Linear; one early run does not forecast a month of them | Starting value |
| Scale plan advice | Monthly Apify forecast ≥ $199 | `SCALE_PLAN.md:84-86` | The brief's figure |

## Fixtures and pass rate

- Stage `levels` (`test/fixtures/levels.fixtures.ts`), 9 synthetic cases through the pure rules
  against the budgets the migration seeds: each money level on the $85 ceiling, `hold-new` on $85
  with the 80% boundary on $150, unsettled calls at their reservation or provisional cost (the
  recorded run's $0.3363 reservation and $0.0003 reading), proxy GB at `slow-free`, at
  `hold-new`, and unknown. Pass rate 9/9.
- Stage `recompute` (`test/fixtures/recompute.fixtures.ts`), 4 cases on the real migrations in
  PGlite, each recomputed twice (the second writes nothing): the recorded run
  `VkryjpwS6U2GBDh3k` reserved and then settled at $0.0177, a queued $70 run alerting
  `slow-free` once, and $143 settled holding both money budgets. Pass rate 4/4.

Other tests: `domain.test.ts` (level boundaries, London months across BST, rounding, forecast,
write and alert decisions, advice), `idempotency.test.ts`, `switch.test.ts`, `contracts.test.ts`
and `packages/db/tests/spend-governor.test.sql` (grants, seeds, the fail-closed view on real
Postgres). No module reads the throttle yet, so "a reader passes with this module off" waits for
`check-scheduler`.
- `schedule.test.ts` (backlog 1.2m), 1/1: a row past its validity window (`v_throttle` reading
  `hold-new`/`stale`) is refreshed, with nothing else about the budgets changed, by the next
  scheduled `recompute` call 20 minutes later; a repeat call at that same time writes nothing.

## Decisions

- **2026-09-24: micros, and a unit per budget.** The card names `limit_minor` and `currency`. The
  ledger counts in micros (cost-meter's decision), and a proxy budget counts GB, so budgets carry
  `limit_micros` and `unit` (`USD`, `GBP` or `GB`, micro-GB for GB). A USD budget sums the
  ledger's USD amounts as billed, not `counted_gbp_micros`, so the owner's $150 is never
  converted twice; a GBP budget sums `counted_gbp_micros`.
- **2026-09-24: budgets live in the database, set by migrations.** They are owner decisions, so
  the pipeline can only read them; thresholds, windows and the Scale figure are in
  `@nabvy/config/modules/spend-governor`.
- **2026-09-24: v_throttle fails closed and keeps its rows while off.** Rule 11 empties internal
  views while a module is off, but an empty throttle would read as "no throttle". Like the
  exceptions rule 11 lists, `v_throttle` always returns one row per budget, reading `hold-new`
  while the governor or the cost meter is off, never computed, or stale.
- **2026-09-24: runs the ledger has not seen yet count too.** The gateway meters a run in
  cost-meter the tick after it starts, and queued runs are never metered until then; the governor
  adds `v_jobs` runs with no ledger row, so a queued run counts at its reservation at once.
- **2026-09-24: proxy GB is unmeasured for now.** `v_jobs` does not publish the run's proxy GB, so
  the 10 GB budget reads `unmeasured` (level `none`) once a run has settled this month
  (`docs/questions/spend-governor.md`). It does not fail closed, which would hold every hunt
  indefinitely; the dollar budgets, which include proxy spend, still bind.
- **2026-09-24: row types as contracts.** As in cost-meter, the repository has no `drizzle-zod`,
  so the view rows are Zod schemas in contracts and a test checks the Drizzle views' columns equal
  them.
- **2026-09-24: tests seed gateway runs through a stand-in `v_jobs`.** Only the gateway may write
  its tables (its conventions test), and no gateway function sets a run's state. The PGlite tests
  clone the real `v_jobs` into a table and replace the view over it; Postgres refuses the
  replacement unless every column keeps its name and type, so the stand-in tracks the gateway.
  `pnpm db:dry-run` runs the real view.
- **2026-09-24: shadow behaves like on.** The throttle is internal; a governor in shadow that did
  not throttle would let spend run unchecked.
- **2026-09-24 (backlog 1.2m): the scheduled task calls `recompute` directly and does not publish
  its `budget-alerted` events.** `trigger/spend-governor-recompute.ts` is the first file in
  `trigger/`, so this task also added it as a pnpm workspace package (`docs/questions/schedules.md`).
  No task consumes `budget-alerted` yet, and the `TriggerClient` publisher adapter is task 1.2's to
  build (`packages/transport/src/trigger.ts`); wiring a publisher now, with no consumer task
  registered, would fail at runtime. Recorded as a follow-up in `docs/questions/schedules.md`.

## Open questions

`docs/questions/spend-governor.md`: "proxy GB is not published by the gateway", "throttle steps
above 80%", "the $85 and 10 GB ceilings as monthly budgets"; actor-integration.md questions 4 and
19.

## Incidents

None.
