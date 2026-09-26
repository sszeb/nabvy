# Open questions — pickup-routes

Same format as `docs/questions.md`: date, task, question, option taken and why. Build sessions
append here, never to `docs/questions.md` itself (`docs/session-conventions.md`, "Questions from a
build session"); the coordinator folds this file in at a batched push.

- **2026-09-25, w2 pickup-routes: soft seam to `router-gateway` (not merged).** The card reads
  `router-gateway.table()` for the OSRM matrix. Option taken: `RouterGatewayPort` in
  `services/pickup-routes/src/index.ts`, injected through `PickupRoutesDeps.router`, default
  `noRouter` (returns `undefined`), so every plan is an `estimate` (straight line × 1.3) until the
  gateway merges and the web app injects its `table()`. Conservative: no route call, no
  coordinate leaves the process. The router host and self-host question (search-map-routes.md §10
  rows 1–2) stays the owner's; nothing here chooses one.
- **2026-09-25, w2 pickup-routes: soft seam to `travel-cost` (PR #50, open).** The card reads
  `travel-cost.tripCost()` for the day's £. Option taken: `TravelCostPort`, injected through
  `PickupRoutesDeps.travelCost`, default `noTravelCost` (returns `undefined`): `costMinor` and
  `costBasis` are null and no £ is shown. Conservative: no invented number.
- **2026-09-25, w2 pickup-routes: route optimiser and router host are open on the card (§10
  rows 1–2, 25).** Option taken: the in-house exact solver over an injected matrix, the card's
  and draft's recommended default; no VROOM, no routing library, no host chosen.
- **2026-09-25, w2 pickup-routes: `PICKUPS_DATA_KEY` was not in `docs/secrets.md`.** Added the
  row there, the `pickupsData` group in `packages/config/src/env.ts`, the `.env.example` line and
  the config test fixture (files outside the module, each named in the PR). The secret must be
  generated per environment by a human before the module's switch is turned on.
- **2026-09-25, w2 pickup-routes: retention period (§10 row 15).** Option taken: pickups, with
  their days and plans, deleted 30 days after their day (`PICKUP_ROUTES_RETENTION_DAYS`), at
  once on `account.deleted`, and by the user at any time. The draft's interim default; the owner
  sets the period.
- **2026-09-25, w2 pickup-routes: reminder wording (§10 row 16).** Option taken: label and time
  only, in the draft's own words ("3 pickups tomorrow · first at 10:30", "Leave by 10:02 for
  'RTX 3090 – Bognor' at 10:30", "One pickup tomorrow has no agreed time"); with no plan the
  leave-by text reads "Time to leave for '…' at …". Wording shown to users is the owner's to
  change.
- **2026-09-25, w2 pickup-routes: the estimate's speed.** The draft fixes "straight line × 1.3"
  for distance but no speed to turn it into minutes. Option taken: 40 km/h
  (`PICKUP_ROUTES_ESTIMATE_SPEED_KMH`), always labelled `estimate` and never shown as a measured
  time; the owner may prefer another figure or none until the router is on.
- **2026-09-25, w2 pickup-routes: the pickups purge on `account.deleted` is immediate**, inside
  the handler, rather than "within 24 hours" (rule 12's upper bound). Nothing to decide; noted so
  the coordinator's wiring of the handler is the only step left.
- **2026-09-25, w2 pickup-routes: two card tests belong to the web app.** "The deal-card prefill
  carries no location/day/time/price" and "pasted seller text never reaches a request, log or row"
  test the sheet in `apps/web`, which this module does not own. What the module guarantees:
  `PickupRoutesPickupInput` is a strict object with no free-text field beyond label, address text
  and notes, refuses unknown keys (a pasted-text field cannot pass), and `test/contracts.test.ts`
  checks that no event or stored plan carries an address, postcode or coordinate. The web-app
  session should add the two UI tests when it builds the sheet.
- **2026-09-25, w2 pickup-routes: `dependsOn` in `module.json` lists `core` and `switches`
  only.** No SQL here references `switches.*`, `better_auth.*` or `location.*` objects (the
  switch and standing checks run in application code; geocoding is a function call), the same
  reading `location`'s migration took.
