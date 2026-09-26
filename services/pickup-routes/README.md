# @nabvy/pickup-routes

Holds the user's own record of arranged pickups, their reminders and pickup days, and plans a
one-day route through them (`docs/design/modules/pickup-routes.md`).

## Switch and priority

Off by default (rule 11 of `docs/design/modules/_rules.md`; no seed row, so
`switches.state('pickup-routes')` reads `off`). **Off**: every user-facing function (`createPickup`,
`updatePickup`, `setStatus`, `deletePickup`, `listForDay`, `reminderText`, `upsertDay`,
`getDefaults`, `updateDefaults`, `planDay`, `replan`, `icsFor`, `navigationLinksFor`) returns
`pickup-routes.off`, so the "arrange a pickup" action, the pickups pages and "Plan my day" are
hidden; `dueReminders()` returns nothing (reminders paused); `purgeExpired()` deletes nothing
(records are kept). The `account.deleted` purge always runs. **Shadow** behaves like on: there is
no user-facing view to hold back (this module has no view at all). **On**: all of it. MVP, task
4.1e (`docs/decisions.md:174`); needs the secret `PICKUPS_DATA_KEY` before it ships
(`docs/secrets.md`).

## Inputs

- `@nabvy/switches`' `state(q, 'pickup-routes')`; `@nabvy/account`'s `isActive()` on every
  user-facing call.
- `@nabvy/location`'s `pointForPostcode()` for a pickup's or the home postcode (`deps.geocode`
  overrides it in tests). Never postcodes.io directly.
- `@nabvy/config`: `PICKUPS_DATA_KEY` (`loadEnv(['pickupsData'])`, read at call time, or
  `deps.dataKey`) and the thresholds in `packages/config/src/modules/pickup-routes.ts`.
- **Soft** (injected through `PickupRoutesDeps`, both stubbed by default; `docs/questions/
  pickup-routes.md`): `router-gateway.table()` as `RouterGatewayPort` (default `noRouter`: no
  matrix, the plan is an `estimate`) and `travel-cost.tripCost()` as `TravelCostPort` (default
  `noTravelCost`: no £ shown).
- Events consumed: `account.deleted` v1 (`onAccountDeleted`).
- Web forms through oRPC procedures inside `withUser` (the procedures are the web app's task;
  every function here takes a `Queryable` and validates its own input).

## Outputs

- **Events** (`@nabvy/contracts/modules/pickup-routes`, identifiers and times only):
  `pickup-routes.changed` v1 `{ pickupId, userId, change }`; `pickup-routes.reminder-due` v1
  `{ reminderId, pickupId, userId, kind, dueAt }`; `pickup-routes.planned` v1 `{ planId, userId,
  dayId, pickupIds[], leaveAts[] }` (two parallel arrays: the registry refuses objects inside an
  array). Each function returns its envelope for the caller to publish after the transaction
  commits.
- **No views**, internal, restricted or user-facing, by the owner's decision (`docs/decisions.md:174`).
  `packages/db/tests/pickup-routes.test.sql` fails if the schema ever has one.
- **Functions** (`@nabvy/pickup-routes`; every user path inside `withUser`, results as `Result`):
  `createPickup`, `updatePickup`, `setStatus`, `deletePickup`, `listForDay`, `reminderText`,
  `dueReminders` + `markRemindersSent` (pipeline), `upsertDay`, `getDefaults`, `updateDefaults`,
  `homePoint`, `planDay`, `replan`, `currentPlan`, `icsFor`, `navigationLinksFor`,
  `navigationLinks` (pure), `purgeExpired` (pipeline), `onAccountDeleted`.

## Tables

All in `pickup_routes`, all with `user_id` and `enable_user_rls`; `nabvy_app` has full CRUD inside
`withUser`; `nabvy_pipeline` may delete (purges), read a few plain columns and mark a reminder
sent, and is never granted a `private_enc` column.

