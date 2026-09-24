# @nabvy/source-adapters

Provider adapters behind the `ProviderAdapter` contract (`docs/contracts.md`, `docs/providers.md`).
Task 1.0 records the Facebook actor's real fields and maps them to the target shape; task 1.1 builds
the adapter on this record. Implemented so far: the route-health helper and actor-input validation with run presets (below).

## Facebook Marketplace actor (task 1.0)

- **Actor.** The private Apify actor `YfdUav3sZ2BgEf8rh` ("Marketplace Verification Private"),
  build **1.0.82**, from `sebtimize/fb-scrap-engine` at `f177a44`. Called only through the
  `apify-gateway` Edge Function (`supabase/README.md`).
- **Reference.** `docs/fb-actor-reference.md` is the full reference, compiled from a complete
  read of the actor repository and checked against its code (inputs, routes, every output field,
  `RUN_SUMMARY`, costs, failure modes, what the app must and must never do). This README is the
  task 1.0 summary and the mapping; where they differ, the reference has the detail.
- **Recorded run.** `fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/`. Details are
  in the table below.

| | Recorded run |
| --- | --- |
| Input | "gaming pc", Chichester centre (`cityId` 115935195086622), newest first, page 1, details on, graphql route, `maxRequests` 60, 1,024 MB, 300 s |
| Result | 20 listing rows + 1 `sourceOutcome` row in 25 s |
| Requests | 22 Facebook requests: 2 search, 1 item bootstrap page, 19 graphql replays |
| Cost | Settled **$0.0177** (reading at finish: $0.0003) |
| Descriptions | All 20 `full_verified` |
| Seller data | Seller present on 3 listings (redacted in the fixture) |

### Real input schema (build 1.0.82)

v3 accepts exactly these 23 keys; any other key fails the run before it starts (reference §2.2,
§2.4). Integers must be JSON integers; IDs are digit strings.

| Key | Type | Default | Limits |
| --- | --- | --- | --- |
| `inputVersion` | integer | (send 3) | 1, 2 or 3 |
| `searchTerms` | string[] | `[]` | ≤20, each ≤80 chars; needs `cityId` |
| `cityId` | digit string | none | `^\d{5,30}$`; only with `searchTerms` |
| `radiusKm` | integer | Facebook's (65 km observed) | 1–500 |
| `sort` | `default` \| `newest` | `default` | |
| `listingIds` | digit string[] | `[]` | ≤1,000 |
| `startUrls` | URL[] | `[]` | ≤100; the gateway refuses them |
| `includeDetails` | boolean | `true` | |
| `detailRoute` | `graphql` \| `page` | `graphql` | graphql returns no photo gallery |
| `browserFallback` | boolean | `true` | the gateway requires `false` |
| `detailSessionSize` | integer | 40 | 5–100 |
| `maxListings` | integer | `max(500, listingIds.length)` | 1–5,000, run-wide |
| `maxPagesPerSearch` | integer | 20 | 1–100; about 22 listings per page |
| `maxDetails` | integer | `min(6000, maxListings × 1.1)` | 0–6,000; caps detail requests |
| `maxRequests` | integer | formula (reference §2.3) | 1–20,000; the gateway requires 1–1,000 |
| `maxRunSeconds` | integer | 900 | 10–3,600; must be below the Apify timeout |
| `detailConcurrency` | integer | 4 | 1–8 |
| `useDetailCache` | boolean | `false` | keep off (it stores seller data in Apify) |
| `detailCacheTtlHours` | integer | 6 | cache only |
| `detailCacheRetryMinutes` | integer | 60 | cache only |
| `sourceDiagnostics` | boolean | `true` | keep on |
| `responseInventory` | boolean | `false` | diagnostic |
| `proxyConfiguration` | object | residential, **no country** | always send `RESIDENTIAL` + `apifyProxyCountry: "GB"` |

### Input mapping: `docs/providers.md` target → actor

