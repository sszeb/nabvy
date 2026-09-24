# @nabvy/travel-cost

One atomic module (`docs/decisions.md`, "Atomic modules"). A module session edits only this
folder, `packages/contracts/src/modules/travel-cost.ts`, `packages/config/src/modules/travel-cost.ts`,
`packages/db/src/schema/travel-cost.ts`, `packages/db/tests/travel-cost.test.sql` and
`packages/db/migrations/travel-cost/`.

## Job

What a trip costs a user: dated HMRC-style advisory-fuel and approved-mileage rates, and each
user's own trip-cost preset. `tripCost()` and `params()` are pure domain functions once their
inputs are resolved — no fetch, no model call. It never invents a price: every figure traces to a
dated `travel_rates` row, or to a user's own explicit override (`docs/design/modules/travel-cost.md`).

## Switch and priority

Off by default (rule 11 of `docs/design/modules/_rules.md`; no seed row exists yet, so
`switches.state('travel-cost')` reads `off` until an admin turns it on). Off: `tripCost`,
`params`, `updateSettings` and `listRates` all refuse (`travel-cost.module_off`), and
`travel_cost.v_rates` returns no rows — unlike `account`'s `v_channels`/`v_standing`, nothing this
module publishes is exempt from the switch filter (rule 11's table), because there is no prior
record that must keep applying while the module is off. MVP (search-map-routes draft, task 4.1g).

## Inputs

- Web forms, through a future oRPC procedure calling `getSettings`/`updateSettings` inside
  `withUser` (rule 12 of `_rules.md`; no `apps/web` procedure layer exists yet — see "Decisions").
- Rate rows: entered by the coordinator as a migration, not through a procedure (see "Rules and
  thresholds", "Reviewing rates").
- `legs` passed into `tripCost` by a caller that has already measured a trip's road miles and
  minutes (`travel-time`, the route planner) — this module prices a trip, it never measures one.
- Reads: `@nabvy/switches`' `isOn(q, 'travel-cost')`.

## Outputs

- **Events**: `travel-settings.changed` v1 `{ userId, at }`, keyed `user:<userId>@<at>`.
- **Internal view** (`nabvy_pipeline` only, no per-module roles yet): `travel_cost.v_rates` (kind,
  fuel, engine_band, tier, pence_amount, unit, effective_from, source_url), gated by
  `switches.state('travel-cost') <> 'off'`.
- **No `app.*` view yet.** The card names `app.v_travel_rates` a user-facing view, but no module
  has created the `app` schema (`services/account/README.md`, "Decisions" records the same gap and
  the same deferral); see "Decisions" below.
- **Functions** from `@nabvy/travel-cost`: `getSettings(q, userId)`, `updateSettings(q, input)`,
  `listRates(q)`, `tripCost(q, input, now?)`, `params(q, userId, now?)`.

## Owned tables

Postgres schema `travel_cost`.

- `travel_rates`: one dated, sourced rate row (`kind`, `fuel`, `engine_band`, `tier`,
  `pence_amount`, `unit`, `effective_from`, `source_url`). Never updated or deleted: a rate change
  is a new row, so a trip already priced still explains itself from the row that held on its own
  date. `fuel`/`engine_band`/`tier` are empty string, not null, where `kind` carries none, so the
  uniqueness index (`kind`, `fuel`, `engine_band`, `tier`, `effective_from`) holds without
  Postgres's null-is-distinct rule silently admitting a duplicate.
- `user_travel_settings` (RLS): one row per user — `preset`, `fuel`, `engine_band`, `custom`
  (jsonb, only while `preset = 'custom'`), `value_of_time_pence_hour` (null = the default rate row,
  `0` = "don't count my time"), `road_factor`, `speed_mph` (both null = the config defaults).

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Advisory fuel rate, petrol 1,401–2,000cc | 14p/mile, from 1 Mar 2026 | `travel_rates` seed row; GOV.UK advisory fuel rates | Dated row, reviewed quarterly |
| Approved mileage rate (HMRC business preset) | 55p/mile first 10,000 business miles, 25p after, from 6 Apr 2026 | `travel_rates` seed rows; GOV.UK AMAP increase | Dated row. `tripCost` prices every trip at the standard (55p) tier — no per-user annual-mileage tracking yet, so the reduced tier is seeded but unused |
| Default value of time | £12.71/hour, from 1 Apr 2026 (National Living Wage) | `travel_rates` seed row; GOV.UK minimum wage rates | Dated row, reviewed alongside the annual NLW change |
| Road miles per straight-line mile (`c`) | 1.3 | `packages/config/src/modules/travel-cost.ts`; Lovelace thesis ch. 5 (circuity) | Starting value, to calibrate against OSRM once `travel-time` ships |
| Average speed (`v`) | 35 mph | `packages/config/src/modules/travel-cost.ts`; assumption (search-map-routes pickups researcher) | Starting value, to calibrate against OSRM |
| Litres per UK gallon | 4.54609 | Fixed unit conversion, not a rate | Fixed |
| Rate review months | 1 Mar / 1 Jun / 1 Sep / 1 Dec | HMRC's own advisory-fuel-rate schedule | Fixed |
| Route-planner leg cap | 12 legs per `tripCost` call | `docs/design/drafts/search-map-routes.md` §6.2, the route planner's own stop cap | Fixed by that card |

**Reviewing rates.** This module has no scheduled job: `QUARTERLY_REVIEW_MONTHS` in
`packages/config/src/modules/travel-cost.ts` is the reminder for whoever operates Nabvy (today,
the coordinator) to check GOV.UK's advisory-fuel-rates page each quarter and add a new
`travel_rates` migration if the rate changed, matching the card: "Reminds the coordinator to
review rates each quarter."

**Rounding.** `tripCost` sums the fuel and time pence for every leg *unrounded*, and rounds the
total once. Rounding each leg or each part separately drifts a penny off the card's own worked
numbers (below).

## Fixtures and pass rate

Stage `trip-cost` (`test/fixtures/trip-cost.fixtures.ts`), run against the real seeded rate rows
through PGlite (not a hand-rolled rate array — `test/domain.test.ts` covers the pure logic on its
own), reproducing every worked number in `docs/design/drafts/search-map-routes.md` §4.2: the
per-extra-mile figure (£1.31), 5 extra miles at the default (£6.54), fuel only (£1.82) and the
HMRC business rate plus time (£11.87), 10 extra miles (£13.08), and a date before any rate applies
(refused, `travel-cost.no_rate` — "picks the dated rate by date"). Pass rate 6/6.
`test/domain.test.ts` covers `resolveRate`'s date selection, each preset, the mpg-to-pence
conversion, `£0` value of time ("don't count my time"), and `params()`'s rounding and overrides.
`test/idempotency.test.ts`, `test/switch.test.ts` and `test/contracts.test.ts` follow the shape
`services/account`'s suite uses. `packages/db/tests/travel-cost.test.sql` covers grants, the rate
table's constraints, RLS isolation and the switch-gated view on real Postgres (`pnpm db:dry-run`).

## Decisions

- 2026-09-24: rates are dated rows in `travel_rates`, not `packages/config` values, because the
  card asks for a source URL and an effective date per figure and a quarterly coordinator review —
  properties a config file's comment can name but a database row can carry and be queried by date.
  `packages/config/src/modules/travel-cost.ts` holds only the non-monetary calibration the §4.2
  formula needs (`c`, `v`, the litres-per-gallon conversion), for which no government source
  publishes a dated rate.
- 2026-09-24: the default value of time (the National Living Wage) is a third `travel_rates`
  `kind`, `value-of-time`, alongside the card's two named kinds (advisory fuel rate, approved
  mileage rate). It is exactly as dated and sourced as the other two, and the card's rule ("it
  never invents a price; every figure traces to a dated rate row") applies to it the same way; a
  config-file constant would not carry an effective date or a source.
- 2026-09-24: no `app.v_travel_rates` view yet. No module has created the `app` schema
  (`services/account/README.md`, "Decisions" records the same gap for its own user-facing view);
  building the first one here, ahead of the web app's oRPC layer, would mean guessing that layer's
  shape. `travel_cost.v_rates` (internal, `nabvy_pipeline`) and the exported `listRates()` stand in
  until that layer exists to build `app.v_travel_rates` from it, per rule 12.
- 2026-09-24: the HMRC business preset (`approved-mileage-rate`) always resolves to the standard
  (55p) tier. The card's own §4.2 worked numbers use a flat 55p, with no per-user annual-mileage
  tracking; the reduced (25p) tier is seeded, sourced and ready, but nothing reads it yet — a
  future task that tracks a user's business miles in the tax year can switch the resolution
  without a schema change.
- 2026-09-24: `tripCost`/`params`/`updateSettings`/`listRates` all refuse while the module is off
  (`assertModuleOn`, the same pattern `services/account` uses for its writes). Unlike `account`'s
  `getProfile`, there is no "read what's already there" case here worth exempting: a settings row
  with the module off is not a record of something that already happened, so there is nothing this
  module owes a caller who asks for the trip cost while it is switched off.

## Open questions

- `docs/questions/travel-cost.md`, "w1 travel-cost: default rate and value-of-time choice"
  (`docs/design/drafts/search-map-routes.md` §10, rows 7–8).

## Incidents

None.
