# Facebook Marketplace actor: reference for Nabvy

Source: the actor repository `fb-scrap-engine` at commit `f177a44` (2026-09-24), read offline. This document was compiled from nine readers who each read one slice of the repository in full. It was then checked directly against `src/gateway-input.js`, `src/gateway-summary.js`, `src/source-outcomes.js`, `src/details.js:1-125`, `src/marketplace.js:200-349`, `src/main.js:500-984`, `.actor/input_schema.json`, `.actor/actor.json` and `Dockerfile`, and against a scripted comparison of `.actor/dataset_schema.json` with the fields the code emits.

- **Citations.** `path:line` is relative to the actor repository root. A `nabvy:` prefix means this repository.
- **Audience.** Engineers and agents building Nabvy's Facebook provider adapter and the `apify-gateway` Edge Function.
- **Personal data.** No seller names, seller IDs or listing-level personal data are reproduced here.
- **How it was made.** Nine readers each read one slice of the actor repository in full (every source, test, script, document and data file). A synthesis agent wrote the draft; an adversarial critic checked every claim against the cited lines and raised 19 corrections, which were applied. Nabvy-side facts were updated on 2026-09-24 after the redaction fix. When the actor changes, re-check the sections that cite the changed files.

## Short answers

- **`descriptionComplete` (the undocumented field).**
  - It is a boolean on every v3 `listing` row.
  - It is always exactly `descriptionStatus === 'full_verified'` (`src/details.js:13-24`, `src/marketplace.js:227-228,284-286`).
  - It is not declared in `.actor/dataset_schema.json`, which allows extra properties, and it is not mentioned in any `.md` file.
  - Key everything on `descriptionStatus`. Do not add an independent Supabase column for `descriptionComplete`. If a boolean is convenient, derive it (see §4.5).
- **Input.** Always send `inputVersion: 3`. Send `cityId` and `listingIds` as digit strings, and numeric caps as JSON integers. Send `proxyConfiguration` with `RESIDENTIAL` and `apifyProxyCountry: "GB"` (§2).
- **Output timing.** No dataset rows and no `RUN_SUMMARY` are written until the run ends (Crawlee's own state records do reach the key-value store earlier). Read `RUN_SUMMARY` even when the run's status is FAILED. An aborted or timed-out run yields nothing (§5.1).
- **Degraded searches.** A search gave complete coverage only when `route` is `http` and `stopReason` is `source-no-new-listings` or `source-exhausted`. `page-cap`, `results-limit` and `source-results-limit` mean one of our caps stopped a healthy read. Treat everything else as degraded and rerun it: `route` `browser-fallback`, `failed`, `unfinished` or `null`; `stopReason` `continuation-unavailable` (a continuation failed partway through the feed, even with `route: http`), `time-limit` or `request-cap`; `status` `partial`, `blocked` or `extraction-error`. `route: null` also covers a search that never started because the run reached `maxListings`, `maxRequests` or the deadline first (status `truncated`, `pages: 0`); `unfinished` is reported only for searches that were reached. A tight run-wide `maxRequests` can show up as `page-cap`, because the HTTP route reads at most min(`maxPagesPerSearch`, remaining requests − 1) pages (§3.10).
- **Seller data.** `seller` and the raw objects inside `sourceFields` (and detail-cache snapshots, if the cache were ever turned on) carry seller data. Search cards carry it too, so listings-only search runs deliver it (§5.2). They go only to a restricted private schema (§8).

---

## 1. What the actor is

**Purpose.** The actor's Console title is "Facebook Marketplace Gateway" and its package name is `fb-marketplace-sniper` (`.actor/actor.json:3-5`). It runs the Marketplace searches a calling app specifies and returns every listing found, with item details if asked. It applies no price, keyword or product filters (`.actor/input_schema.json:3`; `README.md:3`).

**ADR 0002: the actor is a neutral gateway** (`docs/adr/0002-actor-is-a-neutral-gateway.md:31-82`, accepted 2026-09-23).

- **The app decides:** the search plan, matching, verdicts, valuation, distance, alerts and repeat passes.
- **The actor executes:**
  - searches, as `searchTerms` × one numeric `cityId`, with a bound `radiusKm` and `sort`;
  - exact-ID detail fetches, as `listingIds`.
- **The actor never:** drops a returned listing, runs product-specific searches, or makes price, budget, condition or keyword verdicts. It reports coverage honestly (route, stop reason, binding, description completeness) and never collapses `unknown` into a negative.
- **Controls that remain:** searches, pages per search, details yes/no and how many, and request, time and spend caps. Price and "days since listed" limits are deliberately left out (`adr/0002:63-82`).
- **Facebook's dialect** (URLs, city IDs, pagination, sessions, proxies, retries, cache) lives only in the actor. One search serves many users, and results are keyed by listing, never by user (`adr/0002:50-52`).
- **Code enforcement.** v3 rejects any unknown key: "The gateway takes searches and caps only; filtering belongs to the calling app." (`src/gateway-input.js:41-45`). v3 always runs in candidate mode with `matchQuery: null` (`src/gateway-input.js:124-127`).

**Actors.**

- Call only the private test actor `YfdUav3sZ2BgEf8rh`.
- The production actor `JR2fdK8Nj6OLCwKkP` is frozen at build 1.0.9 and must never be published or touched (`docs/HANDOFF.md:36,378-380`; `AGENTS.md:51-53`; `nabvy:CLAUDE.md`).
- Deployment goes only to the private actor: `npm run stage:apify`, inspect the staging directory, then `apify push YfdUav3sZ2BgEf8rh --dir <dir>` (`docs/HANDOFF.md:378-380`).

**Current build and status.**

- The latest private build is **1.0.82** (commit `9d17951`, deployed 2026-09-24; `docs/HANDOFF.md:5-6`). Later commits (`fd04c9d`, `f177a44`) change only documentation.
- A live check passed on 1.0.82 (`docs/HANDOFF.md:7-12`; `docs/EVIDENCE_LEDGER.md:232-245`):
  - 50 IDs on the graphql route;
  - 10 IDs on the page route;
  - a 3-term page-1 check at 512 MB.
- `docs/IMPLEMENTATION_LOG.md:3` still says 1.0.82 is "prepared (local, not yet deployed)". That line is stale (§11).
- Build numbers are Apify build versions, not the npm version (`docs/README.md:56-57`). No document says which build the `latest` tag points to after 1.0.74 (`docs/IMPLEMENTATION_LOG.md:211`), so pin a build in the gateway (§8).

**What 1.0.82 changed for callers** (`docs/HANDOFF.md:15-27,47-78`; `docs/IMPLEMENTATION_LOG.md:5-38`):

- `detailRoute` defaults to `graphql`, and the detail cache is off by default.
- New inputs: `browserFallback`, `detailSessionSize` and `responseInventory`.
- Up to 1,000 `listingIds`, fetched in parallel.
- A replay circuit breaker, a memory guard below 1 GB, and a Node heap capped at 75% of run memory.
- Exact request accounting: every request is counted, including redirect hops.
- Deadline stops are reported as `time-limit` / `unfinished`, not as failures.
- `resolvedByDetailPass` on source outcomes.
- The app-side helper `app/route-health.js`.
- Defects fixed with tests. The most important: an explicit `maxRequests` below about `maxListings` used to give search discovery a negative budget and return 0 listings (`docs/validation/FIX_BATCH_REVIEW_1.0.82_2026-09-24.md:32-231`).

**What it will never do:**

- **No contact from a development machine.** All live traffic runs as Apify runs of the private actor (`AGENTS.md:17-25`).
- **No logged-in access.** It uses anonymous public item and search responses, only through its own in-run cookie jars (`test/cheerio-search.test.js:94-99`; `src/item-graphql.js:126-139`). Cookies are never put in the dataset or `RUN_SUMMARY`, but the search route uses a Crawlee session pool with `persistCookiesPerSession: true` (`src/cheerio-search.js:409`), and Crawlee persists search session-pool state to the run's default key-value store (about 10 key-value writes per check, `docs/design/GAP_ANALYSIS.md:52`). Whether that record includes the anonymous session cookies is not established from the repository. It never uses or stores a user's cookies.
- **No filtering or judging, and no listings dropped** (`adr/0002:33-45`).
- **No pay-per-event charging.** It makes no `Actor.charge` calls; the caller pays Apify platform usage (compute, residential proxy, dataset and key-value store operations).
- **No photo downloads.** It returns photo links only (`docs/EVIDENCE_LEDGER.md:288-289`).
- **No seller contact or posting on Facebook.** "It does not log into Facebook, message sellers or purchase items." (`README.md:486`).

---

## 2. Running it

### 2.1 How an input is routed

- The input must be a non-null object ("Actor input is required.", `src/marketplace.js:25`).
- `inputVersion` must be absent, 1, 2 or 3, otherwise "Unsupported inputVersion…" (`src/marketplace.js:26-28`).
- **v3** runs when `inputVersion === 3`, or when `inputVersion` is absent and any of `searchTerms`, `cityId` or `listingIds` is present (`src/marketplace.js:29-31`).
- **v2** (deprecated) runs otherwise, when `inputVersion === 2` or any of `mode`, `startUrls` or `urlList` is present (`src/marketplace.js:33-38`). **An input holding only `startUrls` and no `inputVersion` is routed to v2.**
- **Legacy v1** (`searchQuery` / `maxPrice`) is anything else (`src/marketplace.js:39-63`).
- **Memory guard.** Dispatch applies `applyMemoryGuard(input, ACTOR_MEMORY_MBYTES)` (`src/main.js:1105-1106`). Below 1,024 MB:
  - a v3 input gets `browserFallback` forced to `false`, and `RUN_SUMMARY.memoryGuard` explains why;
  - any other input throws "This input can need a browser; run it with at least 1024 MB…" (`src/main.js:60-72`).

`actor.json` sets memory to a default of 1,024 MB, a minimum of 512 and a maximum of 2,048 (`.actor/actor.json:11-13`). The Docker `CMD` caps the V8 heap at 75% of `ACTOR_MEMORY_MBYTES` (`Dockerfile:13-15`).

### 2.2 The v3 input contract

The accepted keys are exactly those in `src/gateway-input.js:6-12`. Anything else throws `Unknown v3 input field: <key>. …`. Integers are checked with `Number.isInteger`, so `"20"` is rejected (`src/input.js:14-20`). In the table, a bare `:NN` line reference means `src/gateway-input.js`.

| Field | Type / format | Default | Limits | Interactions | When Nabvy uses it |
|---|---|---|---|---|---|
| `inputVersion` | integer | 3 only as the Console schema default (`.actor/input_schema.json:8-14`) | 1, 2 or 3 accepted | Without it, a `startUrls`-only input goes to v2 | **Always send `3`** |
| `searchTerms` | string[] | `[]` | ≤20 entries (counted before dedupe); each non-blank, ≤80 chars after trim (`:46-50`) | Trimmed, whitespace collapsed, deduped on NFKC + en-GB lower case, first spelling kept and reported (`:29-37`). Needs `cityId` (`:55`). Each term becomes one search URL (`:81-84`) | Every search run; batch a region's terms in one run |
| `cityId` | string, `/^\d{5,30}$/` | none | A JSON number is rejected (`:52-54`) | Only with `searchTerms` (`:55-56`). One city per run | A verified centre's city-page ID (§3.6) |
| `radiusKm` | integer | `null` = Facebook default (65 km observed) | 1–500 (`:61`) | Only with `searchTerms` (`:57-59`). Sent as `radius=`. If Facebook does not echo it, binding fails (`.actor/input_schema.json:34`) | Usually omit: it did not change results in tests |
| `sort` | `"default"` \| `"newest"` | `"default"` | Anything else throws (`:62-63`) | `newest` adds `sortBy=creation_time_descend` (`:19,25`) | `newest` for frequent checks; `default` for catch-up and sweeps |
| `listingIds` | string[], each `/^\d{1,30}$/` | `[]` | ≤1,000 (`:17,64-68`) | Each becomes an item URL after searches and `startUrls`; duplicates dropped (`:90`). Raises the `maxListings` default to `max(500, n)` (`:103`) | Detail batches for IDs the app chose |
| `startUrls` | (string \| `{url}`)[] | `[]` | ≤100, each ≤2,048 chars, https facebook.com `/marketplace/` routes (`:69-70,85-89`; `src/input.js:26-41`) | Extra URL parameters or town-slug routes cannot be source-bound, so they use the browser route only and come back unverified (`src/source-binding.js:117-148`) | **Avoid**; escape hatch |
| `includeDetails` | boolean | `true` (`:96`) | — | `false` forces `maxDetails` to 0; a truthy `maxDetails` with `false` throws "maxDetails requires includeDetails." (`:105-109`) | `false` for all search runs; `true` for `listingIds` runs |
| `detailRoute` | `"page"` \| `"graphql"` | `graphql`, or `page` when `useDetailCache` is true (`:100`) | (`:101`) | graphql returns no photo gallery. Each failed replay costs an extra page request. Sets the per-item reserve (`:116`) | The route-health decision per region (§4.12); `page` when photos will be reviewed |
| `browserFallback` | boolean | `true` (`:112`); forced `false` below 1,024 MB | — | Adds one reserved request per search and per listing ID (`:113-116`; `src/main.js:632`) | `false` for checks and sweeps (rerun instead). See §2.5 |
| `detailSessionSize` | integer | 40 | 5–100 (`:130`) | graphql only: replays per sticky proxy session before a new bootstrap page | Leave at 40 |
| `maxListings` | integer | `max(500, listingIds.length)` (`:103`) | 1–5,000 | **Run-wide** cap on distinct listings across all sources. Also the per-source cap (`:126-127`) | Raise for sweeps (about 1,400 per term) |
| `maxPagesPerSearch` | integer | 20 | 1–100 (`:104`) | Internal `maxPagesPerSource` = value + 3 (bootstrap, bootstrap retry, browser reserve) (`:131`). About 22 listings per page (`.actor/input_schema.json:69`) | 1 (newest check), 4 (catch-up), 60 (sweep) |
| `maxDetails` | integer | `min(6000, maxListings + ceil(maxListings/10))` (`:107-108`) | 0–6,000 | Caps detail-pass **requests**, not listings (`src/details.js:139,147`) | Leave the default |
| `maxRequests` | integer | `min(20000, feeds×(maxPagesPerSearch+3) + items×itemReserve + maxDetails)` (`:117-118`) | 1–20,000 | Hard cap on every Facebook request, including redirect hops. Searches keep their page allowance first (`src/query-budget.js:54-82`; `README.md:82-83`) | **Always send it.** Nabvy's gateway refuses a job without it and allows only 1–1,000 (`nabvy:supabase/migrations/20260924020000_apify_gateway.sql:96-98`). Use the default formula as the value (§2.5) |
| `maxRunSeconds` | integer | 900 | 10–3,600 (`:140`) | When `maxDetails > 0`, discovery gets `floor(maxRunSeconds/2)` (`src/main.js:591-592`). The detail pass runs to the full deadline (`src/main.js:809`) | Size to the workload; the Apify timeout must be higher |
| `detailConcurrency` | integer | 4 | 1–8 (`:132`) | Also the parallel batch size for `listingIds` in discovery (`src/main.js:727`) | 4 |
| `useDetailCache` | boolean | `false` (`:133-134`) | — | `true` switches the `detailRoute` default to `page`, requires `ACTOR_ID` on the platform (`src/main.js:751-753`), and keeps seller-bearing snapshots in Apify | **Keep `false`** |
| `detailCacheTtlHours` | integer | 6 | 1–168 (`:138`) | Cache only | n/a |
| `detailCacheRetryMinutes` | integer | 60 | 5–1,440 (`:139`) | Cache only | n/a |
| `sourceDiagnostics` | boolean | `true` (`:142`) | — | If off: `searches[].route`, `httpStopReason` and `searchControls` are null, and there are no `candidateIds` (`src/gateway-summary.js:22-29`; `src/main.js:745-746`) | **Keep `true`** |
| `responseInventory` | boolean | `false` (`:144`) | — | Diagnostic only; no extra requests | Off |
| `proxyConfiguration` | object | `{useApifyProxy:true, apifyProxyGroups:['RESIDENTIAL']}` with **no country** (`:141`) | Must be a plain object (`:119-122`) | Datacenter IPs returned no listing data (`docs/EVIDENCE_LEDGER.md:333-336`) | **Always send RESIDENTIAL plus `apifyProxyCountry: "GB"`** (use GB for Dublin too, `docs/EVIDENCE_LEDGER.md:50-66`) |

**Fixed internals** (not settable in v3, `src/gateway-input.js:123-146`): `mode:'extract'`, `queryPipeline:true`, `matchQuery:null`, `queryOutputMode:'candidates'`, `expandSearch:false`, `generatedSearchUrls:[]`, `blockResources:true`, `httpSearchFirst:true`, `httpSearchProbe:false`, `allowResidentialFallback:false`.

**Source order.** Sources are built in this order: searches (in term order), then raw `startUrls`, then `listingIds`, deduplicated by URL (`:72-91`). `sourceIndex` on `sourceOutcome` rows is the position in this list (`src/source-outcomes.js:43-48`). At least one source is required: "Provide searchTerms with cityId, listingIds, or startUrls." (`:91`).

### 2.3 Budget arithmetic (worked examples)

- **Item reserve.** `itemReserve = (graphql ? 2 : 1) + (browserFallback ? 1 : 0)` (`src/gateway-input.js:116`).
- **Search reserve.** Each search reserves `maxPagesPerSearch + 3` requests.
- **Discovery versus details.** With both feeds and details, discovery gets `maxRequests` minus `min(maxDetails, maxListings, max(0, maxRequests − discoveryNeed))`. The detail pass may also use anything discovery left unused (`src/query-budget.js:54-82`; `src/main.js:855-857`).
- **Example: three newest-first terms,** `maxPagesPerSearch 1`, details off, fallback off: `maxRequests` = 3 × 4 = **12**.
- **Example: two terms, 60 pages,** `maxListings 1000`, details on: `maxDetails` = 1,100, and `maxRequests` = 2 × 63 + 1,100 = **1,226** (`test/gateway-input.test.js:52-60`).
- **Example: 200 `listingIds`,** graphql, fallback off: `maxListings` = 500, `maxDetails` = 550, and `maxRequests` = 200 × 2 + 550 = **950**.

### 2.4 Validation errors (the run fails and **nothing** is written)

These errors are thrown before any output, so the run's Apify status is FAILED with no dataset and no `RUN_SUMMARY` (`src/gateway-input.js:39-122`):

- `Unknown v3 input field: X…`
- `searchTerms must be a list of at most 20 non-empty terms of up to 80 characters.`
- `cityId must be a numeric Facebook Marketplace city ID string…`
- `searchTerms require cityId.`
- `cityId is used only with searchTerms.`
- `radiusKm and sort apply only to searchTerms.`
- `sort must be "default" or "newest".`
- `listingIds must be a list of at most 1000 numeric listing ID strings.`
- `startUrls must be a list of at most 100 URLs.`
- `startUrls[i] must be a URL no longer than 2048 characters.`
- `<key> must be a boolean.`
- `detailRoute must be "page" or "graphql".`
- `maxDetails requires includeDetails.`
- `<name> must be an integer from X to Y.`
- `proxyConfiguration must be an object.`
- `Provide searchTerms with cityId, listingIds, or startUrls.`

The adapter should validate with the same rules in Zod first, so that bad input never costs a run.

### 2.5 Recommended presets for Nabvy

All presets use the proxy block below. Set Apify **memory** and **timeout** explicitly on every run. The timeout must exceed `maxRunSeconds`, because rows are written only at the end (`docs/EVIDENCE_LEDGER.md:309-310`). Also pin the build (§8).

**Gateway limits.** Every preset must pass `maxRequests` explicitly. Nabvy's `apify_gateway.enqueue_run` refuses a job without it (allowed 1–1,000). It also requires `maxRunSeconds` ≤ the run timeout, `browserFallback: false`, an explicit `proxyConfiguration`, no `startUrls`, memory of 512, 1,024 or 2,048 MB and a timeout of 60–1,800 s (`nabvy:supabase/migrations/20260924020000_apify_gateway.sql:86-110`). Use the actor's own default formula (`src/gateway-input.js:107-118`): A = 4 × terms (12 for 3 terms); B = 7 × terms; C = 63 × terms (189 for 3); D = 2 × IDs + `maxDetails` (950 for 200 IDs on graphql). With the default `maxDetails` (550 for up to 500 IDs), preset D fits under 1,000 requests only up to 225 IDs, so keep batches at about 200. Spend is capped by the gateway's `settings.cap_usd` ($5.50, the owner's £5 for paid runs; `nabvy:supabase/README.md:17-18,24,33-34`). That is lower than the account's $40 cycle budget, which also covers the actor's own test runs.

