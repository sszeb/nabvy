# @nabvy/city-pages

Knows Facebook's city pages (names, towns, rough coordinates), which of them are verified search
centres, and each centre's country and currency (`docs/design/modules/city-pages.md`).

A module session edits only this folder, `packages/contracts/src/modules/city-pages.ts`,
`packages/config/src/modules/city-pages.ts`, `packages/db/src/schema/city-pages.ts`,
`packages/db/tests/city-pages.test.sql` and `packages/db/migrations/city-pages/`.

## Switch and priority

Off by default (rule 11). While it is off, `reconcileSeen` and `verify` acknowledge and write
nothing, and every view returns no rows; the same while the global `pipeline` switch is off.
Readers then see no area membership, so `details-selector` selects only shipped listings and new
IDs wait. Shadow behaves like on: the module has no user-facing output. P1.

## Inputs

- The seed, `city-pages.seed.json` (771 city pages, 5 verified centres: Belfast, Chichester,
  Dublin, Edinburgh, Glasgow), loaded once by this module's own migration.
- listing-ingest's `v_city_pages_seen` (`cityPageId`, `townLabel`, counts and T1/last-seen), read
  by `reconcileSeen`.
- run-coverage's `v_search_coverage` and `v_search_controls` (a job's searches, their status and
  Facebook's reported centre), read by `verify`.
- Admin verification: `verify(q, { cityPageId, jobId, actorUserId })`, audited through
  `@nabvy/audit-log`'s `record()` in the same transaction.
- Switches `city-pages` and `pipeline`, through `@nabvy/switches` (fail closed).

## Outputs

- **Event** `city-pages.changed` v1 `{ cityPageIds }` (1–500 IDs), built by `reconcileSeen` and
  `verify` and published by the caller after the transaction commits. Key
  `city-pages.changed:<firstId>:<batch>`.
- **Internal views** (`nabvy_pipeline`; security_invoker; empty while off):
  - `city_pages.v_city_pages`: `city_page_id`, `name`, `towns`, `lat`, `lng`, `coord_source`,
    `first_seen_at` (`CityPagesCityPage`).
  - `city_pages.v_centres`: `city_page_id`, `active`, `verified`, `verified_by_job`, `country`,
    `currency`, `reported_lat`, `reported_lng`, `area_km` (`CityPagesCentre`).
  - `city_pages.v_area_membership`: `city_page_id`, `centre_id`, `distance_km`, `in_area`
    (`CityPagesAreaMembership`) — each city page's nearest active centre with a resolved
    coordinate, and whether it is within that centre's `area_km`.
- **Restricted and user-facing views:** none (rule 5).
- **Functions** (`@nabvy/city-pages`): `reconcileSeen(q)`, `verify(q, input)`, `listCityPages(q)`,
  `listCentres(q)`, `listAreaMembership(q)`, and the pure helpers `haversineKm`, `nearestCentre`,
  `selectGrid`, `newCityPagesFrom` (`src/domain`).

## Tables

Schema `city_pages`:

- `city_pages`: `city_page_id` (text primary key, the Facebook numeric ID as text), `name`,
  `towns` (text array), `lat`/`lng` (nullable, town-level approximations), `coord_source`
  (`seed | card`), `first_seen_at`.