| Table | Key columns | Unique |
| --- | --- | --- |
| `pickups` | `label`, `private_enc` (sealed: postcode, address text, notes, postcode point, pin), `has_point`, `stop_type`, `day`, `window_kind/start/end`, `service_minutes`, `price_minor`, `bring_cash`, `size`, `must_get`, `status`, `listing_id` | — |
| `pickup_reminders` | `pickup_id` (cascade), `kind`, `due_at`, `sent_at` | `(pickup_id, kind, due_at)` |
| `pickup_days` | `day`, `start_kind`, `end_kind`, `private_enc` (sealed start/end points), `start_time`, `latest_finish`, `max_drive_minutes` | `(user_id, day)` |
| `route_plans` | `day_id` (cascade), `version`, `mode`, `basis`, `osm_build`, `start_at`, `finish_at`, `drive_seconds`, `distance_metres`, `cost_minor`, `cost_basis`, `stops` (IDs and times), `unassigned`, `superseded_at` | `(day_id, version)` |
| `planner_defaults` | `private_enc` (sealed home postcode, point, pin), `day_start`, `latest_finish`, `end_at_home`, `service_minutes` | `(user_id)` |

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Stops a day | 12 | `search-map-routes.md` §6.1; §10 row 25 | starting value |
| Fixed-time window | −5 / +10 min | §5.1 (assumption) | starting value |
| Time at the stop | 10 min; "testing" preset 30 | §5.1 (assumption) | starting value |
| Day window defaults | 09:00–18:00, end at home | §7.9 | starting value |
| Estimate fallback | straight line × 1.3 at 40 km/h, labelled `estimate` | card; §6.2; speed: none cited | starting value |
| Proposed slot | ETA rounded to 10 min, 20 min wide | §6.5 | starting value |
| Reminders | 19:00 the evening before; leave-by = departure − 10 min, or agreed time − 60 min without a plan; 18:00 the day before for "not agreed yet" | §5.4 | starting value |
| Retention | 30 days after the day | §5.6; §10 row 15 (interim) | starting value |
| Objective | most must-get, most stops, least driving, earliest finish | §6.2 | fixed |

## Fixtures and pass rate

Stage `plan` (`test/fixtures/plan.fixtures.ts`), 7 synthetic cases around Chichester (§9.4 area)
on the estimate matrix: a three-stop day, a wait absorbed as a later departure, an infeasible
window explained with its lateness, must-get winning when not everything fits, pinned first and
last stops, "My order" reporting lateness, and 12 stops all fitting. Pass rate 7/7 (100%),
recorded in `test/fixtures/pass-rates.json`. `test/solver.test.ts` also checks the solver against
a brute-force optimum on 60 random instances of 2–8 stops (with pins and a drive cap) and times
12 stops.

## Decisions

- **2026-09-25: one module, two concerns.** The draft's `pickups` and `route-planner` are one
  package here (card); the solver is `src/domain/solver.ts`, everything else `src/domain/index.ts`.
- **2026-09-25: the private fields are sealed together.** Postcode, address text, notes, the
  postcode's point and any dragged pin are one AES-256-GCM blob per row (`private_enc`), so no
  address, postcode or coordinate ever sits in a plain column; the SQL test greps the column list
  for one. Only `label`, the day, the window, the flags and the status are plain, because a
  reminder needs exactly those. The postcode is sealed too although the draft names only address,
  notes and point: a full postcode is a location. `has_point` is plain so a plan can say "no
  location" without opening the blob.
- **2026-09-25: no shared crypto package yet**, so the helper is `src/domain/crypto.ts` on
  `node:crypto` (§5.3's "until it exists, `pickups` keeps its own copy"). Key format: 32 bytes as
  64 hex characters or base64; anything else is `pickup-routes.key_missing`.
- **2026-09-25: the key and both soft dependencies are injected** (`PickupRoutesDeps`). The
  default key comes from `loadEnv(['pickupsData'])` at call time; tests pass a fixed key and a
  fixed postcode map, so no test reads the environment or calls `location`.
- **2026-09-25: events follow rule 7's names**, `pickup-routes.changed`, `pickup-routes.reminder-due`
  and `pickup-routes.planned`, not the draft's `pickup.changed` and `route.planned`.
- **2026-09-25: `reminderText()` runs inside `withUser(userId)`** for the event's user, not as
  the pipeline, so it can read the day's current plan for the leave-by time. `dueReminders()` and
  `markRemindersSent()` are the pipeline's, on the reminders table alone.
- **2026-09-25: "My order" keeps every stop the user listed** and reports lateness; pickups of the
  day left out of the order come back unassigned. A pinned-first stop that cannot be first, or
  pinned-last that cannot be last, leaves the plan with fewer stops rather than moving the pin.
- **2026-09-25: a changed day or a deleted pickup deletes the day row** (and its plans, by
  cascade) for the affected date, as §7.9 says; the next plan recreates the day from the defaults.
- **2026-09-25: the retention job pauses while the module is off** (rule 11: off writes nothing;
  card: "records are kept"); the `account.deleted` purge never pauses.
- **2026-09-25: no routing library and no router call.** The matrix is either the injected
  `router-gateway.table()` result or `estimateMatrix()`; nothing here contacts OSRM, a map or a
  seller.

## Open questions

`docs/questions/pickup-routes.md`: the two soft seams; retention period; reminder wording; the
estimate speed; the deal-card prefill and pasted-text tests, which belong to the web app.

## Incidents

None.