```json
"proxyConfiguration": { "useApifyProxy": true, "apifyProxyGroups": ["RESIDENTIAL"], "apifyProxyCountry": "GB" }
```

**A. Newest-first check** (frequent, per region, cheap early signal)

```json
{ "inputVersion": 3, "searchTerms": ["<term1>", "<term2>", "<term3>"], "cityId": "<centre city-page ID>",
  "sort": "newest", "includeDetails": false, "maxPagesPerSearch": 1, "maxRequests": 12,
  "browserFallback": false, "useDetailCache": false, "maxRunSeconds": 120, "proxyConfiguration": { … } }
```

- **Run options:** 512 MB, timeout about 240 s.
- **Evidence:** 3 terms gave 24 listings each in 26 s, peaking at 103 MB, for about $0.0016 per term unsettled (`docs/EVIDENCE_LEDGER.md:239`), or $0.0015 per term settled when batched (`:331-332`).
- **Caveats:** newest-first stays within about 115 km, missed 11–41% of related listings and lags by hours (`docs/EVIDENCE_LEDGER.md:152-165`). Pair it with B.

**B. Catch-up** (default order, pages 1–4)

Same as A, but omit `sort` (or send `"default"`), set `maxPagesPerSearch: 4`, `maxRequests: 21` (7 × 3 terms) and `maxRunSeconds: 300`.

- **Cost:** estimated at about $0.005 per term (`docs/design/CONTAINER_LISTINGS.md:64`).
- **Caveat:** in long feeds, local listings sit at a median position of about 180, so pages 1–4 catch only part of local stock (`docs/EVIDENCE_LEDGER.md:131-145`).

**C. Full sweep** (daily)

```json
{ "inputVersion": 3, "searchTerms": ["<term1>", "<term2>", "<term3>"], "cityId": "<centre>",
  "includeDetails": false, "maxPagesPerSearch": 60, "maxListings": 4200, "maxRequests": 189,
  "browserFallback": false, "useDetailCache": false, "maxRunSeconds": 900, "proxyConfiguration": { … } }
```

- **Run options:** 512–1,024 MB (HTTP-only peaks were 0.12–0.37 GB, `docs/EVIDENCE_LEDGER.md:311-314`); timeout at least 1,100 s.
- **`maxListings` is run-wide.** Allow about 1,400 per term, which means at most 3 terms per run under the 5,000 cap.
- **Depth.** Full reads end at about 750–1,330 listings over 32–56 pages (`docs/EVIDENCE_LEDGER.md:111-118`). One `gaming pc` sweep hit the 100-page cap at about 2,400 listings (`:246-249`).
- **Cost:** settled $0.003 per term for a short feed (86 listings) to $0.031 for a long one (1,320 listings), both on build 1.0.79 (`docs/validation/GATEWAY_ADVERSARIAL_REVIEW_2026-09-23.md:121,123`). About 21% of the $0.031 was detail-cache key-value reads that 1.0.82 defaults do not make (`docs/EVIDENCE_LEDGER.md:329-330`). The "$0.01 (short)" in `docs/HANDOFF.md:144` and `docs/design/CONTAINER_LISTINGS.md:65` has no run behind it.
- **Short feeds.** A read that ends at about 90 listings over 4 pages is a short local feed. Rerun it when nationwide depth is needed (§3.7).

**D. Details by `listingIds`** (one global queue, batched)

```json
{ "inputVersion": 3, "listingIds": ["<id>", "…"], "includeDetails": true,
  "detailRoute": "<route-health decision: graphql | page>", "browserFallback": false,
  "useDetailCache": false, "detailConcurrency": 4, "maxRequests": 950, "maxRunSeconds": 900, "proxyConfiguration": { … } }
```

- **Run options:** 1,024 MB (a 200-listing detail run peaked at 815 MB, `README.md:71-72`); timeout at least 1,100 s.
- **Batch size:** the design uses up to 200 per batch (`docs/design/CONTAINER_LISTINGS.md:68`); the actor's hard cap is 1,000, but the gateway's 1,000-request cap limits a graphql batch to 225 IDs with the default `maxDetails` (see "Gateway limits" above). Send `"maxRequests": 950` for 200 IDs on graphql (750 on the page route, whose item reserve is 1).
- **Second fetches.** An ID whose discovery fetch did not reach `full_verified` is fetched again by the detail pass, so a description-less listing can cost up to 4 requests on graphql (§4.2).
- **Photos:** use `page` for listings whose photos will be reviewed (§4.7).
- **Timing.** With `maxDetails > 0`, discovery (which fetches each ID once) gets only half of `maxRunSeconds`. IDs it did not reach are fetched by the detail pass and then carry `resolvedByDetailPass` (§4.9).
- **Why `browserFallback: false`?** A browser item fallback costs about 9 times as much for one page (`.actor/input_schema.json:140`). The app should requeue unresolved IDs instead. With `true`, each ID reserves one more request.

**Do not mix searches and `listingIds` in one run** unless `maxListings` exceeds the expected search results plus the IDs. Searches that fill `maxListings` crowd out the IDs. Their sources end `truncated`/`results-limit` (or `request-cap`) with 0 pages, and discovery adds a placeholder row (`src/collection.js:311-317`; `src/direct-item-candidates.js:24-44`). The detail pass then treats the placeholder like any other row (`src/main.js:802,858-861`). If `maxDetails`, `maxRequests` and time remain, it fetches it: success clears `directItemUnresolved` and `detailError`, and the source row gets `resolvedByDetailPass: true` (`src/main.js:873-882`; `test/main-v3.test.js:77-85,322-335`). Otherwise the row ends `not-requested-cap` or `not-requested-request-cap` with `detailAttempted: false` (`src/details.js:189-195,205-207`), but still carries `directItemUnresolved: true` and the misleading `detailError` ("Requested Marketplace item was not identified from its public item route."). Requeue on `detailOutcome` and `detailAttempted`, never on `detailError` or `directItemUnresolved`. The README recommends running searches with `includeDetails: false`, then sending only new IDs through `listingIds` (`README.md:135-139`).

### 2.6 Deprecated inputs to avoid

- **v2 (Extract/Monitor):** keys `mode`, `startUrls`/`urlList`, `resultsLimit`, `includeListingDetails`, `matchQuery`, `queryOutputMode`, `expandSearch`, `maxCandidateListings`, `maxPagesPerSource`, `maxResultsPerSource`, `blockResources`, `allowResidentialFallback`, `watchlistId`, `originPostcode`, `radiusMiles`, `allowUnknownDistance`, `monitorPreset`, `gpuModels`, `cardBudget`, `pcBudget`, `currency`, `matchAny`, `genericMaxPrice`, `immediateSummary`, `timeZone`, `emailTo`, `discordWebhook`, `baselinePolicy`, `watchlistRevision`, `httpSearchProbe` and `httpSearchFirst` (`src/input.js:4-12`).
  - v2 matching and Monitor are deprecated: hidden from the Console form but still accepted through the API (`docs/HANDOFF.md:256-259`).
  - Monitor needs `MONITOR_DATABASE_URL` and writes to the deprecated Supabase schema `marketplace_monitor` (`src/main.js:986-990`; `docs/IMPLEMENTATION_LOG.md:283-318`). **Never send `mode: "monitor"`.**
- **Legacy v1:** `searchQuery`, `maxPrice`, `targetLocation`, `radius`, `maxItems`, `excludedTerms`, `requireAllQueryTerms`, `loadMoreResults` and related keys (`src/marketplace.js:17-20`). They drive a browser search by town slug. `inputVersion: 1` is accepted but undocumented.
- **v3 names that do not exist:** `includeListingDetails`, `radius`, `sortBy`, `minPrice`, `maxPrice`, `daysSinceListed`. Each throws "Unknown v3 input field" (`test/gateway-input.test.js:32-38`).

---

## 3. How searches work

### 3.1 The URL and which URLs can be bound

Each term becomes `https://www.facebook.com/marketplace/{cityId}/search/?query=<term>[&radius=<km>][&sortBy=creation_time_descend]` (`src/gateway-input.js:21-27`).

`requestedSearch` accepts a URL as **bindable** only if all of these hold (`src/source-binding.js:117-148`):

- https on a facebook.com host (`www.`, `m.` or `web.` allowed);
- path `/marketplace/<1–30 digit city ID>/search/`;
- exactly one non-empty `query`;
- optional `radius` (1–999) and `sortBy=creation_time_descend`;
- `ref`, `fbclid` and `utm_*` are ignored.

Any other parameter (`minPrice`, `daysSinceListed`, `exact`, `locale=en_GB`, `sortBy=distance_ascend`) or a town-slug route makes the URL unbindable. Such a URL can only go through the browser, unverified. Town slugs redirected to a generic feed, sometimes showing San Francisco listings (`docs/EVIDENCE_LEDGER.md:31-38,67-76`).

### 3.2 The HTTP route (default)

The HTTP route runs when `httpSearchFirst` is set (always true in v3), the route is `search`, the URL is bindable, and `pageBudget ≥ 2 + browserReserve`. `browserReserve` is 1 when `browserFallback` is on (`src/main.js:628-634`). The route is called with (`src/main.js:635-645`):

- `maxRequests = min(102, pageBudget − browserReserve)`
- `maxPages = min(100, maxPagesPerSearch)`
- `maxListings = min(5000, remaining results)`
- `knownIds` = listings already collected, so overlap with earlier searches does not use up this search's allowance
- a 15 s timeout per request