| Target input | Actor input | Notes |
| --- | --- | --- |
| `locationId` | `cityId` | A Facebook city-page ID string. Regions use verified centres (`city-pages.seed.json`), not H3 cells (`docs/decisions.md`, Precedence) |
| `citySlug` | none | Town slugs are only reachable through `startUrls`, which cannot be source-bound and are refused by the gateway |
| `radiusKm` | `radiusKm` | Omit: the requested radius did not change results in the actor's tests |
| `category` | none | No category browse in v3; searches are terms only |
| `queries[]` | `searchTerms` | One search per term; batch a region's terms in one run (about 31% cheaper per term) |
| `sortNewest` | `sort: "newest"` | Pair with default-order catch-up runs (newest-first misses some listings and lags) |
| `daysSinceListed` | none | Deliberately excluded (ADR 0002); the app filters on `listedAt` |
| `minPrice` | none | Deliberately excluded; the app filters on `money` |
| `knownIds[]`, `sinceListedAt` | none | No high-water mark; the app deduplicates by `listingId` and bounds depth with `maxPagesPerSearch` |
| `maxPages` | `maxPagesPerSearch` | |
| `maxItems` | `maxListings` | Run-wide across all terms |
| `fetchDetails` | `includeDetails` (+ `maxDetails`, `detailRoute`) | Searches run with `false`; details go by `listingIds` |
| `passthrough{}` | none | Context stays on the gateway job row, keyed by the Apify run ID |
| Detail input: up to 50 URLs or IDs | `listingIds` | ≤1,000 per run; at the gateway's 1,000-request cap, about 200 per batch on graphql |
| (none) | `maxRequests`, `maxRunSeconds`, `proxyConfiguration`, `browserFallback`, `useDetailCache`, `sourceDiagnostics`, `inputVersion` | Always sent explicitly (reference §2.5) |

Standby mode: the actor does not use it. Runs are asynchronous through the gateway (start, then
collect), not `run-sync-get-dataset-items`; the recorded run took 25 s.

### Output mapping: target stub and detail → actor row

Rows have `recordType` `listing` or `sourceOutcome`; rows and `RUN_SUMMARY` are written only when
the run ends. "Filled" counts the recorded run's 20 listings, which all had details.

| Target field | Actor field | Filled | Notes |
| --- | --- | --- | --- |
| `id` | `listingId` | 20/20 | Digit string; exceeds JS safe integers, so store as text |
| `url` | `listingUrl` (= `url`) | 20/20 | Always `https://www.facebook.com/marketplace/item/<id>/` |
| `title` | `title` | 20/20 | The search card's title wins over the item's |
| `price` | `money.amountMinor` | 20/20 | Integer minor units; `money.kind` is `fixed`, `free`, `unknown` or `ambiguous`. The card's `price` (major units) can disagree after enrichment; use `money` |
| `currency` | `money.currency` | 20/20 | `£` GBP, `€` EUR (Ireland), any `$` USD |
| `locationText` | `location` | 20/20 | Town label |
| `lat`, `lng` | `locationCoordinates.latitude`, `.longitude` | 20/20 | **Item fetch only**: search rows without details have none. `precision: "coarse"` |
| `thumbnailUrl` | `imageUrl` | 20/20 | Signed, expiring Facebook CDN link. Never fetched by Nabvy (all Facebook traffic runs in Apify) |
| `listedAtText` | none | – | Not needed: `listedAt` is exact |
| `listedAtIso` | `listedAt` | 20/20 | **Unix seconds** (raw `creation_time`); convert. `listedAtPrecision` is `exact` |
| `isSold` | `availability.sold` | 20/20 | `availability` is always `{hidden, live, pending, sold}`, each boolean or null |
| `isPending` | `availability.pending` | 20/20 | Also `listingStatus` (for example `AVAILABLE`) |
| `deliveryMethod` | `deliveryTypes` | 20/20 | Array, for example `IN_PERSON`, `PUBLIC_MEETUP`, `DOOR_PICKUP`, `DOOR_DROPOFF`; plus `shippingOffered` |
| `categoryId` | `categoryId` | 20/20 | On cards. `categoryName`, `categorySlug` (20/20) and `categoryPath` (14/20) come from the item fetch |
| `sellerId` | `seller.id` | 3/20 | **Internal only** (`docs/decisions.md`, Precedence): private schema, never shown. Mostly rotating tokens, not stable IDs. Also inside `sourceFields` |
| `description` | `description` + `descriptionStatus` | 20/20 | Use `descriptionStatus` (`full_verified`, `partial`, `missing`) for completeness. `descriptionComplete` is an undocumented boolean equal to `descriptionStatus === "full_verified"`; derive it, never store it |
| `photoUrls[]` | `photoUrls` (+ `photos`, `photoGalleryTotal`, `photoGalleryComplete`) | 1/20 | The graphql route returns no gallery; only the bootstrap listing (fetched as a page) had photos. Use `detailRoute: "page"` where photos matter |
| `attributes{}` | `attributes` | 19/20 | Array of `{attribute_name, label, value}`. `condition` (19/20) is the Condition label; `detailSections` (4/20) holds the others |

