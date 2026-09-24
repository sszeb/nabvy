# @nabvy/cost-meter

Records the cost of every paid call in one ledger: each Apify run (reserved, then settled), each
model call (tokens × the price table) and each counted free call (eBay, CeX).

A module session edits only this folder, `packages/contracts/src/modules/cost-meter.ts`,
`packages/db/src/schema/cost-meter.ts`, `packages/db/migrations/cost-meter/`,
`packages/db/tests/cost-meter.test.sql` and `fixtures/contracts/cost-meter/`.

## Switch and priority

Off by default, like every new module (rule 11 of `docs/design/modules/_rules.md`). The cost meter
**fails closed**: while it is off, `record`, `recordModelCall` and `settle` write nothing and return
`cost-meter.off`, and a paying module must pause rather than spend unmetered. `readCosts` returns
no rows. Users lose nothing directly (no user sees costs); paid work stops. The gateway's own hard
cap (`apify_gateway.spend`, `supabase/README.md`) applies regardless.

Shadow and on behave the same: the meter has no user-facing view.

Priority P0 (`docs/architecture.md:99`).

## Inputs

No events. Paying modules call `record()`, `recordModelCall()` and `settle()`, passing a
`CostMeterContext`: the module's switch state and today's `USD_GBP_RATE` (see "Decisions").

## Outputs

- **Internal view** `cost_meter.v_costs` (row type `CostMeterCall`), granted to `nabvy_pipeline`:
  `id, module, provider, kind, ref_id, currency, reserved_micros, settled_micros,
  reserved_gbp_micros, settled_gbp_micros, counted_gbp_micros, status, latency_ms, settled_at, at`.
  `counted_gbp_micros` is what a call costs now: its settlement once settled, otherwise its
  reservation. Readers: `spend-governor`, `ops-metrics` (not built yet).
- **No restricted or user-facing views. No events.**
- **Functions** (`@nabvy/cost-meter`), each returning `Result<{ call, changed }, CostMeterError>`:
  - `record(db, CostMeterRecordInput, ctx)`: an Apify run with its reservation, or a free eBay or
    CeX call (settled at zero at once). Idempotent on `(provider, refId)`; a replay that names
    another module, kind or currency is refused (`cost-meter.mismatch`).
  - `recordModelCall(db, CostMeterModelCallInput, ctx)`: a returned model call, priced from the
    table and settled at once. An unpriced model is refused (`cost-meter.unknown_model`).
  - `settle(db, CostMeterSettleInput, ctx)`: the provider's final cost replaces the reservation
    once. Same amount again: no change. Another amount: `cost-meter.already_settled`. Unknown
    call: `cost-meter.not_found`. An Apify reading taken less than 10 minutes after the run
    finished: `cost-meter.not_final`, and the reservation keeps counting.
  - `readCosts(db, { since, module? }, ctx)`: the ledger as `v_costs` shows it.
  - Helpers: `unitsToMicros` (provider dollars to micros, rounded up), `toGbpMicros`,
    `modelCostMicros`.

## Tables