It then works in three steps:

1. **Bootstrap.** One `GET` of the search page (about 646–762 KB, `docs/EVIDENCE_LEDGER.md:84-87`). It goes through a Chrome-impersonating Impit client on a residential proxy session, with no redirects followed (`src/cheerio-search.js:383-427`). It is accepted only if all of these hold, checked in order (`src/cheerio-search.js:288-324`):
   - status 200 (else `bootstrap-request-failed`, category `redirect` or `http-status`);
   - route and parameters retained (else `bootstrap-route-changed`);
   - at most 2 MiB (else `bootstrap-byte-limit`);
   - `text/html` (else `bootstrap-non-html`);
   - exactly one GraphQL template, either a complete observed POST or the `CometMarketplaceSearchContentContainerQuery` preloader (query name and numeric query ID) plus a unique `/ajax/qm/` form context; a unique LSD token is added when present (`src/cheerio-search.js:62-81,140-141`) (else `request-template-unavailable`).
2. **Replay.** Facebook's own GraphQL `POST` to `/api/graphql/` is replayed in the same proxy session and cookie jar, with `credentials:'omit'` and `redirect:'manual'`, capped at 8 MiB per response (`src/http-search.js:52-103`).
3. **Paging.** The loop continues while `has_next_page` is true, a cursor exists, `pages < maxPages` and new IDs are below `maxListings`. Each next page must be the same operation, carry exactly the previous cursor, and add at least one unseen ID (`src/http-search.js:206-255`).

**Result.** The route returns `status` `ok` or `unverified`, `sourceBinding`, `searchControls`, `requestsUsed` (bootstrap included), `pagesUsed`, `exhausted` (true only when the last page said `has_next_page:false`) and `stopReason`. `nextCursor` is always null, so no resumable cursor is ever handed back (`src/cheerio-search.js:363-380`). **To read deeper, raise `maxPagesPerSearch` in the same run.**

**Acceptance.** A result is accepted only when `status === 'ok' && sourceBinding === 'verified'` (`src/main.js:646`).

**Request cost.** One bootstrap, plus one `POST` per page, plus one possible bootstrap retry (`src/cheerio-search.js:367-368,445-452`).

### 3.3 Bootstrap retry

If the bootstrap or the first GraphQL POST fails with category `network` or `redirect` (Facebook has answered some residential IPs with HTTP 302), no page was read, and at least 2 requests remain, the route retries once in a new crawler, which means a new proxy session. The condition tests `diagnostics.failureCategory` and `pagesUsed`, not the stop reason, so a first-POST failure (`http-request-failed`, whose category comes from `safeFailure`) qualifies too (`src/cheerio-search.js:436-453`; `src/http-search.js:194-200`). Diagnostics gain `bootstrapRetries: 1` and `firstStopReason`. No 302 occurred in 30 searches on 1.0.80, so **the retry is untested live** (`docs/EVIDENCE_LEDGER.md:472-475`).

### 3.4 What happens when HTTP does not verify

The checks run in this order (`src/main.js:659-722`):

1. **Deadline.** The HTTP stop reason is `deadline-reached`, or there was a network failure after the deadline. The source becomes `deadline-reached`, later reported as `truncated`/`time-limit`, and its route is `unfinished`.
2. **`browserFallback: false`:**
   - a bound search the cap kept off the HTTP route gets status `request-cap` (0 requests);
   - otherwise `extraction-error` with the text "HTTP search unverified; browser fallback disabled." or "This source has no HTTP route; browser fallback disabled." Route `failed`.
3. **Past the deadline:** `deadline-reached`, and no browser is started.
4. **No browser request left:** `extraction-error` "HTTP search was unverified and no browser request remained."
5. **Otherwise, the Playwright browser fallback:**
   - headless, 20 s navigation timeout, up to 12 s wait for first results;
   - each extra page is a wheel scroll of 2,000 px, counted as one request;
   - `.fbcdn.net` and `.fbsbx.com` assets bypass the proxy;
   - results are capped at 500 listings (`src/main.js:152-176,299-360,713`).
   - **In practice it reads about one page** (about 24 listings instead of about 1,300) and costs about 9 times as much. It can still report `sourceBinding: verified` (`docs/EVIDENCE_LEDGER.md:98-110`).
   - An unbound browser page returns every DOM card on the page, unfiltered, and the source becomes `partial`/`source-binding-unverified` (`src/main.js:305-311`; `src/collection.js:235-237`).
6. **Thrown errors.** A message matching `/redirect|challenge|verification|login|HTTP 403/i` becomes status `blocked`; anything else becomes `extraction-error`. The raw message becomes `stopReason` in `RUN_SUMMARY.sourceOutcomes` (`src/main.js:716-722`).

The browser request policy allows only https Facebook-owned hosts (`facebook.com`, `fbcdn.net`, `fbsbx.com`), with no IP literals, credentials or ports. Denials are aborted as `blockedbyclient` (`src/browser-request-policy.js:1-40`).

### 3.5 Source binding (proof that a feed is the requested search)

**Initial page** (`src/source-binding.js:82-115,150-170,185-210`). A GraphQL request binds only when all of these hold:

- It is a single numeric `doc_id` on `facebook.com/api/graphql/`.
- Every query variable equals the URL query **exactly**. The comparison is case-sensitive.
- Every location variable equals the numeric city ID.
- `filter_radius_km` strictly equals the requested radius. When no radius was requested, any value is accepted and reported.
- `commerce_search_sort_by` is null everywhere when no sort was requested, or is `CREATION_TIME_DESCEND` when `newest` was requested.
- There is no cursor.
- The response contains at least one listing ID.
- All candidates share one operation and one page signature.

**Continuation pages** (`src/source-binding.js:212-229`). Each must have the same operation, query, location and controls, carry exactly the previous end cursor, and add at least one unseen ID. A matching page that holds only seen IDs stops the read with `continuation-no-new-listings`.

**`searchControls`** is `{radiusKm (1 dp), sort, latitude (3 dp), longitude (3 dp)}`, taken from the bound request (`src/source-binding.js:172-179`). It appears in `RUN_SUMMARY.searches[].searchControls` only with `sourceDiagnostics`. Use it to confirm the centre and area Facebook actually used.

**Listing rows** carry `sourceUrls` (every input URL that returned the listing) and `sourceBindings` (`{url: 'verified'|'unverified'|'unknown'}`). When a verified source later sees a listing first stored from an unverified source, the stored copy is replaced (`src/collection.js:208-231`).

### 3.6 City IDs and centres

Every search card carries `location.reverse_geocode.city_page.id`, and these IDs work as `cityId` (`docs/EVIDENCE_LEDGER.md:39-49`).

