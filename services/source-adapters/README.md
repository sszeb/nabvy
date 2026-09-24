# @nabvy/source-adapters

Provider adapters behind the `ProviderAdapter` contract (`docs/contracts.md`, `docs/providers.md`).
Task 1.0 records the Facebook actor's real fields and maps them to the target shape; task 1.1 builds
the adapter on this record. Implemented so far: the route-health helper and the actor-input
validation with Nabvy's run presets (task 1.1a; both below).

## Facebook Marketplace actor (task 1.0)

- **Actor.** The owner's private Apify verification actor `YfdUav3sZ2BgEf8rh`
  (fb-scrap-engine/README.md:484), build **1.0.82**, from `sebtimize/fb-scrap-engine` at `f177a44`.
  Called only through the `apify-gateway` Edge Function (`supabase/README.md`).
- **Reference.** `docs/fb-actor-reference.md`, rebuilt from the owner's listed files only
  (`docs/fb-actor-sources.md`), with a citation for every claim. Task 1.1a re-sourced or corrected
  every claim of this README that `docs/fb-actor-scope-report.md` found resting on other files.
  Citations of the form `fb-scrap-engine/<file>:<lines>` point into the listed files.
- **Recorded run.** `fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/`. Details are
  in the table below. "Observed" below means seen in this one run and not documented in the listed
  files; the fixture test fails on any value not yet observed, so it gets documented first.

| | Recorded run |
| --- | --- |
| Input | "gaming pc", Chichester centre (`cityId` 115935195086622), newest first, page 1, details on, graphql route, `maxRequests` 60, 1,024 MB, 300 s |
| Result | 20 listing rows + 1 `sourceOutcome` row in 25 s |
| Requests | 22 Facebook requests: 2 search, 1 item bootstrap page, 19 graphql replays |
| Cost | Settled **$0.0177** (reading at finish: $0.0003) |
| Descriptions | All 20 `full_verified` |
| Seller data | Seller present on 3 listings (redacted in the fixture) |

### Input schema (build 1.0.82)

The schema declares these 23 properties (fb-scrap-engine/.actor/input_schema.json:8-183). It sets
`additionalProperties: true` (:6), but the actor's README says unknown fields are rejected
(fb-scrap-engine/README.md:95-96), so Nabvy sends only these. The schema types integers as
`integer`, so Nabvy and the gateway refuse integers sent as strings. Line numbers are in
`.actor/input_schema.json`. "Not documented" means the listed files do not say.

| Key | Type | Default | Limits | Lines | Nabvy and gateway |
| --- | --- | --- | --- | --- | --- |
| `inputVersion` | integer | 3 | 3 (v3); 2 only for deprecated v2 | 8-14 | always 3 |
| `searchTerms` | string[] | not documented | ≤20; duplicates ignored regardless of case | 15-23 | Nabvy: each 1-80 chars, distinct by Nabvy's `termKey`, needs `cityId` |
| `cityId` | numeric string | none | not documented beyond digits | 24-30 | `^\d+$`; Nabvy: only with `searchTerms` |
| `radiusKm` | integer | Facebook's (65 km observed) | 1-500 | 31-38 | not sent: did not change results (fb-scrap-engine/README.md:117-124) |
| `sort` | `default` \| `newest` | not documented | | 39-52 | always sent explicitly |
| `includeDetails` | boolean | on | | 53-57 | |
| `maxListings` | integer | 500 | 1-5,000, run-wide | 58-65 | Nabvy: always sent (the default with `listingIds` is not documented) |
| `maxPagesPerSearch` | integer | 20 | 1-100; about 22 listings per page | 66-73 | |
| `listingIds` | numeric string[] | none | ≤1,000 | 74-81 | `^\d+$`; never with `searchTerms` (gateway) |
| `startUrls` | URL[] | none | ≤100 | 82-87 | the gateway refuses them |
| `maxDetails` | integer | `maxListings` plus 10% | 0-6,000; caps detail requests | 88-94 | Nabvy: only with details on |
| `maxRequests` | integer | "enough for the page and detail caps" (formula not documented) | 1-20,000 | 95-101 | gateway: 1-1,000; Nabvy's own budget (below) |
| `maxRunSeconds` | integer | 900 | 10-3,600 | 102-108 | gateway: required; the timeout must be at least this + 60 s |
| `detailConcurrency` | integer | 4 | 1-8 | 109-115 | |
| `detailRoute` | `graphql` \| `page` | `graphql` | graphql returns no photo gallery | 116-129 | chosen by route health |
| `detailSessionSize` | integer | 40 | 5-100 | 130-136 | |
| `browserFallback` | boolean | on | | 137-141 | the gateway requires `false` |
| `useDetailCache` | boolean | off | | 142-146 | the gateway requires `false` (no second copy in Apify: fb-scrap-engine/docs/HANDOFF.md:220-221) |
| `detailCacheTtlHours` | integer | 6 | 1-168 | 147-153 | cache only |
| `detailCacheRetryMinutes` | integer | 60 | 5-1,440 | 154-160 | cache only |
| `sourceDiagnostics` | boolean | on | | 161-165 | Nabvy: always `true` (conservative) |
| `responseInventory` | boolean | off | diagnostic | 166-170 | |
| `proxyConfiguration` | object | residential, **no country** (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:77-78) | | 171-183 | the gateway requires `RESIDENTIAL` + `apifyProxyCountry: "GB"` |