- `centres`: `city_page_id` (primary key, references `city_pages`), `active`, `verified`,
  `verified_by_job` (nullable), `country` (`GB | IE`), `currency` (`GBP | EUR`), `reported_lat`,
  `reported_lng` (Facebook's own reported centre, nullable until verified), `area_km`.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Area radius | 100 km | A short local feed holds listings within about 100 km, and newest-first reaches about 115 km (`fb-scrap-engine/README.md:117-130`) | Starting value |
| Grid minimum separation | 80 km | The card's own description: "about 80–100 km apart" | Starting value |
| Identity | Keys on the numeric Facebook city-page ID, kept as text; never parses names or town slugs | `fb-scrap-engine/docs/EVIDENCE_LEDGER.md:32-38` | Fixed |
| Card-added name and towns | Exactly listing-ingest's raw `town_label`; the module has no other source for a name and does not guess one | This module (see "Decisions") | Fixed |
| Verified centres | Belfast, Chichester, Dublin, Edinburgh, Glasgow (`verifiedAsSearchCentre` in the seed) | `fb-scrap-engine/docs/EVIDENCE_LEDGER.md:32-65` | Fixed |
| Dublin | Verified but inactive while the beta runs UK only | `docs/decisions.md:19,132,137` | Fixed |
| National grid | 23 candidates selected by `selectGrid` over the seed's coordinates, plus the 4 UK verified centres, minimum separation 80 km | `src/domain/selectGrid`, run once at migration time (see "Decisions") | Starting value |
| Verification | A city page counts as verified only after a qualifying newest-first, non-degraded search binds it | `docs/decisions.md:137` | Fixed |

## Fixtures and pass rate

Stage `reconcile` (`test/fixtures/reconcile.fixtures.ts`):

- `recorded-run-additions`: the recorded run `fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/`
  carries 18 distinct city pages on its 20 listing rows; 16 are in the seed, and this case adds the
  other two — Chessington and the page "Upton, Dorset" (added under its raw town label "Poole",
  never the city page's own display name, since this module never sees that name).
- `already-known-no-addition`, `duplicate-new-id-once`, `no-town-label-uses-id` (synthetic):
  a known ID contributes nothing; a repeated new ID is added once, from its first row; a page with
  no town label is named after its own ID with an empty `towns` array.

Pass rate 4/4 (2026-09-24). Other tests: `domain.test.ts` (`haversineKm`, `nearestCentre`,
`selectGrid`'s separation and determinism, `newCityPagesFrom`), `idempotency.test.ts` (a repeated
`reconcileSeen` adds nothing more; a repeated `verify` for the same job refuses and writes no
second audit row), `switch.test.ts` (off, paused pipeline, shadow, `verify` while off),
`contracts.test.ts` (every view row type matches its view's columns; the event round-trips), and
`packages/db/tests/city-pages.test.sql` (the seed's 771 rows and 5 verified centres, grants,
checks, the switch filter, and `v_area_membership`'s distance on a synthetic pair).

## Decisions

- **2026-09-24: `reconcileSeen` is a plain exported function, not an event handler.** The card
  lists no event input for "adds city pages seen on cards" — only the seed, listing-ingest's
  `v_city_pages_seen`, run-coverage's `v_search_controls` and admin verification. Rather than
  invent a consumed event, `reconcileSeen` reads the whole of `v_city_pages_seen` each call, as
  `switches`' `set()` is a plain function an admin procedure calls. Which scheduler calls it is an
  open question (below).
- **2026-09-24: a card-added city page is named after its raw town label, never a parsed name.**
  listing-ingest's `v_city_pages_seen` carries only `town_label` (the reverse-geocoded `city`
  string), never the city page's own `display_name`. This module keys on the numeric ID and never
  parses names or town slugs (`fb-scrap-engine/docs/EVIDENCE_LEDGER.md:32-38`), so a new page's
  `name` and its one `towns` entry are exactly that raw label — for example the city page
  "Upton, Dorset" is added and named "Poole", the town label on the one recorded card that
  introduced it. A page with no label yet is named after its own ID with an empty `towns` array.
- **2026-09-24: the national grid was selected once, by `src/domain/selectGrid`, and embedded as
  migration seed data.** Greedy farthest-point selection over the seed's 635 coordinate-bearing
  entries, minimum separation 80 km, starting from the two verified UK centres whose real-world
  coordinate is known (Belfast, Edinburgh — from `fb-scrap-engine/docs/EVIDENCE_LEDGER.md:32-65`).
  Chichester and Glasgow are verified centres but have no coordinate in the seed and no cited
  reported centre either, so they are marked `active`/`verified` without a coordinate
  (CLAUDE.md, "No invented numbers"); an admin verification run fills in `reported_lat`/
  `reported_lng` for them, the same as for a new centre added on demand. The 23 selected grid
  candidates and their coordinates are listed in the access migration's own comment.
- **2026-09-24: a centre's effective coordinate is `coalesce(reported_lat, city_pages.lat)`.**
  Before verification, `v_area_membership` uses the candidate's own seed coordinate (if it has
  one); after verification, Facebook's own reported centre takes over. A centre with neither
  (Chichester, Glasgow, until verified) cannot be anyone's nearest centre, and a city page with no
  coordinate of its own (card-added) gets no distance at all — `centre_id` and `distance_km` are
  null and `in_area` is false, never guessed.
- **2026-09-24: `verify()` writes the audit-log entry itself**, in the same transaction, as
  switches' `set()` does, rather than leaving it to the caller — the card lists `audit-log` as a
  hard dependency and "admin verification (audited)" as an input.
- **2026-09-24: no PostGIS.** `v_area_membership`'s distance is a plain SQL haversine function
  (`city_pages.haversine_km`), matched by the pure `haversineKm` in `src/domain`. No other module
  uses PostGIS yet, and a two-point great-circle distance does not need the extension.
- **2026-09-24: no RLS.** No user rows; only the pipeline role reads and writes the tables. No
  delete: a city page or centre is only ever added, never removed, so there is nothing here for
  `seller-rights` erasure (rule 12).

## Open questions

`docs/questions/city-pages.md`: which scheduler calls `reconcileSeen`; whether `verify()` should
accept a country/currency other than GB/GBP for a centre added on demand outside the seeded grid.
Catalogue question 33.

## Incidents

None.