- **Card `location` strings are ambiguous** ("Hove" is the page "Brighton and Hove"), so prefer the city-page ID.
- **The seed file** `docs/data/city-pages.seed.json` has 771 city pages, with fields `cityPageId` (a string), `name`, `towns`, `lat`, `lng`, `listingsSeen` and `verifiedAsSearchCentre`.
- **Five centres are flagged verified:** Belfast `109312942421526`, Chichester `115935195086622`, Dublin `110769888951990`, Edinburgh `115753025103602` and Glasgow `106233566079281`. Their `lat`/`lng` are null in the seed. The ledger gives Edinburgh (55.955, −3.209), Belfast (54.597, −5.930) and Dublin (53.348, −6.259) (`docs/EVIDENCE_LEDGER.md:50-66`).
- **Rotherham `112991942045237`** bound on the fast route, but it is not flagged in the seed.
- **Measured centres** also exist for Chichester (50.836, −0.775; `docs/validation/GATEWAY_ADVERSARIAL_REVIEW_2026-09-23.md:51-53`) and Rotherham (53.434, −1.355; `docs/EVIDENCE_LEDGER.md:45-47`). Glasgow has none. Seed `lat`/`lng` are town-level approximations ("verify before use as search centres", the seed's `source` field): Rotherham's seed point (53.4732, −1.3019) is about 5.6 km from Facebook's measured centre. Use `RUN_SUMMARY.searches[].searchControls` as the centre of record.
- **Ireland is a separate feed** with EUR prices. Belfast feeds held no Republic of Ireland listings, so Ireland needs its own centres.

### 3.7 Feed behaviour (evidence, mostly one location over 2–3 days)

- **Depth.** A full read returns about 750–1,330 listings over 32–56 pages and ends at the first repeat-only page. Facebook never sent `has_next_page:false` (`docs/EVIDENCE_LEDGER.md:111-118`).
- **Feeds are broad.** Only 9% of the `3090` feed mentioned 3090. The search does not match descriptions (`docs/validation/GATEWAY_ADVERSARIAL_REVIEW_2026-09-23.md:30-31`).
- **Short or long feed at random.** A default-order search returns either a short local feed (about 90 listings, 4 pages, within about 100 km) or a long nationwide feed (about 1,300). Radius does not decide which, and the trigger is unknown. About 3 of 14 full `3090` reads were short (`docs/EVIDENCE_LEDGER.md:131-145`).
- **Radius.** It is bound and reported, but no effect on results has been shown (`docs/EVIDENCE_LEDGER.md:146-151`).
- **Newest-first.** Strictly time-ordered, within about 115 km, and not filtered by radius. Page 1 held about 10 days of `3090` listings. It missed 11% (within 65 km), 24% (within 100 km) and 41% (within 115 km) of related listings, and lagged by hours (`docs/EVIDENCE_LEDGER.md:152-165`).
- **Repeatability.** Full-depth repeats overlap 87–95% (Jaccard). Common terms such as `sofa` cover only a few days before the count cap (`docs/EVIDENCE_LEDGER.md:119-127`).
- **Deep burial.** A PC with its GPU only in the description sat at position 1,852 of 2,400 in a `gaming pc` sweep (`docs/EVIDENCE_LEDGER.md:246-249`).
- **Search cards carry:** title, price, town, city page, `listedAt` (Unix seconds), primary photo, delivery types, category ID and, when one exists (about 21% of rows, 39.9% of desktop PCs), the "was" price. They carry **no coordinates** (0 of 1,268 rows) and almost never seller-entered attributes such as Condition or Brand (15 of 5,503); about 8% of card rows do carry the seller object (`docs/EVIDENCE_LEDGER.md:174-177,196-199`; `docs/validation/PARTS_PRICE_ANALYSIS_2026-09-24.md:116-128`; `docs/design/SELLER_DATA.md:31-47`).

### 3.8 Scheduling inside a run

`collectSources` runs searches and raw URLs **one at a time, in order**. Listing-ID sources then run in parallel batches of `detailConcurrency`, each reserving `itemReserve` requests and needing a free result slot (`src/collection.js:124-147,268-310`; `src/main.js:723-728`).

Each call receives `pageBudget = min(maxPagesPerSource − pages, maxRequests − requests)`. Reported usage is clamped to the budget (`src/collection.js:149-167`).

The loop stops when listings reach `maxListings`, requests reach `maxRequests`, or the deadline passes. When details are on, discovery's deadline is half of `maxRunSeconds` (`src/main.js:587-592`).

### 3.9 Source statuses and stop reasons

The table below covers `RUN_SUMMARY.sourceOutcomes[].status/stopReason` and the sanitised dataset fields `sourceStatus`/`sourceStopReason` (`src/collection.js:4-8,149-318`; `src/source-outcomes.js:6-11,44-55`).

| Status | Stop reason | Meaning | App action |
|---|---|---|---|
| `complete` | `source-exhausted` | The HTTP feed reported its end, or an item source was fetched | Coverage complete. Rare for searches |
| `truncated` | `source-no-new-listings` | The next page held only listings already seen: the normal end of a full read | Treat as the end of the feed |
| `truncated` | `page-cap` | Our `maxPagesPerSearch` was reached while Facebook still had pages | More exist. Raise the page cap if needed |
| `truncated` | `results-limit` | The run-wide `maxListings` was reached | Raise `maxListings` or split runs |
| `truncated` | `source-results-limit` | The per-source cap or the HTTP `listing-cap` was reached | As above |
| `truncated` | `time-limit` | The deadline stopped it (never reported as a failure) | Rerun or give more time |
| `truncated` | `request-cap` | `maxRequests` was reached | Rerun or raise the cap |
| `truncated` | `continuation-unavailable` | A continuation failed, was unverified or had an invalid template; also every browser-fallback read | Degraded: rerun |
| `partial` | `source-binding-unverified` | Rows came from an unverified browser page (DOM cards) | Degraded. Rows may be off-query or off-area |
| `blocked` | raw message (`blocked` in dataset rows) | redirect, challenge, login or 403 | Rerun later; alert if it repeats |
| `extraction-error` | raw message (`extraction-error` in dataset rows) | Failed, including the `browserFallback:false` messages | Rerun |

- **Unreachable or defensive values.** `verified-empty` for searches, `source-confirmed-empty`, `cursor-cycle-or-no-progress` and `invalid-page-contract` cannot occur for searches in current code (`src/collection.js:95,192-201,253-260`; `src/cheerio-search.js:369`).
- **Empty searches.** Binding needs at least one listing ID (`src/source-binding.js:195-196`), so **a genuinely empty search always ends `extraction-error` (or `failed`)**. The app cannot tell "no results" from "failed".
- **Dataset mapping.** In dataset rows, any stop reason not on the allow-list (such as v2's `match-limit`) becomes `other` (`src/source-outcomes.js:54-55`).

**HTTP-route stop reasons** appear in `searches[].httpStopReason` and in diagnostics (`src/http-search.js:188-265`; `src/cheerio-search.js:277-324,428-432`):

- `deadline-reached`
- `http-request-failed`
- `source-binding-unverified`
- `continuation-template-invalid` (rewritten to `continuation-unavailable` when the feed still had a next page)
- `continuation-request-failed`
- `continuation-no-new-listings`
- `continuation-unverified`
- `page-cap`
- `listing-cap`
- `continuation-unavailable`
- `source-unsupported`
- `request-cap`
- `bootstrap-request-failed`
- `bootstrap-route-changed`
- `bootstrap-byte-limit`
- `bootstrap-non-html`
- `request-template-unavailable`

The `failureCategory` values are `network`, `timeout`, `redirect`, `http-status`, `non-json`, `parse`, `byte-limit`, `binding`, `template` and `non-html`, plus `httpStatus` (an integer from 100 to 599) where known (`src/http-search.js:8-21`).

### 3.10 `searches[].route` and degraded searches

This logic is in `src/gateway-summary.js:17-25`.

| `route` | When | Treat as |
|---|---|---|
| `http` | Verified HTTP read | Good **only** when `stopReason` is `source-no-new-listings` or `source-exhausted`; `page-cap`, `results-limit` and `source-results-limit` mean our own cap stopped a healthy read. A verified read that stopped partway still says `route: http`: cut mid-feed by the deadline (`truncated`/`time-limit`), or a continuation request that failed, was unverified or had an invalid template (`truncated`/`continuation-unavailable`, since the HTTP route still returns `status: ok`, `sourceBinding: verified`) (`src/http-search.js:215,230-243,256-266`; `src/main.js:646-657`; `src/collection.js:253-257`). Treat those as degraded. A tight run-wide `maxRequests` can also appear as `page-cap`, because the route reads at most min(`maxPagesPerSearch`, remaining requests − 1) pages (`src/cheerio-search.js:328`; `src/collection.js:304-305`) |
| `unfinished` | `deadlineReached` is true, or `stopReason` is `request-cap`, **for a search that was reached** | Degraded: rerun |
| `failed` | The HTTP route failed with `browserFallback: false` | Degraded: rerun |
| `browser-fallback` | HTTP unverified, so the browser was used | Degraded (about 1 page): rerun |
| `null` | `sourceDiagnostics` off; or HTTP never attempted (unbindable URL, or budget below `2 + reserve`) and the browser used; or a thrown error; **or the search never started** because the run reached `maxListings`, `maxRequests` or the deadline first (status `truncated`, stop reason `results-limit`/`request-cap`/`time-limit`, `pages: 0`, no diagnostics; `src/collection.js:299-303,311-317`; `src/gateway-summary.js:23`) | Unknown: treat as degraded unless the status is `complete` |

The README says `failed` also covers "the run deadline arrived first" and never mentions `unfinished`. The code is authoritative (§11).

The design adds a further degraded signal: a newest-first check whose page 1 does not overlap the previous check (`docs/design/CONTAINER_LISTINGS.md:189-193`).

### 3.11 When the whole run fails

After writing the dataset and `RUN_SUMMARY`, the run throws, so its Apify status is **FAILED**, only when **no candidate was collected and every source is `blocked` or `extraction-error`**: "All Marketplace sources were blocked or could not be extracted; see RUN_SUMMARY for per-source outcomes." (`src/main.js:977-979`).

- **Listing-ID runs never fail this way.** Unresolved IDs are appended as placeholder rows, so the candidate count is above zero (`src/main.js:740-744`).
- **Searches-only runs can.** If every search fails with fallback off, or every search is genuinely empty, the run is FAILED.
- **Other failure modes:**
  - input errors fail the run with nothing written (§2.4);
  - an aborted or timed-out run (including an account billing-cap abort) writes nothing (`docs/EVIDENCE_LEDGER.md:309-310`; `docs/validation/DETAIL_CACHE_REPEAT_2026-09-22.md:49-61`);
  - a non-v3 input below 1,024 MB throws before running.

---

## 4. How details work

### 4.1 Where item fetches happen

- **Discovery, for `listingIds` sources.** `fetchMetadataCounted` tries the graphql replay (if selected), then the item page. After that it may fall back to the browser (one browser at a time) if `browserFallback` is on and the budget allows (`src/main.js:548-627`). A successful ID is marked `detailAttempted:true`, `detailAttempts:1` and `detailOutcome` `collected` or `metadata-only`. `collected` means `full_verified`, or photos, attributes or a category name were present (`src/main.js:729-739`).
- **The detail pass (`enrichListings`).** It runs for every listing when the pipeline is on (always in v3). It skips cache reuses and direct IDs already `full_verified` (`src/main.js:799-872`), so a direct ID whose discovery fetch did not reach `full_verified` is fetched a second time (§4.2). It has these properties:
  - `detailConcurrency` workers;
  - each fetch reserves 2 requests on graphql or 1 on page, and unused requests are refunded (`src/details.js:112-169`);
  - `maxDetails` caps requests (`src/details.js:139`);
  - output order equals input order (`test/details.test.js:324-346`).
- **With `includeDetails: false`,** every search listing gets `not-requested-cap`.
- **All errors are swallowed.** Network errors could contain a proxy URL with credentials, so `detailError` is deliberately generic (`src/main.js:579-583,825`).

### 4.2 The graphql route (default)

- **Bootstrap.** Per sticky proxy session (an in-memory cookie jar of at most 64 cookies), the first listing's full item page is fetched. Its preloaded `MarketplacePDPContainerQuery` becomes the template. Later listings replay it to `https://www.facebook.com/api/graphql/` with only `targetId` changed (`src/item-graphql.js:7-75,126-139`).
  - A template must be unique and must contain exactly one `targetId` equal to the bootstrap listing.
  - Replies are capped at 2 MiB, with a 15 s timeout (`src/item-graphql.js:14,77-124`).
- **Acceptance.** A reply is accepted only if it holds a `GroupCommerceProductItem` with **exactly** the requested ID **and** a `full_verified` description (`src/item-graphql.js:265-289`).
  - Otherwise the failure is `description-missing` or `identity-unverified`, costing 1 request. The caller then fetches the item page, a second request.
  - **Listings whose seller wrote no description therefore always cost a failed replay plus a page, and count against the breaker** (`src/item-graphql.js:269-275`).
  - **Second fetch in `listingIds` runs.** In a `listingIds` run, an ID whose discovery fetch did not reach `full_verified` (no description, Open Graph only, or a failure) is fetched once more by the detail pass (`detailAttempts` 2; `src/main.js:858-861`; `src/details.js:219`), and is not retried after that (`src/details.js:249`). On graphql a listing without a description therefore costs up to 4 requests: a failed replay plus a page, twice. The 1.0.82 50-ID check spent 4 of its 55 requests this way (`docs/EVIDENCE_LEDGER.md:241-243`). `detailRetryCount` counts these second fetches as retries.
- **Sessions.** A session rotates after `detailSessionSize` replays (default 40), after 3 consecutive failures, or when it has no template (`src/item-graphql.js:167-183`).
- **Bootstrap failures.** Three failed bootstraps disable replays for the run (`src/item-graphql.js:228`).
- **Circuit breaker.** Once at least 20 replays have completed with under 85% success, replays stop for the rest of the run (`src/item-graphql.js:161-176`; `README.md:53-56`). The thresholds are fixed and cannot be set from the input.
- **Failure categories** in `RUN_SUMMARY.detailRoute.failures` (`src/item-graphql.js:100-119,171,200-201,238,259,270,284`):
  - `description-missing`, `identity-unverified`
  - `invalid-request`, `network`, `redirect`, `http-status`, `parse`, `empty`, `byte-limit`, `error`
  - `bootstrap-no-template`, `bootstrap-<category>`, `bootstrap-deadline`
- **No photo gallery.** The media query is not replayed, so graphql rows carry no photo gallery, except the bootstrap listing of each session (`src/item-graphql.js:11-12`; `docs/EVIDENCE_LEDGER.md:217-219`).

### 4.3 The page route

- **Request.** A cookie-less `GET` of the item page: `redirect:'manual'`, `credentials:'omit'`, up to 2 MiB, 15 s (`src/main.js:522-526`).
- **Redirects.** At most 2, and only when the listing's reservation covers them. In the page-route detail pass the reservation is 1, so **no redirect is followed** (`src/main.js:567`).
- **Identity.** Every `Location` and the final URL must be the same listing ID, else "Item request changed listing identity." (`src/http-item.js:9-15,66-90`). Non-200, non-HTML or oversize responses fail.
- **Structured extraction** (`src/item-structured.js`). Only `<script type="application/json" data-sjs>` blocks are parsed. Only `GroupCommerceProductItem` nodes with `id === requestedId` are used. A whitelisted projection is kept (`src/item-structured.js:13-156`).
  - **Fail-closed limits.** The result is `null` if the HTML exceeds 8 MiB, there are more than 256 scripts, a script exceeds 4 MiB, the JSON has a parse error, the node count exceeds 100,000 or the depth exceeds 80, there are more than 8 description matches, or matches disagree on description, title or price (`src/item-structured.js:1-11,211-277`).
  - **Conflicting enrichment fields** are dropped while a verified description is kept.
- **Open Graph fallback.** If structured extraction yields nothing, the `<head>` Open Graph tags are used. The canonical URL must be the same ID, and the title must not be generic. The result is at best `partial` (`src/item-seo.js:5-38`; `src/http-item.js:144-151`).

### 4.4 How item data merges onto a card (and two surprises)

`mergeListingDetails` (`src/details.js:26-110`).

**Recording.** Each disagreement goes to `conflicts[]` as `{field, searchValue, detailValue}`. `sourceFields.detail` (and `sourceFields.seo`) hold the raw item object, and `sourceFields.search` keeps the card.

**Label.** In v3, every item result is normalised with source label `seo` (`src/main.js:826`; `src/marketplace.js:417`). So `provenance.title`, `price`, `location`, `locationCoordinates` and `imageUrl` read `seo`, and **those five never replace a non-empty card value**. The exception is a longer description (`src/details.js:46-58`).

**Overwrite rule.** `money`, `currency`, availability flags, the price groups and all other detail fields **do** overwrite the card value.

**Consequences:**

- **`price` and `money` can disagree after enrichment.** If the card showed £100 and the item £80, `price` stays 100 (the card) while `money.amountMinor` becomes 8000 and `currency` comes from the item, with a `conflicts` entry. This was verified offline (`src/details.js:61-63`). **Use `money` as the price.**
- **`locationDetails` is replaced by the item projection,** which keeps only lat/lng/name and `reverse_geocode {city, state, country}`. **`city_page.id` is lost** on enriched rows (`src/item-structured.js:93-98`; `src/details.js:6,64-69`), contrary to `README.md:115` and `.actor/input_schema.json:27`. Record the city page from the card at search-ingest time. It also survives in `sourceFields.search` on merged rows.
- **`sourceFields.seo` is not only Open Graph data.** It holds the whole structured item object, including seller data.
- **`detailOutcome: 'collected'` does not mean a description was read.** Any parsed price counts as a structured fact (`src/details.js:43-45,59-63,101`).

### 4.5 Description verification: `descriptionStatus` and `descriptionComplete`

**`descriptionStatus`** is documented as the enum `full_verified` | `partial` | `missing`, nullable (`.actor/dataset_schema.json:580-586`):

- `full_verified`: the exact-ID `GroupCommerceProductItem.redacted_description.text` was read. It certifies nothing else: not other fields, not freshness, not private text.
- `partial`: Open Graph teaser text (about the first 200 characters in samples, `docs/EVIDENCE_LEDGER.md:184-188`), card text, or any unverified text.
- `missing`: no non-blank description.

**`descriptionComplete`** (the undocumented field) is a boolean on **every** v3 listing row. `gatewayRows` spreads the whole listing into the row (`src/gateway-summary.js:4-10`), and the dataset schema allows undeclared properties (`additionalProperties: true`). No `.actor` schema, `README.md` or doc mentions it. Every path that emits a row sets both fields together:

```js
// src/marketplace.js:227-228, 284-286 (normalizeListing)
const descriptionComplete = Boolean(description && listing.descriptionComplete === true
    && listing.descriptionStatus === 'full_verified');
... descriptionStatus: descriptionComplete ? 'full_verified' : description ? 'partial' : 'missing',

// src/details.js:13-24 (withDescriptionStatus: run on enriched, retried, cached, placeholder and direct-ID rows)
const descriptionComplete = descriptionPresent && listing.descriptionComplete === true;
... descriptionStatus: descriptionComplete ? 'full_verified' : descriptionPresent && description.trim() ? 'partial' : 'missing',
```

The only producer of `true` is structured extraction of an exact-ID, non-blank `redacted_description` (`src/item-structured.js:254-262,313-315`). The Open Graph fallback forces `false` (`src/http-item.js:146-149`). A merge keeps `true` only if the detail's own flag and status were verified and its description won the merge, or if the card was already verified and its description is unchanged (`src/details.js:102-109`).

**Result:** on every emitted v3 row, `descriptionComplete === (descriptionStatus === 'full_verified')`. Descriptions are trimmed strings or null, because `firstString` trims (`src/marketplace.js:22`). **Search-only rows always have `false`/not `full_verified`.**

**What Nabvy should do (Supabase and contracts):**

1. **Make `descriptionStatus` the source of truth.** Store it as `text` with `CHECK (description_status IN ('full_verified','partial','missing'))`.
   - `NOT NULL` is safe for v3 rows, since every row path sets it. Map an absent value to `missing` at ingest.
   - Per `nabvy:CLAUDE.md`, the schema is defined in Drizzle (`packages/db`) and migrated with `pnpm db:generate` / `pnpm db:migrate`. Do not add columns by hand in the Supabase dashboard.
2. **Do not create an independent `description_complete` column.** If a boolean is convenient, make it a generated column: `boolean GENERATED ALWAYS AS (description_status = 'full_verified') STORED`.
3. **In the Zod provider-output schema:**
   - accept `descriptionComplete: z.boolean().optional()`, because an unexpected key must not break ingest;
   - add a refinement that logs an anomaly if it disagrees with `descriptionStatus`, and trust `descriptionStatus`.
   - Never set `descriptionComplete` yourself. The actor's own matcher treats **either** flag as proof (`src/query-matching.js:99-100`), so a stray `true` on an app-built row would turn `unknown` into `no-match`.
4. **Run text AI only on `full_verified` text.** Treat `partial` as a possible teaser that needs a refresh. Never read absence of a fact in `partial` or `missing` text as a negative (`docs/design/CONTAINER_LISTINGS.md:167-185`).
5. **Do not re-queue forever.** A detailed row with `descriptionStatus: 'missing'` may be a listing with no description: 2 of 10 sofa listings in the 1.0.82 check (`docs/EVIDENCE_LEDGER.md:237`). About 1–2% stay missing for unknown reasons (`:189-190`). Cap the retries.
6. **If the cache is ever enabled,** `full_verified` on a `stale-fallback` or `deferred` row is old evidence (`src/detail-cache.js:104-170`). The cache is off in Nabvy's presets.

### 4.6 `detailOutcome`, retries and `detailError`

| `detailOutcome` | Meaning | Re-queue? |
|---|---|---|
| `collected` | Structured detail merged. It does **not** imply a description | Only if `descriptionStatus` is not `full_verified` (with a cap) |
| `metadata-only` | An Open Graph-only item response | Yes, once |
| `extraction-error` | The fetch failed or did not identify the listing; `provenance.description` is `extraction_failed` if nothing was found | Yes, with backoff |
| `not-requested-cap` | `maxDetails` was spent | Yes (not attempted) |
| `not-requested-request-cap` | `maxRequests` was spent | Yes (not attempted) |
| `not-requested-time-limit` | The deadline arrived first, or the fetch sent nothing | Yes (not attempted) |
| `cache-hit`, `cache-deferred` | Cache only | n/a |
| (absent) | Does not occur in v3: every listing row carries a `detailOutcome` (the detail pass runs whenever there are listings and appends every row with an outcome, `src/main.js:802`; `src/details.js:173,189-207`; search rows with `includeDetails: false` get `not-requested-cap`). `RUN_SUMMARY.detailOutcomes` would count a missing one as `not-requested` (`src/main.js:915-918`) | n/a |

Sources: `src/details.js:43,101,147,189-235`; `src/detail-cache.js:162-164`.

**Retry.** In candidate mode (always in v3), rows whose first attempt gave `extraction-error`, `metadata-only`, or `collected` without `full_verified` get **one** retry, after every listing has had a first attempt. So `detailAttempts` is at most 2 (`src/details.js:241-283`).

- A failed retry **keeps the first `detailOutcome`** (for example `collected`) and adds `detailError`.
- A successful retry clears `detailError`.

**`detailError` values** are fixed strings, never exception text:

- "Public item metadata did not identify this listing."
- "The run deadline arrived before this listing could be fetched."
- "Requested Marketplace item was not identified from its public item route."
- "Detail response did not identify the requested listing."

Sources: `src/main.js:820-828`; `src/direct-item-candidates.js:4-6`; `src/details.js:31-33`. For category counts on the graphql route, use `RUN_SUMMARY.detailRoute.failures`.

### 4.7 Photos

**Galleries** come only from structured item pages, so use the page route (`src/item-structured.js:178-209,299-312`).

- Up to 40 validated photos are kept (`MAX_PHOTOS`). Each URL must be https on fbcdn.net, fbsbx.com or facebook.com, with no credentials or port, and at most 4,096 characters.
- Each photo keeps `image{uri,width,height}`, an `id` and `accessibility_caption`.
- `photoGalleryTotal` is the raw count.
- `photoGalleryComplete` is true only when the validated count equals the raw count. It is false for a gallery of more than 40 photos, and null when no gallery was exposed.

**Photo links:**

- They are signed CDN links with an `oe` expiry **about 104–108 hours** after collection (`docs/EVIDENCE_LEDGER.md:288-289`).
- `imageUrl` is **not** host-validated, unlike `photoUrls` (`src/marketplace.js:262-274`).
- An expired link must trigger a refresh, never a "not visible" verdict (`docs/design/CONTAINER_LISTINGS.md:48-49,174-175`).
- **Display only.** Photo links are for display through the listing only. Never fetch `photoUrls` or `imageUrl` from Nabvy's servers or from an AI provider: a photo download counts as Facebook traffic and must run inside Apify (`docs/design/CONTAINER_LISTINGS.md:46-56`), and the actor cannot fetch photos yet (`capturePhotos` is a proposed feature, `docs/design/CONTAINER_LISTINGS.md:97-107`; no photo capture or media query exists in `src/`; test T3 has not run). Until that feature exists, photo review is blocked. Record each link's `oe` expiry (about 104–108 h) so a later capture run refreshes the item first. Once capture exists, the bytes go to Nabvy storage, are deleted after review, and are never served to users (`nabvy:docs/decisions.md:23`, Precedence row "Photos").

### 4.8 SEO (Open Graph) fallback

`extractItemSeoCandidate` reads only `<head>` and requires:

- a canonical item URL with the same ID;
- a non-empty `og:title` that is not "Facebook", "Marketplace" or "Facebook Marketplace";
- a non-empty `og:description`.

`og:image` is kept only on trusted Facebook CDN hosts (`src/item-seo.js:5-38`). The result gives `detailOutcome: 'metadata-only'` and `descriptionStatus: 'partial'`.

### 4.9 Direct `listingIds`: unresolved rows and `resolvedByDetailPass`

- **Unresolved rows.** Each requested ID that discovery did not return is appended as a placeholder row (`src/direct-item-candidates.js:9-46`) with:
  - `listingId` and `listingUrl`;
  - `sourceUrls` and `sourceBindings`;
  - `directItemUnresolved: true`;
  - `descriptionStatus: 'missing'`;
  - `detailOutcome` of `not-requested-time-limit` (every outcome time-limited and no page sent) or `extraction-error`, with a fixed `detailError`. These are discovery's values. The detail pass may fetch the row afterwards, or rewrite an unattempted `extraction-error` to `not-requested-cap`/`not-requested-request-cap` (`src/details.js:189-195,205-207`). It keeps `not-requested-time-limit` and attempted `extraction-error`. A rewritten row still carries `directItemUnresolved: true` and the "not identified" `detailError`, although no request was sent (§2.5).
- **Resolved by the detail pass.** If the detail pass later collects the ID, `directItemUnresolved` and `detailError` are removed (`src/details.js:34-36`). Its `sourceOutcome` row gets `resolvedByDetailPass: true` when the source was not `complete` and the pass fetched it with outcome `collected` or `metadata-only` (`src/main.js:873-882`). **Treat such IDs as resolved; do not pay for them again.**
- **Verification status.** Removed or sold IDs produce unresolved rows. This was verified on v2 build 1.0.74 but not yet on v3 (`docs/EVIDENCE_LEDGER.md:254-255`).
- **Double counting.** A requested ID that a search in the same run also returned is marked `detailAttempted: true`, `detailAttempts: 1` and, for a normal card, `detailOutcome: 'metadata-only'`, before any item fetch. (It is `collected` only if the card already had a `full_verified` description, photos, attributes or a category name, which a search card lacks; `src/main.js:733-738`; `docs/EVIDENCE_LEDGER.md:174-177,196-199`.) If the detail pass then skips it for a cap, those values stay (`src/details.js:189-195`), so the row claims an attempt that never ran. This inflates `detailAttemptedCount`.

### 4.10 Detail cache (off in v3; keep it off)

- **Storage.** The cache is a named key-value store, `marketplace-detail-cache-<24 hex of sha256(ACTOR_ID\0APIFY_USER_ID)>`, with keys `ITEM_<id>`. It is scoped to the actor and the Apify account and **never evicted** (`src/detail-cache.js:96-101,173-293`).
- **Timing.** TTL 6 h; failed or incomplete records wait 60 min before a retry.
- **Statuses.** `detailCacheStatus` takes the values `miss`, `refresh`, `hit`, `deferred`, `stale-fallback` and `write-error`. `write-error` is missing from the schema.
- **Concurrency.** There are no atomic leases, so run one cached detail run at a time (`README.md:275-276`).
- **Why off.** The v3 default is off: "the calling app keeps the one durable copy" (`src/gateway-input.js:133-134`). Snapshots include seller data, which would be a second durable copy in Apify, and that is forbidden (`docs/HANDOFF.md:221`; `docs/design/SCALE_PLAN.md:76-77`). Cache lookups were also 21% of a sweep's cost (`docs/EVIDENCE_LEDGER.md:329-330`).

### 4.11 `responseInventory` (diagnostic)

- **What it records.** Structure only: key paths and counts from item pages and accepted replies, never values. The output goes to `RUN_SUMMARY.responseInventory.{page,graphql}` (`src/response-inventory.js:1-143`).
- **Cost.** No extra requests.
- **Finding so far.** It showed that item pages embed about 26 other listings (20 complete browse cards) and 10 related search terms (`search_pivots`). These are not yet emitted as output (`docs/EVIDENCE_LEDGER.md:256-280`).

### 4.12 Route-health helper (app-side)

`app/route-health.js` exports `recommendDetailRoute(history, state, options)`, a pure function **for the calling app** (ADR 0002). Nabvy should port it to TypeScript; it is listed as code to copy in `nabvy:docs/fb-actor-sources.md`.

**Defaults** (`app/route-health.js:6-20`): `minSuccess` 0.95, `minAttempts` 50, `windowRuns` 10, `probeEvery` 10, `minProbeAttempts` 20, `minFailedBootstraps` 2.

**Input.** `history` holds that region's `RUN_SUMMARY.detailRoute` objects, oldest first, **each with its Apify `runId` added**. A page-route run is stored as `{runId, route:'page'}`. Pass the `detailRoute` sub-object: `detailRequests` inside it counts replays, while the top-level `RUN_SUMMARY.detailRequests` counts detail-pass requests.

**Output.** `{route, reason, successRate, attempts, newQueryIds, alert, state}`. Persist `state` per region, and use `route` as the next run's `detailRoute`.

**Rules** (`app/route-health.js:54-97`):

- **On graphql:**
  - switch to `page` (`alert:true`) on `circuit-open`, on `bootstrap-failing` (0 replays and `failedBootstraps ≥ max(2, bootstraps)`), or on `low-success` (at least 50 attempts and under 95% success);
  - otherwise stay (`healthy` / `insufficient-data`). New `queryIds` set `alert`.
- **On page:**
  - every 10th call returns `graphql` / `probe`;
  - recovery (`recovered`, `alert:true`) needs at least 20 probe attempts with at most `floor(0.05 × attempts)` failures;
  - otherwise `probe-failed`, or `probe-inconclusive` after 10 probe runs, or `still-unhealthy`.
- **Idempotent** when the latest entry's `runId` matches `state.runKey`. Only the last 11 entries are read.

**Duties.** A probe decision must actually be run on graphql. Raise an operator alert on `alert:true`: a new `queryId` means Facebook deployed a change (`README.md:59-61`).

**Caveat: description-less listings count as failures.** The helper (`attempts = detailRequests`, `ok = detailOk`; `app/route-health.js:13-14,54`) and the in-run breaker (`src/item-graphql.js:172-176`) count a reply for a listing with no description (`detailRoute.failures['description-missing']`, `src/item-graphql.js:269-274`) as a failed replay. Fed the 1.0.82 live check (47 of 50 replays; 3 `description-missing`; `docs/EVIDENCE_LEDGER.md:237,241-243`), one run with the default options returns `page` / `low-success` / `alert: true` (`successRate` 0.94; verified offline). A batch where more than 15% of listings lack a description also trips the breaker after 20 replays. Before porting, record a decision in `nabvy:docs/questions.md`: either subtract `failures['description-missing']` from attempts in Nabvy's port, or batch IDs by category, so that description-less listings do not force a region onto the page route.

---

## 5. Output

### 5.1 Where it goes and when

**Write order** (`src/main.js:946-953`):

1. `Actor.pushData(listing rows)`, if there are any;
2. `Actor.pushData(sourceOutcome rows)`;
3. `Actor.setValue('RUN_SUMMARY', …)`.

**Rows and `RUN_SUMMARY` are written only at the end.** Crawlee's own state records (statistics and search session-pool state, about 10 writes per check; `docs/design/GAP_ANALYSIS.md:52`; `src/cheerio-search.js:409`) reach the run's default key-value store during the run, so that store holds more than `RUN_SUMMARY`. The gateway reads only the dataset and the `RUN_SUMMARY` record, never copies the whole store, and runs use the shortest retention.

**Locations** (`.actor/output_schema.json:5-18`):

- dataset: `{{links.apiDefaultDatasetUrl}}/items`
- summary: `{{links.apiDefaultKeyValueStoreUrl}}/records/RUN_SUMMARY`

The key-value store schema still describes `RUN_SUMMARY` as "for v2 runs" (`.actor/key_value_store_schema.json:8`). It is written for v3 too.

**Row types.** Filter on `recordType`:

- `listing`: one per distinct listing, including placeholders for unresolved IDs;
- `sourceOutcome`: one per source.

Listings appear once per run, deduplicated by ID, and one row can come from several searches.

### 5.2 Listing row fields

Sources for this section: `src/marketplace.js:282-348` (base fields), `src/collection.js:213-231` (`sourceUrls` and `sourceBindings`), `src/details.js:37-44,189-233` (detail fields), `src/detail-cache.js` (cache fields), `src/direct-item-candidates.js:32-43` (unresolved IDs) and `src/gateway-summary.js:4-10` (`recordType`, `collectedAt`, `foundBySearchTerms`).

In the tables, "card" means a search card and "item" means a detail fetch.

**Identity and provenance of the row**

| Field | Type | Notes / reliability |
|---|---|---|
| `recordType` | `'listing'` | Always |
| `platform` | `'facebook'` | Always |
| `listingId` | string of 1–30 digits | **Store as text.** IDs exceed `Number.MAX_SAFE_INTEGER` (`docs/IMPLEMENTATION_PLAN.md:91`) |
| `listingUrl`, `url` | string | Always rebuilt as `https://www.facebook.com/marketplace/item/<id>/` |
| `collectedAt` | ISO string | End-of-run time, the same for every row in the run |
| `foundBySearchTerms` | string[] | Terms whose search URL returned it. `[]` for ID-only rows |
| `sourceUrls` | string[] | Every input URL that returned it |
| `sourceBindings` | `{url: 'verified'\|'unverified'\|'unknown'}` | Treat rows whose bindings are all unverified or unknown as possibly off-query |

**Price**

| Field | Type | Notes |
|---|---|---|
| `money` | `{kind, amountMinor, currency, exponent, display, rawAmount}` | **Use this.** `kind` is `fixed` \| `free` \| `unknown` \| `ambiguous` (`src/money.js:1-50`). Integer minor units |
| `price` | number (major units) or null | Card value survives enrichment and can disagree with `money` (§4.4). `0` means free |
| `currency` | string | Taken from `money`. `£` → GBP, **any `$` → USD**, `€` → EUR. Dublin returns EUR. USD rows seen |
| `displayedPreviousPrice` | money or null | The "was" price. On about 21% of rows (39.9% of desktop PCs) (`docs/validation/PARTS_PRICE_ANALYSIS_2026-09-24.md:121-122`). Never use as a price reference (`docs/design/PARTS_INTELLIGENCE.md:88`) |
| `variablePrice` | always `{min, max}` | Each is a money object or null (usually null) (`src/marketplace.js:314-317`) |
| `sourceComparison` | always `{price, type}` | Facebook comparable price. Each usually null (`src/marketplace.js:318-321`) |

**Text**

| Field | Type | Notes |
|---|---|---|
| `title` | string or null | Card title wins over the item title (`provenance: seo`). Never invented (`not_exposed`) |
| `description` | trimmed string or null | Card teaser, or full item text |
| `descriptionStatus` | `full_verified` \| `partial` \| `missing` | **Documented completeness field** |
| `descriptionComplete` | boolean | **Undocumented.** Equals `descriptionStatus === 'full_verified'` (§4.5) |
| `customTitle`, `customSubtitles` | raw | Item only. An empty item array does not erase card subtitles |
| `condition` | string/object or null | From the `Condition` attribute label. Seller-supplied on about 99% of detailed rows (`docs/EVIDENCE_LEDGER.md:196-199`) |
| `attributes`, `detailSections` | raw arrays | Item only. `detailSections` holds the non-Condition attributes |
| `categoryId` | string/number | On cards (ID only) |
| `categoryName`, `categorySlug`, `categoryPath` | strings / string[] | Item only. Path has at most 12 names |

**Location**

| Field | Type | Notes |
|---|---|---|
| `location` | string or null | Town label, ambiguous |
| `locationCoordinates` | `{latitude, longitude, precision:'coarse'}` or null | **Item only; cards have none.** No uncertainty radius. Show no finer than town or distance |
| `locationDetails` | raw object | On cards it holds `reverse_geocode.city_page {id, display_name}`. **Replaced on enrichment and loses `city_page`** |

**Delivery, commerce and status**

| Field | Notes |
|---|---|
| `deliveryTypes` | Raw array (on cards) |
| `shippingOffered`, `messagingEnabled` | Booleans or null (item) |
| `inventoryType`, `inventoryCount` | For example `SINGLE_QUANTITY`. Count is a non-negative integer or null. A multi-quantity listing is a trade-seller signal |
| `listingStatus` | `renderable_listing_status`, for example `AVAILABLE` |
| `availability` | Always an object `{hidden, live, pending, sold}`, each boolean or null (`src/marketplace.js:299-304`). Feeds can include sold rows |
| `viewerIsSeller` | Raw `is_viewer_seller`. Expect false or null, since requests are anonymous (an inference, not measured) |
| `listedAt` | Raw `creation_time` or `timestamp`, in Unix seconds (`docs/EVIDENCE_LEDGER.md:174-177`). Not normalised |
| `originGroup`, `parentListing` | Raw objects |

**Photos and media**

| Field | Notes |
|---|---|
| `imageUrl` | Primary photo. Not host-validated. Signed and expiring |
| `photos` | Validated gallery (page route only), at most 40 entries of `{image:{uri,width?,height?}, id?, accessibility_caption?}`, or null (`src/item-structured.js:190-208,303-310`). A card's raw `listing_photos`, if Facebook ever sent one, would pass through unvalidated (`src/marketplace.js:244`); whether cards ever carry it is not established |
| `photoUrls` | Deduplicated, host-validated, or null |
| `photoGalleryTotal`, `photoGalleryComplete` | Completeness of the gallery (§4.7) |
| `videos` | Sanitised raw video metadata, or null |

**Seller (internal only)**

| Field | Notes |
|---|---|
| `seller` | The listing's `marketplace_listing_seller`, or null (`src/marketplace.js:298`). From an item fetch it is projected to `{id, name, short_name, profile_picture:{uri\|url}}` (picture only on Facebook hosts; `src/item-structured.js:85-91`). From a search card it is Facebook's raw object, unprojected, so the actor does not limit its keys. **Search cards carry it too**: about 8.1% of search rows (page-level, in runs of 24). 94.7% of listings with a known seller got it from a search card. Item fetches found a seller on 7.5% (page route) and 6.3% (graphql) of listings, and 35.3% of listings had one across repeated sightings (`docs/design/SELLER_DATA.md:31-47`). One deep run showed a seller on 18% of rows (`docs/EVIDENCE_LEDGER.md:193`). 85% of seller-known listings carry an opaque rotating token (`docs/design/SELLER_DATA.md:48-49`). Listings-only search runs therefore also deliver seller data, in `seller` and in `sourceFields.search`. Any ingest or redaction step must accept `short_name`, `profile_picture.url` and unknown card keys (Nabvy's redaction v2, `nabvy:supabase/migrations/20260924024000_apify_gateway_redact_v2.sql`, redacts every seller value whatever its key, instead of raising as v1 did) |
| `sourceFields.{search,dom,seo,detail}` | Raw provider objects, **including seller data**. Also 43% of output bytes (`docs/design/GAP_ANALYSIS.md:23`). Never send them wholesale to an LLM (`.actor/dataset_schema.json:526`) |
| `sourceFields.directRequest` | `{id}` on rows created for requested IDs (`src/direct-item-candidates.js:31`; `src/marketplace.js:338`) |

**Diagnostics and detail state**

| Field | Notes |
|---|---|
| `provenance` | Per field: `search`, `dom`, `seo`, `detail`, `not_exposed`, `not_requested`, `ambiguous`, `extraction_failed` or `cached_detail`. `seo` in v3 means "from the item response", not necessarily from Open Graph tags |
| `conflicts` | `{field, searchValue, detailValue}[]`. Only after a merge |
| `detailOutcome`, `detailAttempted`, `detailAttempts` (0–2), `detailError` | §4.6 |
| `directItemUnresolved` | Placeholder row for an unresolved requested ID |
| `detailCacheStatus`, `detailFetchedAt` | Cache only. Absent in Nabvy's presets |

**Legacy fields in the schema that v3 never emits** (§5.5): `targetQuery`, `queryMatch`, `queryMatchStatus` (v2); `sourceQuery`, `targetLocation`, `isNew`, `isExcluded`, `matchedExcludedTerm`, `matchesQuery`, `underMaxPrice`, `notificationStatus` (legacy); `observedAt`, `classification`, `budget`, `distance`, `match`, `value`, `matchStatus`, `valueBand`, `distanceMiles` (Monitor).

### 5.3 `sourceOutcome` rows

Built by `src/source-outcomes.js:38-62`:

| Field | Notes |
|---|---|
| `recordType` | `'sourceOutcome'` |
| `sourceIndex` | Position in source order (§2.2) |
| `sourceUrl` | Sanitised: the query keeps only `query`, `exact`, `latitude`, `longitude`, `radius`, `minPrice`, `maxPrice`, `sortBy`, `daysSinceListed`, `itemCondition`, `deliveryMethod` and `categoryId`; `null` if the URL is not facebook `/marketplace/`. **There is no `listingId` field:** parse the ID from `.../marketplace/item/<id>/` |
| `sourceRoute` | `item` \| `search` \| `category` \| `location` \| null |
| `sourceStatus` | `complete` \| `verified-empty` \| `truncated` \| `partial` \| `blocked` \| `extraction-error` (unknown values become `extraction-error`) |
| `sourceBinding` | `verified`, otherwise `unverified` |
| `sourceStopReason` | An allow-listed code (§3.9), otherwise `blocked` / `extraction-error` / `other` |
| `sourcePages`, `sourceRows` | Non-negative integers or null |
| `resolvedByDetailPass` | Present only when true. **Not in `dataset_schema.json`** |
| `collectedAt` | ISO string |

**Use these rows, not `RUN_SUMMARY.sourceOutcomes`, for anything user-facing.** The raw summary can contain exception text and listing card text.

### 5.4 `RUN_SUMMARY` (v3)

Built by `src/gateway-summary.js:49-64`. Inputs come from `src/main.js:744-746,871-872,911-938`.

| Key | Meaning |
|---|---|
| `inputVersion` | `3` |
| `mode` | `'extract'` |
| `collectedAt` | Same as on the rows |
| `listingsFound` | Number of listing rows |
| `candidateCount` | Equals `listingsFound` in v3 |
| `searchRadiusKm` | Requested radius, or null for the Facebook default |
| `searchSort` | `default` \| `newest` |
| `memoryGuard` | Present only when the guard turned `browserFallback` off |
| `searches[]` | `{term, url, status ('not-started' if missing), stopReason, route, httpStopReason, searchControls, pages (GraphQL pages; bootstrap not counted), sourceBinding, listings (rows found by the term)}` (`:13-33`) |
| `detailOutcomes` | `{outcome: count}`. A missing outcome counts as `not-requested` |
| `detailAttemptedCount`, `detailUnattemptedCount` | The second is `candidateCount − attempted`. Unattempted means not attempted, never failed |
| `detailRetryCount` | Sum of `max(0, detailAttempts − 1)` |
| `descriptionStatuses` | `{full_verified, partial, missing}` counts |
| `detailPageStats` | `{pages, medianKb, p90Kb, descriptionFound, medianDescriptionEndPct, p90DescriptionEndPct}`, or null. Sampled from item pages, at most 10,000 samples |
| `detailRoute` | graphql only: `{route:'graphql', bootstraps, failedBootstraps, detailRequests (replays sent), detailOk, detailFailed, routedToPage, extraRequests, failures{}, queryIds[] (≤10), circuitOpen, medianResponseKb, maxResponseKb}` (`src/item-graphql.js:141-150,297-304`). **Feed this to route-health** |
| `responseInventory` | Only when that option is on |
| `cacheStoreName`, `detailCacheStatuses`, `cacheWriteFailures` | Only when the cache is on |
| `candidateIds` | Up to 5,000 IDs, when `sourceDiagnostics` is on (the default) |
| `requests` | **All Facebook requests**: discovery plus detail, failed replays and redirect hops. Use it for cost accounting |
| `detailRequests` | Requests spent by the detail pass. Not the same as `detailRoute.detailRequests` |
| `sourceOutcomes[]` | Raw and unsanitised: `{url, route, status, stopReason (code or free text), pages, rows, diagnostics?, sourceBinding?, resolvedByDetailPass?}` |

With `sourceDiagnostics`, `diagnostics.httpSearchFirst` holds `{status, stopReason, requestsUsed, pagesUsed, bootstrapBytes, routeRetained, templateFound, failureCategory, httpStatus, bootstrapRetries, firstStopReason, browserFallback, deadlineReached, searchControls}`. The browser's `pageDiagnostics` can hold listing card text (`src/main.js:365-395,455-476`).

### 5.5 Schema gaps (scripted comparison of `.actor/dataset_schema.json`, 86 declared properties, `additionalProperties: true`)

**Emitted by v3 but not declared:**

- `descriptionComplete` (listing rows);
- `resolvedByDetailPass` (`sourceOutcome` rows).

**Declared values that are incomplete:**

- `detailCacheStatus` omits `write-error` (`.actor/dataset_schema.json:556`; `src/main.js:791,905`);
- `detailOutcome` has no enum;
- the README never mentions `route: 'unfinished'`.

**Declared but never emitted by v3 (20):** `targetQuery`, `queryMatch`, `queryMatchStatus`, `sourceQuery`, `targetLocation`, `isNew`, `isExcluded`, `matchedExcludedTerm`, `matchesQuery`, `underMaxPrice`, `notificationStatus`, `observedAt`, `classification`, `budget`, `distance`, `match`, `value`, `matchStatus`, `valueBand`, `distanceMiles`.

**Type notes:**

- `description` is declared `string|object`, but v3 emits only a string or null.
- `categoryId` is `string|number`.
- The dataset "overview" view lists `recordType`, `imageUrl`, `title`, `price`, `currency`, `location`, `foundBySearchTerms`, `descriptionStatus`, `detailOutcome`, `detailCacheStatus`, `photoGalleryTotal`, `listingUrl`, `collectedAt` and the source fields (`.actor/dataset_schema.json:786-884`).

---

## 6. Costs and performance

**Rule: record settled costs only,** read at least 5 minutes after a run ends. Displayed costs have been up to 45% low (`docs/EVIDENCE_LEDGER.md:14-19`). Unit prices on the Creator plan: $0.20/CU, $8/GB residential, $0.005 per 1,000 dataset writes, $0.005 per 1,000 key-value reads (`docs/EVIDENCE_LEDGER.md:323-325`).

| Workload | Figure | Basis | Source |
|---|---|---|---|
| Newest-first page-1 check, 1 term | $0.0022 | settled | `docs/EVIDENCE_LEDGER.md:319` |
| Newest-first page-1, 3 terms batched | $0.0046 (about $0.0015 per term, −31%) | settled, build 1.0.80 | `docs/EVIDENCE_LEDGER.md:331-332` |
| Same on 1.0.82 at 512 MB | $0.0048 (about $0.0016 per term), 26 s, 103 MB peak | **unsettled** (read about 1 min after) | `docs/EVIDENCE_LEDGER.md:239` |
| Each extra HTTP page | roughly $0.0003 | basis not stated | `docs/validation/QUERY_COVERAGE_AND_HTTP_RELIABILITY_2026-09-23.md:136-137`; `.actor/input_schema.json:56` |
| Catch-up, default pages 1–4 | about $0.005 per term | estimate | `docs/design/CONTAINER_LISTINGS.md:64` |
| Short feed, 86 listings / 4 pages | $0.003 | settled | `docs/validation/GATEWAY_ADVERSARIAL_REVIEW_2026-09-23.md:123-126` |
| Full sweep, 1 term (1,320 listings / 55 pages) | $0.031, of which about 21% was detail-cache key-value reads that 1.0.82 defaults do not make (about 40% dataset writes and cache lookups together) | settled, build 1.0.79 | `docs/validation/GATEWAY_ADVERSARIAL_REVIEW_2026-09-23.md:121`; `docs/EVIDENCE_LEDGER.md:316-317,329-330` |
| Full sweep range | $0.003 (settled short feed, 86 listings) to $0.031 (long) per term. The "$0.01 short" in `docs/design/CONTAINER_LISTINGS.md:65` and `docs/HANDOFF.md:144` has no run behind it | settled (both ends) | `docs/validation/GATEWAY_ADVERSARIAL_REVIEW_2026-09-23.md:121,123` |
| Listings only, general | $0.02–0.04 per 1,000 listings | settled | `docs/EVIDENCE_LEDGER.md:316` |
| Browser-fallback search | $0.020 (about 9 times; 16 times the proxy data) | settled | `docs/EVIDENCE_LEDGER.md:104-106` |
| Details, graphql | $0.00092 per listing; 97 KB proxy; 56 s for 20 | settled, paired 20 listings, build 1.0.81 | `docs/EVIDENCE_LEDGER.md:205-216` |
| Details, page | $0.00166 per listing; 170 KB proxy; 120 s for 20 | settled, same pair | same |
| Details, graphql on 1.0.82 | about $0.00094 per listing (50 IDs, 71 s, 142 MB) | unsettled | `docs/EVIDENCE_LEDGER.md:232-238` |
| Details, page on 1.0.82 | about $0.00157 per listing (10 IDs, 44 s) | unsettled | same |
| Schema guidance | "about $0.0015 per listing" with details; "about $0.0003 per result page" without | summary | `.actor/input_schema.json:56` |
| Cold details at scale (page era, cache on) | $1.854 for 1,163 listings (about $1.6 per 1,000), 32 min | settled | `docs/validation/GATEWAY_RTX3090_PROVING_2026-09-23.md:22-24,65-71` |
| Warm cache repeat | about $0.26 per 1,000 (84–92% less) | settled; **not applicable** (cache off) | `docs/EVIDENCE_LEDGER.md:298,318` |

**Where the money goes:**

- Residential proxy is 75–86% of a large details run.
- In a page-1 check, proxy is 48% (71% with 3 terms batched), mostly each term's own bootstrap page (about 120 of 143 KB).
- In a full sweep: proxy 37%, key-value reads 21%, dataset writes 21%, compute 19% (`docs/EVIDENCE_LEDGER.md:320-330`).

**Scheduling economics:**

- A full sweep every 30 minutes costs about $45 a month per term (from the settled $0.03 full-depth check; `docs/EVIDENCE_LEDGER.md:430-431`).
- A newest-first page-1 check every 30 minutes costs about $3 a month per term (from the settled $0.002 check; `docs/validation/GATEWAY_ADVERSARIAL_REVIEW_2026-09-23.md:77-81`).
- Region plans (**estimates**; the totals and several cells are italicised as estimates in the source): lean (4 terms) about $15 a month; standard (6 terms) about $31–32 a month (`docs/design/CONTAINER_LISTINGS.md:205-213`).
- Scale figures (**estimates** only, "built on measured unit costs"; `docs/design/SCALE_PLAN.md:7-8,29-30`): 1k users $200–400 a month; 10k users $470–780; 100k users $900–1,800 (`docs/design/SCALE_PLAN.md:29-36`).

**Account:**

- Creator plan with a $500 prepaid pool until 2027-03-21 or -22 (the sources differ).
- Monthly cap $85 and 10 GB residential; the owner-approved budget is **$40 per billing cycle**.
- Excess usage is invoiced early at $200; 32 concurrent runs (`docs/HANDOFF.md:311-314`; `docs/EVIDENCE_LEDGER.md:320-354`).

**Performance:**

- Cold details run at about 0.7 requests per second at concurrency 4, so one run fits about 2,300–2,500 cold details (`docs/EVIDENCE_LEDGER.md:307-308`).
- graphql handled 200 listings in 340 s one at a time: 198 of 200 complete, 193 of 197 replays OK (`:222-231`).
- Discovery-only full reads of two terms took about 2.3–2.75 minutes per run (139–165 s for about 1,290 listings on builds 1.0.77–1.0.78), roughly 70–85 s per term (`docs/validation/GATEWAY_RTX3090_PROVING_2026-09-23.md:17-24,65-71`).

**Memory:**

- `actor.json` allows 512–2,048 MB, default 1,024.
- HTTP-only runs peaked at 0.10–0.37 GB; browser fallbacks at 0.5–0.85 GB; the 200-listing graphql details run at 815 MB (`README.md:71-72`; `docs/EVIDENCE_LEDGER.md:311-314,337-338`).
- The heap is capped at 75% (`Dockerfile:13-15`).
- Below 1,024 MB the browser fallback is off.

**Proxy:**

- Use residential GB only. Datacenter IPs failed 20 of 20 (`docs/EVIDENCE_LEDGER.md:333-336`).
- An item page is about 945 KB raw, about 162 KB over the proxy.
- The description block ends at 87% of the page (p90 94%) (`:281-287`).

**Cost levers** (most effective first):

1. Batch a region's terms in one run (−31% per term).
2. Keep `includeDetails:false` on searches, and send only new IDs as `listingIds`.
3. Use the graphql route (−45%), except where photos are needed.
4. `browserFallback:false` plus reruns (a rerun costs $0.0022 against $0.020 for a fallback).
5. `useDetailCache:false`, which removes about 21% of a sweep.
6. 512 MB for checks and sweeps.
7. Keep full sweeps rare.
8. A low `dataRetentionDays` and `fields`/`omit` on downloads (`docs/design/GAP_ANALYSIS.md:62,88-113`).

**Spend governor.** It must act on settled costs. At 80% of budget, slow the lowest-yield terms first, then sweeps, and never drop queued work (`docs/design/CONTAINER_LISTINGS.md:202-203`).

---

## 7. Limits, failure modes and known gaps

**Hard limits:**

| Area | Limits |
|---|---|
| Input | `searchTerms` ≤20 (≤80 chars each); `listingIds` ≤1,000; `startUrls` ≤100 (≤2,048 chars); `radiusKm` 1–500; `maxListings` 1–5,000; `maxPagesPerSearch` 1–100; `maxDetails` 0–6,000; `maxRequests` 1–20,000; `maxRunSeconds` 10–3,600; `detailConcurrency` 1–8; `detailSessionSize` 5–100 |
| HTTP search | Per search: ≤102 requests, ≤100 pages, ≤5,000 listings. 15 s per request; bootstrap ≤2 MiB; response ≤8 MiB; cursor ≤4,096 chars (`src/main.js:635-645`; `src/cheerio-search.js:10-11`; `src/source-binding.js:83-84`) |
| Parser | Body ≤8 MiB, ≤64 JSON documents (`src/marketplace.js:143-195`) |
| Item | Page ≤2 MiB and 15 s; ≤2 redirects; replay reply ≤2 MiB and 15 s; photos ≤40; attributes ≤64; subtitles ≤16; delivery types ≤24; videos ≤16 |
| Browser | One at a time; ≤500 listings per read; 20 s navigation |
| Run | `detailAttempts` ≤2; `candidateIds` ≤5,000; output written only at the end |

**Failure modes:**

| Failure | How it appears | What the app does |
|---|---|---|
| Bootstrap 302 / network | `bootstrap-request-failed`, retried once. Then `route: failed` (fallback off) or `browser-fallback` | Rerun; alert on a rising rate |
| Template not found (Facebook changed) | `request-template-unavailable` | Rerun; alert if systematic |
| Unbound feed | `partial` / `source-binding-unverified` | Degraded. Distrust the rows' search attribution |
| Challenge, login, 403 | `blocked` | Back off; alert |
| Empty search | `extraction-error` (cannot be verified empty) | Treat as unknown, never as "nothing new" |
| Deadline | `truncated` / `time-limit`; `route: unfinished` (or `http` when cut mid-feed); `not-requested-time-limit` | Rerun or give more time |
| Request cap | `request-cap`, `not-requested-request-cap` | Rerun or raise the cap |
| Replay breaker | `detailRoute.circuitOpen: true`; the rest of the run uses the page route | Route-health switches the region |
| Missing description | `descriptionStatus: missing` after `collected` | Retry with a cap; may be genuinely empty |
| Removed or sold listing | `directItemUnresolved`, `extraction-error` | Mark unresolved; do not infer sold |
| Aborted run or billing cap | No dataset, no `RUN_SUMMARY` | Treat as failed; rerun |
| Starved IDs in a mixed run | Source rows `results-limit`, 0 pages; listing rows `not-requested-cap`/`not-requested-request-cap` (never attempted, `directItemUnresolved` still true), or fetched late by the detail pass | Do not mix, or size `maxListings`; requeue on `detailOutcome` |

**Known gaps (unmeasured or unproven):**

- Complete recall, and what triggers the short feed.
- Block rates under frequent checks and at concurrency 8; T5 is pending.
- Whether proxy country changes the feed.
- Category browse feeds on the fast route.
- Nearest-first and price sorts (never bound).
- The live behaviour of the 302 retry.
- The cause of the 1–2% of missing descriptions.
- Whether the browse cards embedded in item pages follow the proxy's location or the item's.
- Unresolved IDs on v3.
- Evidence covers essentially one location (Chichester) over 2–3 days on GB IPs (`docs/EVIDENCE_LEDGER.md:476-493`; `docs/validation/GATEWAY_RTX3090_PROVING_2026-09-23.md:104-105`).
- The T2 paired recall and lag test ran from 2026-09-23 21:00 UTC. Its results sit only in the gitignored `.verification/` folder, and the runner had no resume (`docs/HANDOFF.md:28-35`). **T2 sets cadence, and no faster tier may be sold until it reports** (`nabvy:docs/decisions.md`, Precedence).

---

## 8. What the calling app must do and must never do

**Must:**

1. **Call only `YfdUav3sZ2BgEf8rh`, only through the `apify-gateway` Edge Function.** The Apify token is read only there, never from code, logs or chat (`nabvy:CLAUDE.md`). **Pin a build** (a tag or build number) instead of relying on `latest`. Pass `memory` and `timeout` on every run (`docs/design/GAP_ANALYSIS.md:88-113`), and an explicit `maxRequests`. The gateway refuses a job without `maxRequests` (1–1,000) or `maxRunSeconds` (≤ timeout), and accepts only memory 512, 1,024 or 2,048 MB, a timeout of 60–1,800 s, `browserFallback: false`, an explicit `proxyConfiguration` and no `startUrls` (§2.5, "Gateway limits").
2. **Validate input with Zod mirroring §2.2.** Send `inputVersion: 3`, IDs as digit strings, integers as integers, allowed keys only, and GB residential proxy explicitly.
3. **Plan searches per region**, as a verified centre `cityId` × a few terms, never per user. Batch a region's terms per run. Key results by listing (`docs/HANDOFF.md:138-155`).
4. **Ingest by `recordType`.** Deduplicate by `listingId`, stored as text. Record one observation per sighting, or only changes. Record the card's `city_page.id`, price and "was" price at search ingest.
5. **Read `RUN_SUMMARY` on every run, including FAILED ones.** Count a search as complete only when `route` is `http` and `stopReason` is `source-no-new-listings` or `source-exhausted`; `page-cap`, `results-limit` and `source-results-limit` mean our own cap stopped a healthy read (a tight `maxRequests` can show up as `page-cap`). Rerun everything else: `route` `browser-fallback`, `failed`, `unfinished` or `null` (which includes searches the run never started); `stopReason` `continuation-unavailable` (even with `route: http`), `time-limit` or `request-cap`; `status` `partial`, `blocked` or `extraction-error` (§3.10). Treat a missing page-1 overlap as degraded. Keep `sourceDiagnostics` on.
6. **Handle every `detailOutcome`.** Requeue `not-requested-*`, `extraction-error`, `metadata-only` and `directItemUnresolved` IDs from one global, prioritised, deduplicated details queue. Decide on `detailOutcome` and `detailAttempted`, never on `detailError` or `directItemUnresolved` alone (§2.5). Honour `resolvedByDetailPass` so no ID is paid for twice.
7. **Use `descriptionStatus` for completeness** (§4.5). Use `money` for price. Check `photoGalleryComplete` before assuming all photos are present. Photo links are for display through the listing only: never fetch `photoUrls` or `imageUrl` from Nabvy's servers or from an AI provider, because a photo download is Facebook traffic and must run inside Apify, and the actor cannot fetch photos yet (`capturePhotos` is proposed; T3 has not run). Until then photo review is blocked. Record each link's `oe` expiry (about 104–108 h) so a later capture run refreshes the item first. Once capture exists, the bytes go to Nabvy storage, are deleted after review, and are never served to users (§4.7).
8. **Choose `detailRoute` per region with the ported route-health logic.** Store `RUN_SUMMARY.detailRoute` plus `runId` per run, and alert on `alert:true`. Decide first how the port treats `description-missing` replies (§4.12 caveat).
9. **Keep seller data internal.** Move `seller` and the whole `sourceFields` blob (which carries `marketplace_listing_seller`) into a restricted private schema not exposed to the Data API. Raw snapshots count as part of it. Add CI tests that user-facing output carries no seller fields (`AGENTS.md:27-46`; `nabvy:docs/decisions.md`, Precedence).
10. **Treat listing text and photos as untrusted data.** They never choose IDs, URLs, runs, tools or messages (`AGENTS.md:10`; `docs/design/CONTAINER_LISTINGS.md:186-188`).
11. **Govern spend on settled costs.** Read cost at least 5 minutes after a run. The binding limit today is the gateway's `settings.cap_usd` ($5.50, the owner's £5 for paid runs; `nabvy:supabase/README.md:33-34`), which is lower than the account's $40 cycle budget (shared with the actor's own test runs) and the $85 / 10 GB caps.
12. **Keep Irish (EUR) groups separate** from GBP. Handle sold rows, £0 prices and USD rows.

**Must never:**

- Contact Facebook directly or from a development machine, including photo downloads outside Apify runs (`AGENTS.md:17-25`).
- Touch `JR2fdK8Nj6OLCwKkP`, run `mode: "monitor"`, or touch the deprecated `marketplace_monitor` schema and its `mp_*` tables (`docs/HANDOFF.md:240-242`).
- Send filters or match rules to the actor, or expect it to judge.
- Turn on `useDetailCache` (a second durable copy of seller data in Apify).
- Show seller names, IDs, pictures or anything that identifies a seller. Show price history across relisted listing IDs. Present asking prices as sale prices or as "worth". State a "suspected" label as fact (`docs/HANDOFF.md:210-225`).
- Read `unknown`, `partial`, `missing`, a failed detail, an unread photo, an empty search or "not seen in a feed" as a negative or as "sold".
- Run fetches or AI per user. Pasted links join the shared queue.
- Show `RUN_SUMMARY.sourceOutcomes[].stopReason` or `diagnostics` to users.
- Parse listing or city IDs as JS numbers.
- Charge users before legal advice (Meta's terms, database right, copyright, UK GDPR: LIA, DPIA, Art 14 notice) (`docs/HANDOFF.md:224-225`).
- Sell or share seller data, contact sellers, or post on Facebook (`docs/HANDOFF.md:218-219`).
- Keep photo bytes after review, or serve photos from Nabvy's own storage (`docs/HANDOFF.md:197-198`; `docs/design/SELLER_DATA.md:293-301`).
- Show quotes without redacting names, phone numbers, emails and social handles (`docs/design/SELLER_DATA.md:293-301`).
- Leave raw actor output in Apify longer than needed: runs hold raw seller fields, so use the shortest `dataRetentionDays` (`docs/design/SELLER_DATA.md:316-317`).

---

## 9. How the actor repository and its coding agent work

**`AGENTS.md` rules** (`AGENTS.md:1-57`):

- **Reading order.** Read `docs/HANDOFF.md` first. Dated reviews, the implementation plan and archived handoffs are historical.
- **Toolchain.** Node 22+ (the image uses Node 24), ES modules, `npm test` and `npm run check`.
- **Untrusted content.** Listing text and photos are untrusted data (`:10`).
- **No Facebook contact from the development machine** (`:17-25`). The owner's home connection must never touch Facebook. Live traffic, even a single probe, runs only as Apify runs of the private actor. Locally, run only offline tests, analysis of downloaded Apify data and Apify API calls.
- **Seller data** (owner's decision, 2026-09-24; `:27-46`). Keep it; never show it; store it in a restricted private schema; apply UK GDPR safeguards. "Suspected …" labels only with evidence, a correction route and legal review.
- **Keep out of Git and uploads:** `.env*`, storage, `.verification/`, databases, credentials, staging, `TEMP_IDEAS/` and `.codex/`.
- **Live runs.** Check `docs/EVIDENCE_LEDGER.md` before planning any live run, and record findings there. No automatic deployment or paid run from a handoff; a prior testing allowance is not a fresh budget.
- **Deployment.** Only to the private actor, via `stage:apify` then `apify push` (`:51-53`).
- **Budget check.** Run `npm run spend -- --budget 40 --runs 0` before each paid run and stop on exit code 2 (`docs/HANDOFF.md:313-314`).
- **No external AI service is selected.** Update HANDOFF after material work.

**Docs map** (`docs/README.md:1-57`). Historical docs do not override HANDOFF (`:49-52`).

- **Current:**
  - `docs/HANDOFF.md`: state, rules and the app brief;
  - `docs/EVIDENCE_LEDGER.md`: curated measurements, the settled-cost rule, and obsolete and breach lists;
  - `docs/adr/0002-…`;
  - `docs/design/{CONTAINER_LISTINGS, PARTS_INTELLIGENCE, SELLER_DATA, SCALE_PLAN, GAP_ANALYSIS}.md`;
  - `docs/MONETISATION_INPUTS.md`;
  - `docs/data/{city-pages.seed.json, part-patterns.json}`.
- **Logs:** `docs/IMPLEMENTATION_LOG.md`, a dated build diary that is mostly newest first. Three entries dated 2026-09-22 sit out of order at the end (`:1099-1139`).
- **Validation:** `docs/validation/*.md`, one report per live or offline test.
- **Historical:**
  - `PRODUCT_REQUIREMENTS`, `IMPLEMENTATION_PLAN`, `PARITY_MATRIX`, `VALIDATION_REPORT`;
  - `ADVERSARIAL_*`, `QA_DEBATE`, `QUERY_RETRIEVAL_ADVERSARIAL_REVIEW`, `REFERENCE_METHODS_COMPARISON`;
  - `docs/archive/HANDOFF-build-1.0.74.md`;
  - `docs/adr/0001` (Monitor; superseded).
- **Missing but linked:** `docs/APP_INTEGRATION_GUIDE.md` and `docs/design/COPY_ADVERT_SPAM.md` are both "in progress" and absent at `f177a44`.

**How builds are logged, validated and reviewed:**

1. The agent changes code with offline tests.
2. Adversarial reviews run. For 1.0.82: round 1 found 8 defects and round 2 found 9 confirmed plus 2 unchecked, all fixed with tests (`docs/validation/FIX_BATCH_REVIEW_1.0.82_2026-09-24.md`).
3. The build is staged, inspected and pushed to the private actor.
4. A small, owner-approved live check runs on Apify.
5. Findings go to `EVIDENCE_LEDGER`. Obsolete evidence is listed explicitly: pre-1.0.77 multi-search runs, 18-page results, the 0.55 overlap figure, town-slug experiments and reference-actor comparisons (`docs/EVIDENCE_LEDGER.md:437-450`). Process breaches, meaning direct Facebook contact by earlier agents, are also recorded (`:452-468`).
6. HANDOFF and IMPLEMENTATION_LOG are updated.

**The test suite:**

- **Size.** 42 files under `test/`, with 390 `test(` declarations at `f177a44`. HANDOFF reports 390/390 passing (`docs/HANDOFF.md:47-49`).
- **Offline harness.** Tests stub the HTTP client, block every browser launch and point proxies at a closed local port (`test/main-v3.test.js:8-16,37`).
- **What the suite pins** (the de facto contract):
  - v3 allow-list, validation errors, defaults and budget formulas (`test/gateway-input.test.js`);
  - `descriptionStatus` and `descriptionComplete` derivation and merge downgrade rules (`test/details.test.js:155-181`; `test/http-item.test.js:104-211`; `test/item-structured.test.js`);
  - exact request accounting, including redirects and failed replays, and nothing sent after the deadline (`test/main-v3.test.js:61-282`);
  - one row per requested ID, and `resolvedByDetailPass`;
  - stop-reason mapping and sanitisation (`test/collection.test.js`; `test/source-outcomes.test.js`);
  - binding rules (`test/source-binding.test.js`);
  - replay session, breaker and rotation (`test/item-graphql.test.js`);
  - route-health cadence and idempotency (`test/route-health.test.js`);
  - money parsing (`test/contracts.test.js`; `test/adversarial-input-money.test.js`).
- **Not pinned:** `route: 'unfinished'` has direct coverage only in the main-v3 deadline and cap cases. No test asserts `row.descriptionComplete` on final dataset rows.

**The T-test programme** (each run on Apify and owner-approved; `docs/design/CONTAINER_LISTINGS.md:249-261`; `docs/design/SCALE_PLAN.md:109-113,131-141`):

| Test | What | Status / cost |
|---|---|---|
| T1 | Page-1 fast-route reliability | Done on 1.0.80: 30 of 30 on the fast route, $0.03 |
| T2 | 24-hour paired recall and lag, newest pages 1–2 against default pages 1–4 plus a sweep every 4 h, terms `3090` and `gaming pc` | Started 2026-09-23 21:00 UTC, capped at $1.20. Results not in the repository |
| T3 | Photo fetch on 20 listings, with and without the residential proxy | Planned, $0.05–0.15 |
| T4 | Photo gold set of about 95 text-silent PCs labelled by the owner | Planned, $0.4–0.6 |
| T5 | Block rate over at least 200 frequent checks; the scale plan recasts it as a stepped ramp | Planned, about $0.45 |
| T6 | One broad term from 3 distant centres | Planned, $0.10–0.15 |
| T7 | Newest-first from centres 80 km apart | Planned, about $0.05 |

The actor's next work (`docs/HANDOFF.md:388-421`):

1. Emit the embedded browse cards and `search_pivots`.
2. Analyse T2.
3. Quick wins: default proxy country GB, lazy-loading of legacy code, compact output.
4. A photo media query.
5. Delete the v2 matching and Monitor code.

---

## 10. Other code in the repository

| Component | Files | What it is | Runs in v3? | Reuse in Nabvy? |
|---|---|---|---|---|
| Route health | `app/route-health.js`, `test/route-health.test.js` | Pure detail-route chooser (§4.12) | App-side | **Yes:** port to TS with its tests |
| Part patterns | `docs/data/part-patterns.json` | Case-insensitive regexes for listing kind and parts, plus 19 ordered GPU models. Coverage measured; precision and recall not | Data | **Yes:** run in TS, not Postgres regex. Strip "OptiPlex 3080/3090" first. The catalogue lacks plain RTX 5060 and many common models |
| City pages | `docs/data/city-pages.seed.json` | 771 city pages, 5 verified centres | Data | **Yes**, as seed data. Verify centres before use |
| Query matcher | `src/query-matching.js` | v2 GPU and token matcher: `match` / `unknown` / `no-match`. `no-match` needs a complete description and gallery | No (v3 has `matchQuery: null`) | Semantics and fixtures only. Its "unknown ≠ no" rule is worth copying |
| GPU classifier and budgets | `src/matching.js`, `src/monitor/match.js` | Monitor preset, RTX 3090/4090 only | No | No |
| Valuation | `src/valuation.js` | 30-day median asking-price gauge, ≥10 comparables, bands bargain…very-high | No | No. "Bargain" or "worth" wording conflicts with the brief; its inputs are never produced |
| Price-drop rule | `src/monitor/price-events.js` | ≥5,000 minor units **and** ≥5% | No | Reference only; Nabvy sets its own rule |
| Monitor store | `src/repositories/postgres.js`, `sqlite.js`, `integration/*.mjs` | `mp_*` tables with RLS on and no policies | No | **No.** They live in `marketplace_monitor`: leave it alone |
| Notifications | `src/notifications/*` | Discord and email digests (email via the `apify/send-mail` actor) | No | Patterns only (1,900-char cap, no mentions, 5xx/429 treated as unknown) |
| Viewer | `src/presentation/*`, `web/*` | Private HTTP viewer with HMAC session and CSRF | No (not deployed, but copied into staging) | No |
| Review tooling | `src/review-handoff.js`, `review-verdict.js`, `review-refresh.js`, `scripts/prepare-*.mjs`, `apply-review-verdicts.mjs` | Offline LLM review: allowlisted projection (seller stripped), `textHash`/`contentHash`, strict verdict JSON schema with anchored evidence, dispositions | No | Ideas only. Keyed on the v2 `targetQuery`, which v3 rows lack; `review-refresh` emits v2 input |
| Spend CLI | `src/apify-spend.js`, `scripts/apify-spend.mjs` | Reads Apify `/users/me/limits`, `/usage/monthly` and `/actor-runs` | No | Endpoint reference for the gateway's governor. The token must stay in the gateway |
| Evaluation and probes | `scripts/evaluate-query-retrieval.mjs`, `summarize-source-probes.mjs`, `docs/validation/offline-probes.mjs` | Offline analysis | No | No |
| Geo and postcode | `src/geo.js`, `src/postcode.js` | Haversine distance; lookups at postcodes.io | Monitor only | No (Nabvy has its own) |
| Sorting | `src/sorting.js` | Viewer sort | No | No; the actor's output is in feed order |
| Dev scripts | `scripts/local-postgres.mjs`, `stage-apify.mjs`, `src/certs/supabase-ca-2021.crt` | Local database, staging, Monitor database CA | No | No |

---

## 11. Inconsistencies and open questions

**Actor code against its own docs**

1. `descriptionComplete` is emitted on every row but documented nowhere (§4.5). Resolution for Nabvy: derive it; do not depend on it.
2. `resolvedByDetailPass` and the `detailCacheStatus` value `write-error` are emitted but missing from `dataset_schema.json`.
3. The README says `route: failed` covers "the run deadline arrived first" (`README.md:103-105`). The code reports `unfinished` for that case (`src/gateway-summary.js:23`), and the README never mentions `unfinished`.
4. A verified HTTP read cut mid-feed by the deadline reports `route: http` with `truncated`/`time-limit`, and one stopped by a failed, unverified or invalid continuation reports `route: http` with `truncated`/`continuation-unavailable` (`src/http-search.js:215,230-243,256-266`; `src/main.js:646-657`; `src/collection.js:253-257`). A search the run never started reports `route: null`, not `unfinished` (`src/gateway-summary.js:23`). Callers must check `stopReason`.
5. `route: null` cannot distinguish "diagnostics off" from "HTTP skipped or thrown" or "search never started" (`src/main.js:633,703`; `src/collection.js:311-317`).
6. The README and the input schema say every row's `locationDetails.reverse_geocode.city_page.id` is a valid `cityId` (`README.md:115`; `.actor/input_schema.json:27`). Enrichment replaces `locationDetails` and drops it.
7. After enrichment, `price` (the card) and `money` (the item) can disagree. The docs do not say whether this is intended.
8. The v3 default proxy has no country (`src/gateway-input.js:141`), while the README and the Console prefill use GB.
9. The input schema says `maxListings` "Default: 500". The code default is `max(500, listingIds.length)`.
10. `RUN_SUMMARY` is described as "for v2 runs" (`.actor/key_value_store_schema.json:8`).
11. Some stop reasons are unreachable: `source-confirmed-empty`, `verified-empty` for searches, and `cursor-cycle-or-no-progress`. Empty searches cannot be verified, and a searches-only run where every term is empty is FAILED.
12. `RUN_SUMMARY.sourceOutcomes[].stopReason` holds raw exception text. It is unverified whether a browser or proxy error could include a proxy URL with credentials there. `src/main.js:580-582` guards this only for item fetches.
13. `detailAttemptedCount` is inflated for requested IDs that a search also returned (`src/main.js:731-739`).
14. A failed retry leaves `detailOutcome: collected` together with a `detailError`. A time-limited unresolved ID that sent a page gets `extraction-error` with the deadline message (`src/direct-item-candidates.js:27-40`).
15. `sourceFields.seo` and `provenance: seo` on v3 item data do not mean Open Graph (`src/main.js:826`).
16. The graphql template search keeps the default 20,000-node budget, although the function's own comment says item pages may need more (`src/cheerio-search.js:94-99`; `src/item-graphql.js:40`). Whether this causes some `bootstrap-no-template` failures is not established.
17. The breaker (20 / 0.85), the failed-bootstrap cap (3) and the rotation threshold (3) cannot be set from the input.
18. The detail cache has no eviction and stores seller data in Apify (moot while it is off).
19. The matcher accepts either description flag (`src/query-matching.js:99-100`), while `normalizeListing` requires both (`src/marketplace.js:227-228`).
20. Binding compares the query case-sensitively and the radius with strict `===`. If Facebook normalised either, every search would fall back. There is no evidence either way (`src/source-binding.js:150-170`).

**Docs against docs**

21. `docs/IMPLEMENTATION_LOG.md:3` says 1.0.82 is not deployed, while `docs/HANDOFF.md:5-6` and the ledger's live runs say it is. No document states which build `latest` points to.
22. `docs/EVIDENCE_LEDGER.md:311,337` says 1 GB is the minimum memory. `actor.json` says 512, and a 512 MB run passed on 1.0.82.
23. On the 302 retry, the ledger says both "staged, not deployed" (`:107-110`) and "deployed in 1.0.80, untested live" (`:472-475`).
24. The radius and feed-scope findings were reversed between 1.0.79 and 1.0.80 (`docs/IMPLEMENTATION_LOG.md:81-86,113-114`). The latest view is that the radius does not decide which feed comes back.
25. The −45% graphql claim is described as "on 200 listings" (`README.md:46-48`; `.actor/input_schema.json:119`), but the settled −45% comes from a 20-listing pair. The 200-listing run measured completeness.
26. The 1.0.82 live-check costs were read about 1 minute after the runs, which breaks the ledger's own 5-minute rule.
27. Test counts are given as 374 (`docs/IMPLEMENTATION_LOG.md:35-38`), 386 (`FIX_BATCH_REVIEW:271`) and 390 (`HANDOFF`). There are 390 declarations at `f177a44`.
28. The `listingIds` batch size is 200 in `CONTAINER_LISTINGS:68` and 1,000 in the code. `SCALE_PLAN:81-82` says IDs "run one after another", which is stale. The design docs also say `actor.json` minimum memory must be lowered to 512, which is already done.
29. `PARTS_INTELLIGENCE:144-145` plans `maxListings` of about 8,000, above the 5,000 cap.
30. Newest-first check cost is quoted as $0.0016, $0.002 and $0.0022, on different bases.
31. Seller coverage is quoted as 18% of rows (`docs/EVIDENCE_LEDGER.md:193`), 7.5% / 6.3% of listings from item fetches, 8.1% of search rows, and 35.3% of listings across repeated sightings, 94.7% of them from search cards (`docs/design/SELLER_DATA.md:31-47`). These are different samples and definitions. (`docs/HANDOFF.md:87-93` states the seller-data rule but gives no percentages.)
32. The prepaid pool end date is given as both 2027-03-22 and 2027-03-21. The plan is called "custom Bronze" (`docs/IMPLEMENTATION_LOG.md:212-213`) and elsewhere "Creator".
33. The scale plan's "no seller names, IDs or pictures" minimisation (`docs/IMPLEMENTATION_LOG.md:69-71`) predates the owner's decision to keep seller data internally (`AGENTS.md:27-46`). The later decision wins.
34. There is a conflict between "keep everything from each paid download" (`docs/HANDOFF.md:151`) and "strip phones, emails and names from descriptions before storage" (`docs/design/PARTS_INTELLIGENCE.md:359-360`). The retention period N is unset. The owner must decide.
35. `docs/APP_INTEGRATION_GUIDE.md` and `docs/design/COPY_ADVERT_SPAM.md` are linked but absent. The seed file's 5 verified centres have null coordinates, and Rotherham, verified in the ledger, is not flagged.
36. `docs/EVIDENCE_LEDGER.md` open question 4 (make graphql the default) is stale, and so is its "Updated 2026-09-23" header.

**Nabvy side**

37. Resolved: `nabvy:CLAUDE.md:9`, `nabvy:docs/decisions.md:26` and `nabvy:supabase/README.md:45-50` all say the token is the Edge Function secret `APIFY_TOKEN`, read only by `apify-gateway`. The temporary Vault copy was deleted on 2026-09-24 (nabvy commit `2386d91`).
38. `nabvy:CLAUDE.md` says to hash seller IDs and never store names. This is superseded by the brief, per Precedence: keep seller data internal in a restricted schema, with the HMAC key only after the DPIA.
39. The actor's spend check needs `APIFY_TOKEN` locally, so Nabvy's spend governor must live in the gateway. The actor's script cannot be reused as is.
40. Resolved: redaction v1 (`nabvy:supabase/migrations/20260924023000_apify_gateway_redact.sql`) raised on seller keys other than `id`, `name`, `profile_picture` and `__typename`, so card sellers and item sellers with `short_name` or `profile_picture.url` would have blocked exports. v2 (`20260924024000_apify_gateway_redact_v2.sql`) redacts every seller value whatever its key, and its leak check covers every string in a seller object.

**Unverified platform behaviour**

41. Whether Apify injects the input-schema default `inputVersion: 3` into API-started runs. Send it explicitly either way.
42. The size limits of the key-value record for a `RUN_SUMMARY` holding 5,000 `candidateIds` and full diagnostics.
43. The block rate at scale (about 10–30k Facebook requests a day at 10k users). Ramp in 24–48 h steps and stop on any rise in 302s or fallbacks (`docs/design/SCALE_PLAN.md:111-115`).