### Input mapping: `docs/providers.md` target → actor

| Target input | Actor input | Notes |
| --- | --- | --- |
| `locationId` | `cityId` | A Facebook city-page ID string. Regions use verified centres (`city-pages.seed.json`), not H3 cells (`docs/decisions.md`, Precedence) |
| `citySlug` | none | Town slugs redirect and are rejected (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:34-38); they could only go through `startUrls`, which the gateway refuses |
| `radiusKm` | `radiusKm` | Omit: the requested radius did not change results in the actor's tests (fb-scrap-engine/README.md:117-124) |
| `category` | none | Category URLs are reachable only through `startUrls` (fb-scrap-engine/.actor/input_schema.json:85), which the gateway refuses; category feeds on the fast route are untested (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:486). Searches are terms only |
| `queries[]` | `searchTerms` | One search per term; batch a region's terms in one run (about 31% cheaper per term) |
| `sortNewest` | `sort: "newest"` | Pair with default-order catch-up runs (newest-first misses some listings and lags) |
| `daysSinceListed` | none | Left out on purpose (fb-scrap-engine/README.md:3,134); the app filters on `listedAt` |
| `minPrice` | none | Left out on purpose (fb-scrap-engine/README.md:3,134); the app filters on `money` |
| `knownIds[]`, `sinceListedAt` | none | No high-water mark; the app deduplicates by `listingId` and bounds depth with `maxPagesPerSearch` |
| `maxPages` | `maxPagesPerSearch` | |
| `maxItems` | `maxListings` | Run-wide across all terms (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:305) |
| `fetchDetails` | `includeDetails` (+ `maxDetails`, `detailRoute`) | Searches run with `false`; details go by `listingIds` |
| `passthrough{}` | none | Context stays on the gateway job row, keyed by the Apify run ID |
| Detail input: up to 50 URLs or IDs | `listingIds` | ≤1,000 per run; Nabvy sends batches of up to 200 (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:68,108-109) |
| (none) | `maxRequests`, `maxRunSeconds`, `maxListings`, `sort`, `proxyConfiguration`, `browserFallback`, `useDetailCache`, `sourceDiagnostics`, `inputVersion` | Always sent explicitly: the gateway's rules (`supabase/migrations/20260924020000_apify_gateway.sql:93-110`, `20260924030000_apify_gateway_input_hardening.sql`) and Nabvy's (below) |

Standby mode: the actor does not use it. Runs are asynchronous through the gateway (start, then
collect), not `run-sync-get-dataset-items`; the recorded run took 25 s.

### Output mapping: target stub and detail → actor row