Fields with no target that the adapter still uses: `foundBySearchTerms`, `sourceBindings` (a row
whose bindings are all unverified may be off-query), `displayedPreviousPrice` (1/20; never a price
reference), `detailOutcome` and `detailAttempted` (requeue decisions), `provenance`, `conflicts`
(after enrichment the card's `city_page` ID survives only here), `inventoryType`,
`messagingEnabled`, `viewerIsSeller`, `videos` (2/20). Never filled in this run: `customTitle`,
`customSubtitles`, `originGroup`, `parentListing`, `variablePrice`, `sourceComparison`,
`inventoryCount`. `sourceFields` holds raw provider objects, including seller data (internal only).

### Run metrics mapping

| Target metric | Source |
| --- | --- |
| Pages fetched | `RUN_SUMMARY.searches[].pages` |
| Items returned | `RUN_SUMMARY.listingsFound` (= listing rows) |
| New items | Not reported; the app computes it by deduplicating `listingId` |
| Bytes transferred | Apify run `usage.PROXY_RESIDENTIAL_TRANSFER_GBYTES`, `stats.netRxBytes` |
| Blocked responses | `sourceOutcome.sourceStatus` `blocked`, and stop reasons (reference §3.9) |
| Duration | Apify run `stats.durationMillis` |
| Requests | `RUN_SUMMARY.requests` (every Facebook request, including redirects and failed replays) |
| Cost | Settled `usageTotalUsd`, read at least 5 minutes after the run ends |
| Coverage | `RUN_SUMMARY.searches[]`: complete only when `route` is `http` and `stopReason` is `source-no-new-listings` or `source-exhausted`; `page-cap` and `results-limit` mean our own cap stopped a healthy read (reference §3.10) |

### Missing or changed against the target

No field that the adapter needs is missing, so the task does not stop. The differences, recorded in
`docs/questions.md`:

1. **Coordinates only after details.** Watches run with details off, so stubs from a watch have a
   town label (and a `city_page` ID) but no coordinates. The brief shows location no finer than
   town or distance anyway.
2. **No filters or high-water mark in the actor** (category, days since listed, minimum price,
   known IDs, pass-through). They are app-side by design (ADR 0002).
3. **Seller ID is sparse and internal.** 3 of 20 listings here; mostly rotating tokens.
4. **`docs/providers.md` is out of date on three points.** `listedAt` is an exact timestamp, not a
   rounded label. Paging goes up to 100 pages, not one page of 20–24. And the fallback actor is
   ruled out by the brief. The document is rewritten with the other build-pack updates
   (`docs/questions.md`).

### Decisions (task 1.0)

- **Fixtures are redacted inside the database.** `apify_gateway.redacted_items` and
  `redaction_leaks` (`supabase/README.md`) are used; raw seller data never leaves Supabase.
  Listing text, prices, IDs and town-level locations are kept, because they are what the fixtures
  test. One business's trade name in a description was also masked by hand at export.
- **A Facebook fixture is a whole run.** It goes under `fixtures/listings/facebook/runs/<date>-<runId>/`,
  with `input.json`, `dataset.json`, `run-summary.json`, `run.json` and a README. The per-listing
  folders in `docs/fixtures.md` are cut from runs when the adapter and labels exist (tasks 0.6
  and 1.1).
- **Pin the build.** The recorded run used the `latest` tag, which resolved to 1.0.82. Adapter
  runs must pin a build.
- **The test checks the fixture, not an adapter.** `test/facebook-run-fixture.test.ts` checks that
  every field this mapping relies on is present, with the expected type, in the recorded run. It
  also checks that the fixture carries no seller identity, and that the recorded input obeys the
  actor's v3 rules and the gateway's limits. The Zod schema for actor rows is built with the
  adapter (task 1.1), once task 0.2 has settled the contracts layout.

## Route health (task 1.1 groundwork)

`src/domain/route-health.ts` is a line-for-line TypeScript port of the actor's
`app/route-health.js` (`f177a44`), which the brief lists as code to copy. It chooses each region's
`detailRoute` from recent runs' `RUN_SUMMARY.detailRoute` stats. It stays on the cheaper graphql
replay while at least 95% of 50 or more replays succeed, and switches to the item page on a tripped
breaker, failing bootstraps or low success. It then probes graphql every tenth run and returns after
20 good probe replays.

- **Tests.** `test/route-health.test.ts` ports the actor's eight route-health tests. The two that
  exercise the actor's internals (its in-run breaker and its input normalisation) stay in the actor
  repository. Two tests are added: the recorded run stays on graphql as `insufficient-data` (19 of
  19 replays), and a pinned test for the known caveat.
- **Known caveat, pinned.** A reply for a listing with no description counts as a failed replay,
  so the actor's own 1.0.82 check (47 of 50) would move a region to the dearer page route with an
  alert. The port keeps the actor's behaviour until the owner decides (`docs/questions.md`); the
  pinned test makes any change deliberate.
- **Where state lives.** The caller keeps one state object per region, plus each run's
  `detailRoute` object tagged with its Apify run ID. Their table arrives with the adapter's storage
  (tasks 0.3 and 1.1).

## Actor input and run presets (task 1.1 groundwork)

`src/domain/facebook-actor-input.ts` validates what Nabvy sends to the actor, so a bad input is
rejected before it can cost a failed run.

- **Validation.** `FacebookActorInput` (Zod) mirrors the actor's own v3 rules (`src/gateway-input.js`
  at `f177a44`): the 23 allowed keys, JSON integers, digit-string IDs, limits and cross-field rules.
  It adds the gateway's stricter rules:
  - `maxRequests` 1–1,000 and `maxRunSeconds` always sent;
  - `browserFallback` and `useDetailCache` false, `sourceDiagnostics` true;
  - no `startUrls`;
  - residential GB proxy only.
