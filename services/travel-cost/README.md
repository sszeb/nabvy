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
  Postgres's null-is-distinct rule silently admitting a duplicate. `engine_band` is a closed set,
  `TravelEngineBand` in contracts and a CHECK on both tables: GOV.UK's own bands, `1400-or-less`,
  `1401-2000` and `over-2000` (petrol, LPG) and `1600-or-less`, `1601-2000` and `over-2000`
  (diesel), so a typo can never silently match no rate row.
- `user_travel_settings` (RLS): one row per user — `preset`, `fuel`, `engine_band`, `custom`
  (jsonb, only while `preset = 'custom'`), `value_of_time_pence_hour` (null = the default rate row,
  `0` = "don't count my time"), `road_factor`, `speed_mph` (both null = the config defaults).

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Advisory fuel rate, petrol 1,401–2,000cc (the `fuel-only` default) | 14p/mile from 1 Mar 2026, 17p from 1 Jun 2026, 17p from 1 Sep 2026 | `travel_rates` seed rows; GOV.UK advisory fuel rates, read 2026-09-25 | Dated rows, one per quarter and band (27 advisory rows: petrol, diesel and LPG, three bands each, three quarters), reviewed quarterly |
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

**GOV.UK check log.** Task 4.1h's definition of done: "rate rows with source URLs, checked
against gov.uk before merge". Every check, successful or not, is recorded here.

| Checked on | By | Page "last updated" | Result |
| --- | --- | --- | --- |
| 2026-09-25 | Fix session for PR #50, from the build sandbox | Not seen | **Not checked.** `www.gov.uk` and the National Archives mirror were both refused by the sandbox's egress proxy (`EGRESS_BLOCKED`); no rate was guessed. Superseded by the next row. |
| 2026-09-25 | Finishing session for PR #50, after the owner opened the environment's network | 21 August 2026 | **Checked, all figures match.** Read `https://www.gov.uk/guidance/advisory-fuel-rates` (HTTP 200, "Published 21 July 2020, Last updated 21 August 2026"). The page publishes three quarters from 1 March 2026, pence per mile. From 1 September 2026: petrol 14 / 17 / 27 (1,400cc or less / 1,401–2,000cc / over 2,000cc), diesel 15 / 16 / 22 (1,600cc or less / 1,601–2,000cc / over 2,000cc), LPG 11 / 13 / 20; electric 7 home, 15 public. From 1 June to 31 August 2026: petrol 14 / 17 / 26, diesel 15 / 17 / 23, LPG 11 / 13 / 21. From 1 March to 31 May 2026: petrol 12 / 14 / 22, diesel 12 / 13 / 18, LPG 10 / 12 / 19. The seeded 1 Mar 2026 petrol 1,401–2,000cc row (14p) matched; the other 26 advisory rows were added to the seed exactly as published. The AMAP page (`.../increasing-mileage-rates`, published 17 June 2026) confirms 55p for the first 10,000 miles and 25p after, retrospective from 6 April 2026, as seeded. The minimum-wage page confirms £12.71 for 21 and over from April 2026, as seeded. These are the same figures the second review supplied from the page on the same day. |

Each later quarter is a new seed migration with one row per fuel and band, exactly as
published, plus a row in this log naming the date checked and the page's own "last updated"
date. Electric (the advisory electric rate, 7p home and 15p public from 1 Sep 2026) needs its own
design first: it is keyed by charging location, not engine band, so the `travel_rates` shape
does not hold it (`docs/questions/travel-cost.md`, "electric advisory rate").

**Rounding.** `tripCost` sums the fuel and time pence for every leg *unrounded*, and rounds the
total once. Rounding each leg or each part separately drifts a penny off the card's own worked
numbers (below).

## Fixtures and pass rate