Rows have `recordType` `listing` or `sourceOutcome`; rows and `RUN_SUMMARY` are written only when
the run ends. "Filled" counts the recorded run's 20 listings, which all had details.

| Target field | Actor field | Filled | Notes |
| --- | --- | --- | --- |
| `id` | `listingId` | 20/20 | Digit string; one recorded ID has 17 digits (`28242423458759790`, dataset.json:2945), beyond JS safe integers, so store as text |
| `url` | `listingUrl` (= `url`) | 20/20 | Always `https://www.facebook.com/marketplace/item/<id>/` |
| `title` | `title` | 20/20 | Observed: provenance `search` on all 20, so the card's title won over the item's |
| `price` | `money.amountMinor` | 20/20 | Integer minor units. `money.kind`: only `fixed` observed; the vocabulary is not documented. `price` (major units) equalled `money.amountMinor / 100` on all 20; Nabvy uses `money` by its own choice |
| `currency` | `money.currency` | 20/20 | `GBP` on all 20; Dublin rows are EUR (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:57). Mapping a `$` price to USD is unverified |
| `locationText` | `location` | 20/20 | Town label |
| `lat`, `lng` | `locationCoordinates.latitude`, `.longitude` | 20/20 | **Item fetch only**: search rows without details have none. `precision: "coarse"` |
| `thumbnailUrl` | `imageUrl` | 20/20 | Signed, expiring Facebook CDN link. Never fetched by Nabvy (all Facebook traffic runs in Apify) |
| `listedAtText` | none | – | Not needed: `listedAt` is exact |
| `listedAtIso` | `listedAt` | 20/20 | **Unix seconds** (raw `creation_time`); convert. `listedAtPrecision` is `exact` |
| `isSold` | `availability.sold` | 20/20 | `availability` is `{hidden, live, pending, sold}`, all booleans in the run; whether a value can be null is unverified |
| `isPending` | `availability.pending` | 20/20 | Also `listingStatus` (for example `AVAILABLE`) |
| `deliveryMethod` | `deliveryTypes` | 20/20 | Array, for example `IN_PERSON`, `PUBLIC_MEETUP`, `DOOR_PICKUP`, `DOOR_DROPOFF`; plus `shippingOffered` |
| `categoryId` | `categoryId` | 20/20 | On cards. `categoryName`, `categorySlug` (20/20) and `categoryPath` (14/20) come from the item fetch |
| `sellerId` | `seller.id` | 3/20 | **Internal only** (`docs/decisions.md`, Precedence): private schema, never shown. Mostly rotating tokens, not stable IDs. Also inside `sourceFields` |
| `description` | `description` + `descriptionStatus` | 20/20 | Use `descriptionStatus` (`full_verified`, `partial`, `missing`) for completeness. `descriptionComplete` is undocumented (reference §11, Q11); observed equal to `descriptionStatus === "full_verified"` on 20 rows. Key on `descriptionStatus`; no separate column |
| `photoUrls[]` | `photoUrls` (+ `photos`, `photoGalleryTotal`, `photoGalleryComplete`) | 1/20 | The graphql route returns no gallery (fb-scrap-engine/.actor/input_schema.json:119); only row 1 had photos, most likely the bootstrap listing fetched as a page (inference). Use `detailRoute: "page"` where photos matter |
| `attributes{}` | `attributes` | 19/20 | Array of `{attribute_name, label, value}`. `condition` (19/20) is the Condition label; `detailSections` (4/20) holds the others |