- **Nabvy's own rules.** A run is either searches or a detail batch, never both, because searches that
  fill `maxListings` crowd out the IDs (reference §2.5). Terms and IDs must be distinct.
  `parseFacebookActorRun` also checks the Apify run options: memory of 512, 1,024 or 2,048 MB, a
  timeout of 60–1,800 s and longer than `maxRunSeconds`, and a pinned build.
- **Request budget.** `actorDefaultMaxRequests` is the actor's own formula. The tests check it
  against the actor's worked examples (12, 1,226 and 950).
- **Presets** (reference §2.5), each sized with that formula and refused if it would pass the
  gateway's cap:

  | Preset | Shape | Size limit |
  | --- | --- | --- |
  | `newestFirstCheck` | Page 1, newest first; 512 MB, 240 s | |
  | `catchUpCheck` | Pages 1–4, default order; 512 MB, 420 s | |
  | `fullSweep` | Up to 60 pages; 1,024 MB, 1,100 s | At most 3 terms |
  | `detailBatch` | Listing IDs on the route-health route; 1,024 MB, 1,100 s | At most 225 IDs on graphql, 450 on page |

- **Build pin.** Every preset pins build 1.0.82. The gateway does not pass the build to Apify yet;
  that change comes with the adapter (`docs/questions.md`).
- **Where it lives.** The schema lives in this module because only the adapter speaks the actor's
  dialect. If another module needs it, it moves to `@nabvy/contracts` with task 0.2.

**Dependency:** `zod` 4.6.5 (MIT), the version `@nabvy/config` already uses.
