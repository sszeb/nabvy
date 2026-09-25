# Open questions — location

Same format as `docs/questions.md`: date, task, question, option taken and why. Build sessions
append here, never to `docs/questions.md` itself (`docs/session-conventions.md`, "Questions from a
build session"); the coordinator folds this file in at a batched push.

- **2026-09-24, w1 location: does a future point-resolution helper need `v_centres`?** The card
  lists location's inputs as "calls; `v_city_pages`, `v_centres`", but none of the three exported
  functions (`pointForPostcode`, `distanceKm`, `townLabel`) needs a centre row: `townLabel()` only
  needs a city page's name, and the "city page's point" fallback the card describes is resolved by
  the *caller* of `distanceKm()`, never by this module. Option taken: this module reads only
  `listCityPages()` (`@nabvy/city-pages`) and does not read centres. Conservative because it adds
  no function beyond the card's three named outputs; if a caller later needs location itself to
  resolve a city page's coordinate (rather than doing so from `@nabvy/city-pages` directly), that
  is a new, explicit function to design, not a guess made here.
- **2026-09-24, w1 location: `city-pages` has no `packages/db`, `packages/contracts` or
  `packages/config` files on `main` yet, only `services/city-pages`.** Its README describes
  `v_city_pages`/`v_centres` and the `CityPagesCityPage`/`CityPagesCentre` row types as if they
  exist; at the point this branch was cut they did not (only the module's own package). Option
  taken: depend on the published `@nabvy/city-pages` package function (`listCityPages`) and its
  contracts import for types; list only `core` in `packages/db/migrations/location/module.json`'s
  `dependsOn` (no SQL here references `city_pages.*`). If those files still do not exist by the
  time this module's dependency graph is checked, that is a gap in an earlier wave's merge, not
  something to fix from this branch.
- **2026-09-24, w1 location: `docs/secrets.md` attributes `POSTCODES_IO_BASE` to "hunt-manager".**
  That module name predates the atomic-module split (`docs/decisions.md`, "Atomic modules");
  `location` is the module that now owns postcode resolution. Option taken: use the variable as
  documented (its default and validation in `packages/config/src/env.ts` already work), and note
  here that `docs/secrets.md`'s "Used by" column should be updated to `location` — a
  `docs/secrets.md` edit is outside the files this module session may touch.