Fields with no target that the adapter still uses: `foundBySearchTerms`, `sourceBindings` (a row
whose bindings are all unverified may be off-query), `displayedPreviousPrice` (1/20; never a price
reference), `detailOutcome` and `detailAttempted` (requeue decisions), `provenance`, `conflicts`
(after enrichment the card's `city_page` ID is here and in `sourceFields.search.location.reverse_geocode.city_page`, dataset.json:369-378; `locationDetails` holds only the detail coordinates), `inventoryType`,
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
| Blocked responses | Unverified: the listed files document no v3 status or stop reason for a block (only v2 text, fb-scrap-engine/README.md:170). A `sourceStatus` or `stopReason` not yet observed counts as degraded |
| Duration | Apify run `stats.durationMillis` |
| Requests | `RUN_SUMMARY.requests` (every Facebook request, including redirects and failed replays: fb-scrap-engine/README.md:54-56,76-78) |
| Cost | Settled `usageTotalUsd`, read at least 5 minutes after the run ends |
| Coverage | `RUN_SUMMARY.searches[]` (Nabvy's rule, conservative): complete only when `route` is `http` and `stopReason` is `source-no-new-listings` (fb-scrap-engine/README.md:101-108). `page-cap` (documented) and `results-limit` (observed: the recorded `run-summary.json:12`) mean our own cap stopped the read. Anything else is degraded |

### Missing or changed against the target

No field that the adapter needs is missing, so the task does not stop. The differences (1–3 are one
entry in `docs/questions.md`; 4 is part of the build-pack rewrite there):

1. **Coordinates only after details.** Watches run with details off, so stubs from a watch have a
   town label (and a `city_page` ID) but no coordinates. The brief shows location no finer than
   town or distance anyway.
2. **No filters or high-water mark in the actor** (category, days since listed, minimum price,
   known IDs, pass-through). They are app-side by design: the actor is a fetch tool
   (fb-scrap-engine/README.md:3,134; `docs/decisions.md`, "The actor is a tool").
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
- **The test checks the fixture, not an adapter.** `test/fixtures/adapter.facebook-run.fixtures.ts`
  (fixture stage `adapter`, run by `pnpm test:fixtures`) checks that every field this mapping
  relies on is present, with the expected type, in the recorded run. It also checks that the
  fixture carries no seller identity, and that the recorded input uses only the schema's properties
  and obeys the gateway's rules. The Zod schema for actor rows is built with the
  adapter (task 1.1), once task 0.2 has settled the contracts layout.

## Route health (task 1.1 groundwork)

`src/domain/route-health.ts` is a line-for-line TypeScript port of the actor's
`app/route-health.js` (`f177a44`), which the brief lists as code to copy, with one deliberate
divergence (below). It chooses each region's
`detailRoute` from recent runs' `RUN_SUMMARY.detailRoute` stats. It stays on the cheaper graphql
replay while at least 95% of 50 or more replays succeed, and switches to the item page on a tripped
breaker, failing bootstraps or low success. It then probes graphql every tenth run and returns after
20 good probe replays.

- **Tests.** `test/route-health.test.ts` ports the actor's eight route-health tests. The two that
  exercise the actor's internals (its in-run breaker and its input normalisation) stay in the actor
  repository. Three tests are added: the recorded run stays on graphql as `insufficient-data` (19
  of 19 replays), a pinned test for the known caveat, and a pinned test for the divergence.
- **Divergence: no replays is never low success.** The actor's helper compares `successRate <
  minSuccess` directly (fb-scrap-engine/app/route-health.js:54); in JavaScript `null < 0.95` is
  true. So a caller who sets `minAttempts` to 0 or less gets `page` / `low-success` with an alert
  from a history with no graphql replays at all (for example an empty one). None of the actor's
  tests reach that case, and its test that an empty history starts on graphql
  (fb-scrap-engine/test/route-health.test.js:58-59) points the other way, so Nabvy treats it as a
  bug and keeps its `successRate !== null` guard. With the default `minAttempts` of 50 the two
  behave identically. Recorded in `docs/questions.md` for the actor's owner.
- **Known caveat, pinned.** A reply for a listing with no description counts as a failed replay
  (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:241-243; fb-scrap-engine/app/route-health.js:13-14),
  so the actor's own 1.0.82 check (50 replays, 3 failed as `description-missing`, so 47 of 50 by
  computation) would move a region to the dearer page route with an alert. The port keeps the actor's behaviour until the owner decides (`docs/questions.md`); the
  pinned test makes any change deliberate.
- **Where state lives.** The caller keeps one state object per region, plus each run's
  `detailRoute` object tagged with its Apify run ID. Their table arrives with the adapter's storage
  (tasks 0.3 and 1.1).

## Actor input and run presets (task 1.1a)

`src/domain/facebook-actor-input.ts` validates every input Nabvy sends the actor
(`FacebookActorInput`, `parseFacebookActorRun`) and builds the four run presets. It replaces the
version withdrawn on review of PR 2 (`ae06eaa`), whose rules and request formula came from an actor
file outside the owner's reading list. Every rule now says which of three kinds it is:

- **schema:** a type, range or enum from `.actor/input_schema.json`, cited by line;
- **gateway:** also enforced by `apify_gateway.enqueue_run` (`supabase/README.md`);
- **Nabvy:** Nabvy's own conservative rule, never a claim about the actor: search terms of 1-80
  characters, distinct under `termKey` (NFKC, en-GB lower case, whitespace collapsed); `cityId`,
  `radiusKm` and `sort` only with terms; searches or a detail batch, not both; `maxDetails` only
  with details on; `maxListings` and `sort` always sent; `sourceDiagnostics` always on.

City and listing IDs are any digit string (`^\d+$`): the schema says only "numeric".

**Timeout margin (Nabvy decision).** The Apify timeout must be at least `maxRunSeconds` + 60 s. The
actor writes rows and `RUN_SUMMARY` only at the end, so a run the timeout aborts returns nothing
(fb-scrap-engine/docs/EVIDENCE_LEDGER.md:309-310). 60 s is the margin of the recorded run (240 s
against 300 s), which finished within it. The gateway enforces the same margin.

**Request budget (Nabvy decision, `requestBudget`).** The actor's default `maxRequests` formula is not
in the listed files, so Nabvy uses its own, resting only on listed evidence:

- per search: 1 bootstrap + its pages + 1 spare for the documented bootstrap retry
  (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:107-110); the recorded run used 2 for 1 page;
- per detail: 2 requests on graphql, 1 on the page route, plus 10% for a retry, rounded up
  (fb-scrap-engine/.actor/input_schema.json:91);
- capped at the gateway's 1,000: a preset that would need more is refused, never silently cut.

`maxRequests` is a hard cap "never exceeded" (fb-scrap-engine/README.md:78), so a generous budget only
raises the gateway's reservation, and details it cuts come back unattempted and are requeued.

**Presets.** Patterns from fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:63-68. Sizes are Nabvy's:
`maxListings` allows 25 listings a page (a page holds "roughly 22", input_schema.json:69; 24 were
seen on newest page 1, fb-scrap-engine/docs/EVIDENCE_LEDGER.md:239). Time limits are Nabvy's choices
(3 page-1 terms took 26 s in the 1.0.82 check, EVIDENCE_LEDGER.md:239). All run at 1,024 MB, because
whether the actor honours 512 MB is disputed (fb-scrap-engine/README.md:86-87 against
EVIDENCE_LEDGER.md:337-338), and all pin build 1.0.82.

| Preset | Input | `maxRequests` (3 terms) | `maxRunSeconds` / timeout |
| --- | --- | --- | --- |
| A `newestFirstCheck` | newest, page 1, listings only | 9 | 120 / 180 s |
| B `catchUpCheck` | default order, pages 1-4, listings only | 18 | 300 / 360 s |
| C `fullSweep` | default order, 60 pages (a full read: EVIDENCE_LEDGER.md:302-304); at most 3 terms, since 3 × 60 × 25 = 4,500 fits under `maxListings` 5,000 | 186 | 900 / 960 s |
| D `detailBatch` | up to 200 listing IDs (CONTAINER_LISTINGS.md:68), `maxDetails` = IDs + 10%, route from route health | 440 for 200 on graphql, 220 on page | 900 / 960 s |

`test/facebook-actor-input.test.ts` tests these rules as Nabvy's: what the schema allows, what the
gateway and Nabvy add, the timeout margin, the budget arithmetic, and that every preset stays inside
the gateway and the margin. It asserts none of the actor's internal formulas.