`cost_meter.provider_calls`: one row per call. `id`; `module, provider, kind, ref_id` (the
provider's ID: Apify run ID, model response ID, request ID); `currency` (`USD` or `GBP`);
`reserved_micros, settled_micros`; `usd_gbp_rate` and `reserved_gbp_micros, settled_gbp_micros`;
`settled_at, latency_ms, status` (`pending`, `succeeded`, `failed`: the provider's answer; being
settled is `settled_at`); `at`; `created_at, updated_at`. **Unique on `(provider, ref_id)`.**
A trigger refuses any change to a call's identity or reservation, and any change to a settlement
once `settled_at` is set. The pipeline may select, insert and update; nobody deletes.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Apify settle delay | 10 minutes after `finishedAt` | Apify finalises `usageTotalUsd` minutes after a run; the recorded run read $0.0003 at finish, $0.0177 settled; the gateway settles ≥ 10 min after (`supabase/README.md`, "Spend") | Starting value, matched to the gateway |
| Amount unit | integer micros (10⁻⁶ of a unit), rounded up | $0.0003 and sub-cent model calls are not representable in cents | Decided (below) |
| GBP conversion | `ceil(micros × USD_GBP_RATE)`, rate to 6 decimals, stored per row | `docs/engineering.md`, "Cost metering" | Decided |
| Model prices (USD per million tokens) | Haiku 4.5: 1 in, 5 out, 1.25 cache write 5m, 2 cache write 1h, 0.10 cache read; Sonnet 5: 2, 10, 2.50, 4, 0.20 | Anthropic first-party list prices, 2026-06-24 | Update when prices or configured models change |

## Fixtures and pass rate

Stage `ledger` (`test/fixtures/ledger.fixtures.ts`), run on the real migrations in PGlite:

- `apify-recorded-run`: run `VkryjpwS6U2GBDh3k` (`fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json`):
  reserved $0.3363; the reading at finish ($0.0003) refused as not final; settled at $0.0177
  ten minutes later; the replay changes nothing.
- `apify-settle-differs` (synthetic): a second settlement with another amount is refused.
- `free-ebay-call` (synthetic): eBay and CeX calls are counted at zero, once each.
- `model-call-haiku` (synthetic): Haiku 4.5 and Sonnet 5 calls priced from the table; an unpriced
  model refused.

The rate 0.75 and the later read times are synthetic. Pass rate: 4/4 (2026-09-24).

Other tests: `domain.test.ts` (rounding, conversion, prices, the settle-delay boundary),
`idempotency.test.ts`, `switch.test.ts`, `contracts.test.ts` (v_costs columns equal
`CostMeterCall`; view rows parse and match `readCosts`) and `packages/db/tests/cost-meter.test.sql`
(grants, one row per `(provider, ref_id)`, the settle-once guard, the view rules).

## Decisions

- **2026-09-24: micros, not minor units.** The card names `reserved_minor` and `settled_minor`.
  Minor units (cents) cannot hold the recorded run's reading at finish ($0.0003) or a model call
  costing a fraction of a cent, so a ledger in cents would round many calls to zero. The columns
  are `reserved_micros` and `settled_micros` in the provider's currency, with the GBP amounts in
  `reserved_gbp_micros` and `settled_gbp_micros`. Every rounding goes up.
- **2026-09-24: ledger currency.** Apify and Anthropic bill in USD. The ledger keeps `USD` or `GBP`
  (`CostMeterCurrency`), apart from the core listing `Currency` (GBP, EUR), which is never
  converted. The rate used is stored on the row (the reservation's until settled, then the
  settlement's).
- **2026-09-24: finality of an Apify reading.** `settle` takes the reading time and the run's
  `finishedAt` and refuses a reading taken under 10 minutes after the finish, so the $0.0003 read
  at finish can never settle a run that cost $0.0177.
- **2026-09-24: model calls are settled when recorded** (reserved = settled), because the cost is
  known from the usage the API returns. No pre-call reservation for model calls.
- **2026-09-24: switch and rate are passed in.** The `switches` module is not built, so there is no
  `switches.is_on()` to call. **Stub:** callers pass the state in `CostMeterContext`; `readCosts`
  applies it, and `v_costs` is not yet filtered in SQL (its migration says how it will be). The rate
  is still passed in too: `USD_GBP_RATE` now has its own `exchangeRate` config group, loadable
  without `APIFY_TOKEN` (task 0.8), but reading it directly here is a separate change from moving
  where it is grouped, and is not part of this module's scope yet.
- **2026-09-24: config moved to `@nabvy/config`.** The settle delay and price table were in
  `src/config.ts` until `@nabvy/config` gained per-module files; they now live in
  `packages/config/src/modules/cost-meter.ts` (rule 14), imported as
  `@nabvy/config/modules/cost-meter` (task 0.8).
- **2026-09-24: v_costs row type.** `CostMeterCall` is a Zod schema in contracts; the repository has
  no `drizzle-zod`, so a test checks the Drizzle view's columns equal the schema's keys instead of
  deriving one from the other.

## Open questions

- `docs/questions.md`: "cost-meter: USD_GBP_RATE outside the apify group", "cost-meter: micros
  instead of minor units".

## Incidents

None.
