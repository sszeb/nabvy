# @nabvy/location

Turns postcodes and city pages into points, and gives straight-line distances and town labels,
never anything finer (`docs/design/modules/location.md`).

## Switch and priority

Off by default (rule 11 of `docs/design/modules/_rules.md`; no seed row, so
`switches.state('location')` reads `off`). **Off**: `pointForPostcode()` makes no cache read or
write and no network call, and returns `undefined`; `townLabel()` returns an empty map. Neither
has a database row to leave behind while off — this module publishes no views (rule 5). Readers
carry on: `spec-match` marks a distance criterion as not stated, and `alert-router` does not alert
on it (README.md, "Job", card's "When off"). **Shadow** behaves like on: there is no user-facing
output to hold back (the same as `city-pages`, its one dependency with the same shape). `on`: all
of it. `distanceKm()` is a pure function and is never gated by the switch — it does no I/O, so
there is nothing for it to fail closed on; the caller only ever has two resolved points to give it
once the switch has already decided whether a point exists. P1: distance belongs to the app
(`fb-scrap-engine/docs/HANDOFF.md:84-86`), not this push's MVP surface.

## Inputs

- `@nabvy/switches`' `state(q, 'location')` (fail closed to `off`).
- `@nabvy/city-pages`'s `listCityPages(q)` (its `v_city_pages`), read by `townLabel()`.
- postcodes.io (`docs/secrets.md`, `POSTCODES_IO_BASE`), read by `pointForPostcode()`.
- No events consumed; no `v_` view read directly (city-pages is read through its own exported
  function, per rule 12's "calls another module's exported functions", not through a Drizzle
  view import, since this module treats `services/city-pages`'s package as its input, not its
  underlying view row).

## Outputs

- **No events.** This module publishes none.
- **No views**, internal, restricted or user-facing (card: "Views: none"). No coordinate ever
  reaches a view or a user-facing table (`docs/decisions.md`, "Precedence", "Location precision":
  never finer than town or distance).
- **Functions** (`@nabvy/location`):
  - `pointForPostcode(q, postcode)` → `LocationPoint | undefined`: cached forever once resolved.
  - `distanceKm(fromPoint, toPoint, basis)` → `LocationDistance`: pure, rounded to the nearest
    `LOCATION_DISTANCE_ROUNDING_KM`. The caller supplies both points and says which basis it used
    for the listing side (`coordinates` or `city_page`); this module never resolves a listing's
    point itself and never reads `pickup-location`.
  - `townLabel(q, cityPageIds)` → `Map<cityPageId, name>`: one call for the whole batch
    (`CLAUDE.md`, "Batches, not items"), never one lookup per card.
- Error codes: `location.provider_unavailable` (postcodes.io unreachable, or answered with
  anything other than 200 or 404), thrown as `LocationRefused`.

## Tables

Postgres schema `location`:

- `postcode_cache`: `postcode` (primary key, normalised — upper case, one space before the
  3-character inward code), `lat`, `lng` (checked to a valid latitude/longitude range),
  `fetched_at`, `created_at`, `updated_at`. No user_id: a postcode's coordinate is the same for
  every user, so this is a shared cache, never a user row (nothing here for `seller-rights`
  erasure, rule 12). Granted to both `nabvy_app` (a user's own postcode, inside `withUser`) and
  `nabvy_pipeline` (`notifier`); neither role may delete a row.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Distance rounding | Nearest 5 km | Card: coordinates behind a distance are only `coarse` precision (`fb-scrap-engine/…/dataset.json:447-451`) | Starting value |
| Postcode fetch timeout | 5000 ms | No rule sets a number; keeps a stalled postcodes.io call from blocking the request that asked for a distance | Starting value |

## Fixtures and pass rate

Stage `distance` (`test/fixtures/distance.fixtures.ts`), 3/3:

- `recorded-run-distances`: the recorded run `fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/`
  — Facebook's reported search centre (`run-summary.json:15-20`, Chichester) against each of the
  20 listings' `locationCoordinates` (`dataset.json`), reproducing the card's own figure: 14 of 20
  over 65 km raw, range 11.6–109.0 km.
- `rounding-boundary` (synthetic): the zero-distance and a small-boundary case for
  `roundToNearest`.
- `city-page-fallback` (synthetic): two town-level points with `basis: 'city_page'`, proving the
  basis passes through `distanceKm()` unchanged.

`test/domain.test.ts` covers `haversineKm`, `roundToNearest`'s tie-breaking, `normalizePostcode`
and `townLabelFrom` directly. `test/idempotency.test.ts` proves a repeated `pointForPostcode` for
one postcode fetches once and writes one row. `test/switch.test.ts` covers off (no network call,
no cache row, an empty `townLabel` map) and on (a cached lookup reused without a second network
call; `townLabel` reading a row `city-pages` has). `test/contracts.test.ts` checks `LocationPoint`,
`LocationDistance` and the empty event registry. All four run against the real `core`, `switches`,
`city-pages` and `location` migrations in PGlite (`test/support/database.ts`); the full set,
including grants, runs on real Postgres in `pnpm db:dry-run`
(`packages/db/tests/location.test.sql`).

## Decisions

- **2026-09-24: `townLabel()` takes a batch of city-page IDs and returns a map, not one ID at a
  time.** The card names the function singular, but rule 9 ("Batches, not items") rules out a
  per-listing-card call into `@nabvy/city-pages`, which only exposes `listCityPages()` (a full
  list, no lookup-by-ID). One call per card render, over an array, keeps this to one
  `listCityPages()` read for the whole batch.
- **2026-09-24: `townLabel()` also checks `location`'s own switch, returning an empty map when
  off.** The card ties "off" to distance only, but `townLabel()` is this module's other read
  path; treating it the same way (rule 11's "no rows") keeps the module's whole surface
  consistently gated, rather than leaving one function to answer while the module is meant to be
  off.
- **2026-09-24: the card's "Inputs: calls; `v_city_pages`, `v_centres`" is read as one call,
  `listCityPages()`.** No output here needs `v_centres`: `pointForPostcode()` resolves postcodes,
  not city pages, and `townLabel()` only needs a name. Left open below rather than guessed.
- **2026-09-24: `city-pages` has no `packages/db` schema, contracts or config file on `main` at
  the time of this branch, only its `services/city-pages` package.** This module therefore
  depends on `@nabvy/city-pages`'s exported function (`listCityPages`), never a Drizzle view
  import, and this module's own migration's `dependsOn` lists only `core` (no SQL here references
  `city_pages.*` or `switches.*` objects; the switch check happens in application code, the way
  `distanceKm()`'s caller already resolves points without a database).
- **2026-09-24: `postcode_cache` gets `created_at`/`updated_at` alongside `fetched_at`**, matching
  `packages/db/README.md`'s "Every table" rule, even though nothing ever updates a cached row.
- **2026-09-24: `pointForPostcode()` is not gated by the global `pipeline` switch.** Unlike
  `city-pages`' pipeline-only handlers, a user's on-demand postcode lookup runs inside a
  user-facing procedure, not an acquisition stage; only `location`'s own switch gates it.
- **2026-09-24: a 404 from postcodes.io (unknown postcode) returns `undefined`, never throws.**
  Consistent with "distance is unknown" rather than an error condition; only an unreachable
  provider or an unexpected status throws `LocationRefused`.

## Open questions

`docs/questions/location.md`: whether a future point-resolution helper needs `v_centres`;
`docs/secrets.md` still attributes `POSTCODES_IO_BASE` to the pre-split "hunt-manager" module.

## Incidents

None.