Stage `trip-cost` (`test/fixtures/trip-cost.fixtures.ts`), run against the real seeded rate rows
through PGlite (not a hand-rolled rate array — `test/domain.test.ts` covers the pure logic on its
own), reproducing every worked number in `docs/design/drafts/search-map-routes.md` §4.2, priced
in the 1 Mar 2026 quarter whose 14p petrol rate §4.2 used: the per-extra-mile figure (£1.31), 5
extra miles at the default (£6.54), fuel only (£1.82) and the HMRC business rate plus time
(£11.87), 10 extra miles (£13.08); a date before any rate applies (refused, `travel-cost.no_rate`);
and two current-quarter cases on 2026-09-24 that must pick the 1 Sep 2026 rows, the same 5-extra-
mile trip at petrol 1,401–2,000cc's 17p (£6.93) and on a diesel 1,601–2,000cc at 16p (£6.80)
("picks the dated rate by date"). Pass rate 8/8 (was 6/6).
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
- 2026-09-25: the GOV.UK check is done by this session itself, not taken on trust from the
  review. The advisory-fuel-rates page, the AMAP page and the minimum-wage page were fetched
  directly (the owner had opened the environment's network), every seeded figure was compared
  with the published table, and the missing quarters and bands were seeded exactly as published,
  with the page's "last updated" date in the seed's comment and in the check log. The seed
  migration is amended in place because it is not merged yet; once merged, every later quarter is
  a new migration. The §4.2 worked-number fixtures are pinned to the quarter whose rate they were
  worked at (1 Mar 2026, 14p) rather than rewritten, because they exist to reproduce the draft's
  own figures; separate current-quarter fixtures prove the date selection picks the newest row.
- 2026-09-24: `tripCost`/`params`/`updateSettings`/`listRates` all refuse while the module is off
  (`assertModuleOn`, the same pattern `services/account` uses for its writes). Unlike `account`'s
  `getProfile`, there is no "read what's already there" case here worth exempting: a settings row
  with the module off is not a record of something that already happened, so there is nothing this
  module owes a caller who asks for the trip cost while it is switched off.

## Open questions

- `docs/questions/travel-cost.md`, "w1 travel-cost: default rate and value-of-time choice"
  (`docs/design/drafts/search-map-routes.md` §10, rows 7–8).
- `docs/questions/travel-cost.md`, "w1 travel-cost: electric advisory rate" (a rate keyed by
  charging location, not engine band; see the check log above).

## Review round 1 (2026-09-25, reviewed head f430d21)

- Finding 1 (blocking, the GOV.UK check): closed in round 2's fix. The page was read on
  2026-09-25 once the owner opened the network; every figure matched, and the 1 Jun and 1 Sep
  2026 quarters are seeded ("GOV.UK check log").
- Finding 2 (diesel, LPG and the other petrol bands): closed with finding 1; all nine bands are
  seeded for each of the three quarters.
- Finding 3: `engine_band` is now `TravelEngineBand` in contracts and a CHECK on both tables
  (`packages/db/migrations/travel-cost/20260924172655_travel_cost_tables.sql`, amended, as the
  migrations are not merged).
- Finding 4: `updateSettings` validates the *merged* row (`assertUsableSettings`, domain) before
  writing, so `{ preset: 'custom' }` with no custom rate, or `{ fuel: null }` on `fuel-only`, is
  refused with `travel-cost.invalid_input` and nothing is written.
- Finding 5: `packages/db/tests/travel-cost.test.sql` now probes deny-by-default (`app.user_id`
  unset reads no rows), WITH CHECK (an insert for another user is refused) and the engine-band
  CHECK.
- Finding 6: the defaults are typed once, `DEFAULT_SETTINGS` in the domain; the repo's first
  insert and the "no row yet" read both derive from it.
- Finding 7: `IsoDate` is `TravelIsoDate`.
- Finding 8: a custom rate that rounds to 0p a mile is refused at save time
  (`assertUsableSettings`) and again in `resolveParams`, with `travel-cost.invalid_input`, rather
  than handing `TravelParams` a 0 or flooring it to an invented 1p.

## Review round 2 (2026-09-25, reviewed head 40c81f7)

- Finding 1 (blocking, unchanged from round 1): the reviewer read the page and pasted its three
  tables. This session re-read the same page (and the AMAP and minimum-wage pages) itself, found
  the same figures, seeded all 27 advisory rows and logged the check; the worked-number fixtures
  are pinned to the 1 Mar 2026 quarter and two new fixtures price 2026-09-24 at the September rows.
- Finding 2 (the questions entry): the "GOV.UK unreachable" entry is replaced by a closed note
  saying the figures came from the page itself on 2026-09-25 (and matched the reviewer's), so
  nobody chases the owner for them; the electric rate is the one open question left.

## Incidents

None.
