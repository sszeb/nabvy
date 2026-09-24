# Scope report: rebuilding the actor reference from the listed files

Written 2026-09-24 (about 09:30 UTC). This report compares the old reference (`nabvy/docs/fb-actor-reference.md` before 2026-09-24's rebuild, compiled from a full read of the actor repository; in git history before this commit) with the rebuilt one (`docs/fb-actor-reference.md`, from the owner's listed files and Nabvy's recorded run). It covers three things: what was lost, which Nabvy code and documents still depend on the lost material, and what to ask the owner.

**Conventions**
- `old:NN` is `nabvy/docs/fb-actor-reference.md:NN`. The old reference is only a pointer to *what* was claimed. It is never evidence.
- "new §x" is a section of the rebuilt reference.
- **[N]** marks items that matter to Nabvy's plans or code. The text after "→" says what they affect.
- "Listed" means what the owner's listed files still support, with citations.

**How this was checked**
- **Actor files opened.** Only the listed files were opened:
  - read in full: `README.md`, `.actor/input_schema.json`, `docs/EVIDENCE_LEDGER.md`, `docs/design/CONTAINER_LISTINGS.md`, `docs/design/SELLER_DATA.md`, `docs/design/SCALE_PLAN.md`, `docs/MONETISATION_INPUTS.md`, `app/route-health.js` and `test/route-health.test.js`;
  - `docs/HANDOFF.md`: lines 80–253 only;
  - `docs/design/PARTS_INTELLIGENCE.md`: selected ranges;
  - `docs/data/city-pages.seed.json`: one entry.
- **Fingerprints.** At 09:28 UTC all 13 listed files still matched the sha256 fingerprints in the new reference's preamble, and all were last modified at 01:04 UTC.
- **The two pending documents.** `docs/APP_INTEGRATION_GUIDE.md` and `docs/design/COPY_ADVERT_SPAM.md` are still absent. Only the local checkout was checked; GitHub was not, because this job has no network access.
- **Scope breach (disclosed).** One grep used the glob `docs/design/*.md`. It also matched `docs/design/GAP_ANALYSIS.md`, which is not a listed file, and printed 3 of its lines. Nothing from that file is used or cited here.
- **Withdrawn Nabvy code.** Nabvy's own git history was read for the withdrawn `facebook-actor-input.ts` and its test, at commit `ae06eaa`.

---

## Dropped from the old reference

Each line below is a fact, rule or figure that the old reference held and the new one does not, because the listed files do not support it. Where a listed file still supports part of the item, the line says which part.

### Short answers (old:10-20)
- [N] SA (old:12-16) `descriptionComplete` is on every v3 listing row, always equals `descriptionStatus === 'full_verified'`, and is declared in no schema or `.md`. Listed: not documented. The recorded run has `true` and `full_verified` on 20 of 20 rows (new §3.3, Q11). → `services/source-adapters/README.md:104`, `test/facebook-run-fixture.test.ts:98`, `docs/questions.md:10`.
- [N] SA (old:17) Numbers sent as strings (for example `"20"`) are rejected, and IDs must be digit strings. Listed: only the declared types (fb-scrap-engine/.actor/input_schema.json:10,26,60,97). → `README.md:31`, the withdrawn test.
- [N] SA (old:18) Read `RUN_SUMMARY` even when a v3 run ends FAILED; Crawlee state records reach the key-value store earlier. Listed: v2 only, "An all-blocked or all-unreadable run fails and writes per-source diagnostics to `RUN_SUMMARY`" (fb-scrap-engine/README.md:170). → job-status handling (the gateway already collects every terminal run: nabvy/supabase/functions/apify-gateway/index.ts:248-262).
- [N] SA (old:19) The full degraded-search rule. Dropped parts:
  - complete also on `source-exhausted`;
  - `source-results-limit` counted as our cap;
  - `continuation-unavailable` and `request-cap` treated as degraded;
  - `route` `unfinished` or `null`;
  - `status` `partial`, `blocked` or `extraction-error`;
  - a tight `maxRequests` surfacing as `page-cap`.

  Listed: `http`, `browser-fallback` and `failed`; `page-cap`, `source-no-new-listings` and `time-limit` (fb-scrap-engine/README.md:101-108). `results-limit` was seen in the recorded run (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:12). → `README.md:128`, the coverage logic.

### §1 What the actor is (old:24-74)
- §1 (old:26) Package name `fb-marketplace-sniper`, from `actor.json`.
- §1 (old:28-36) ADR 0002 details: acceptance date 2026-09-23, the "controls that remain" list, "Facebook's dialect lives only in the actor". Listed: only the gist (fb-scrap-engine/README.md:3,134; fb-scrap-engine/docs/HANDOFF.md:84-86,140-141,155).
- [N] §1 (old:37) v3 rejects unknown keys with "Unknown v3 input field … filtering belongs to the calling app", and always runs candidate mode with `matchQuery: null`. Listed: "Unknown fields … are rejected" only (fb-scrap-engine/README.md:95-96). How and where they are rejected is not stated (new §2.2 rule 11). → gateway error handling.
- [N] §1 (old:42) The production actor `JR2fdK8Nj6OLCwKkP` is frozen at build 1.0.9 (sourced from `HANDOFF.md:36`, outside the two sections). Listed: an unnamed "historical production Actor" (fb-scrap-engine/README.md:484). The never-touch rule stands on nabvy/CLAUDE.md:9. → new Q9.
- §1 (old:43) Deployment target `apify push YfdUav3sZ2BgEf8rh --dir`. Listed: `stage:apify` and `apify push --dir` with no actor named (fb-scrap-engine/README.md:482).
- [N] §1 (old:47) Build 1.0.82 is commit `9d17951`, deployed 2026-09-24; later commits change only documentation. Listed: none. The recorded run resolved `latest` to 1.0.82 (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:12,16). → build pinning, `docs/questions.md:14`.
- [N] §1 (old:52-53) Build numbers are Apify builds, not npm versions; `IMPLEMENTATION_LOG` is stale; no document says which build `latest` points to after 1.0.74. Listed: also silent (new §2.1, "Build"). → `docs/questions.md:14`.
- §1 (old:55-64) The "what 1.0.82 changed" changelog: which build introduced the cache-off default, `browserFallback`, `detailSessionSize` and `responseInventory`; the V8 heap cap at 75%. Listed: the features themselves; only graphql-default-in-1.0.82 (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:231) and 1,000 IDs in 1.0.82 (:251-252) are dated.
- [N] §1 (old:65) Before 1.0.82, an explicit `maxRequests` below about `maxListings` gave searches a negative budget and returned 0 listings. Not in the listed files. → `maxRequests` sizing on older builds; pin 1.0.82 or later.
- [N] §1, §5.1 (old:70, 634) Search sessions persist cookies (Crawlee session pool), and session-pool state and statistics reach the run's default key-value store (about 10 writes per check). Whether that includes session cookies was never established. Listed: "public Marketplace pages only" (fb-scrap-engine/README.md:486); v2 diagnostics log no tokens or cookies (:388-389). The recorded run made 3 key-value writes (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:51); what they were is not documented. → run-storage retention; the gateway reads only the dataset and `RUN_SUMMARY`.
- [N] §1 (old:72) No `Actor.charge` calls, so the actor does not charge pay-per-event and the caller pays platform usage. Listed: not documented (new §6.4, Q19). → the cost ledger.

### §2.1 How an input is routed (old:80-91)
- [N] §2.1 (old:82-86) The routing rules:
  - a non-null object is required;
  - `inputVersion` must be absent, 1, 2 or 3 ("Unsupported inputVersion…");
  - v3 runs when the version is absent and `searchTerms`, `cityId` or `listingIds` is present;
  - v2 runs when `mode`, `startUrls` or `urlList` is present, so a `startUrls`-only input goes to v2;
  - v1 runs otherwise.

  Listed: schema default 3, and "Deprecated v2 jobs must send 2 explicitly" (fb-scrap-engine/.actor/input_schema.json:11-13); `searchQuery` with `maxPrice` enters legacy Monitor (fb-scrap-engine/README.md:463). → always send 3 (the gateway enforces it: nabvy/supabase/migrations/20260924020000_apify_gateway.sql:93-94).
- §2.1 (old:87-89) The exact error text for a non-v3 input below 1 GB. Listed: "v2 and Monitor inputs refuse to start" (fb-scrap-engine/README.md:88-89).
- [N] §2.1 (old:91) `actor.json` memory: default 1,024, minimum 512, maximum 2,048; heap capped at 75%. Listed: default 1 GB (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:311); the minimum is disputed (fb-scrap-engine/README.md:86-87 against fb-scrap-engine/docs/EVIDENCE_LEDGER.md:337-338); 2 GB runs happened (:313). The maximum and the heap cap are not documented. → the gateway's memory allow-list (nabvy/supabase/migrations/20260924020000_apify_gateway.sql:87-88).

### §2.2 The v3 input contract (old:93-125)
- [N] §2.2 (old:95) Accepted keys are exactly the `src/gateway-input.js` list, and any other key throws. Listed: the schema declares the same 23 properties (fb-scrap-engine/.actor/input_schema.json:8-183) but sets `additionalProperties: true` (:6); the README says unknown fields are rejected (fb-scrap-engine/README.md:95-96). → `README.md:30`; the fixture test's `V3_INPUT_KEYS`.
- [N] §2.2 (old:95) Integers are checked with `Number.isInteger`, so `"20"` is rejected. → `README.md:31`; the withdrawn test (`maxRequests: '60'`).
- [N] §2.2 (old:99) `inputVersion` 1, 2 or 3 are accepted. Listed: 3, or 2 for v2 (fb-scrap-engine/.actor/input_schema.json:11). → `README.md:35`.
- [N] §2.2 (old:100) `searchTerms`:
  - defaults to `[]`;
  - ≤20 is counted before de-duplication;
  - each term must be non-blank and at most 80 characters after trimming;
  - terms are trimmed, whitespace is collapsed, and de-duplication uses NFKC plus en-GB lower case, keeping the first spelling;
  - `cityId` is required.

  Listed: up to 20, "duplicates are ignored regardless of case", each run in the city (fb-scrap-engine/.actor/input_schema.json:18). → the withdrawn `termKey` and 80-character rule; `README.md:36`.
- [N] §2.2 (old:101) `cityId` must match `^\d{5,30}$`, a JSON number is rejected, and it is allowed only with `searchTerms`. Listed: a numeric string (fb-scrap-engine/.actor/input_schema.json:24-30), one city per run (fb-scrap-engine/README.md:39-40). → `README.md:37`; the fixture test at line 162; the withdrawn schema.
- [N] §2.2 (old:102) `radiusKm` is allowed only with `searchTerms`. → the withdrawn rule.
- [N] §2.2 (old:103) `sort` defaults to `"default"` and other values throw. Listed: an enum with no default (fb-scrap-engine/.actor/input_schema.json:39-52; new Q4). → `README.md:39`.
- [N] §2.2 (old:104) `listingIds`:
  - each must match `^\d{1,30}$`;
  - IDs run after searches and after `startUrls`;
  - duplicates are dropped;
  - they raise the `maxListings` default to max(500, n).

  Listed: up to 1,000 numeric IDs fetched in parallel (fb-scrap-engine/.actor/input_schema.json:77), after any searches (fb-scrap-engine/README.md:73-74). → the fixture test at line 70; `README.md:40`; the withdrawn formula.
- [N] §2.2 (old:105) `startUrls` must each be at most 2,048 characters and https facebook.com `/marketplace/` only; slug and extra-parameter URLs cannot be source-bound. Listed: up to 100; extra parameters use the browser route (fb-scrap-engine/.actor/input_schema.json:85); slugs redirect and are rejected (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:34-38). → `README.md:64` (moot while the gateway refuses `startUrls`).
- [N] §2.2 (old:106) `includeDetails: false` forces `maxDetails` to 0, and "maxDetails requires includeDetails." is thrown. → the withdrawn rule.
- [N] §2.2 (old:108) `browserFallback` reserves one request per search. Listed: per listing only (fb-scrap-engine/README.md:75-78). → `maxRequests` sizing.
- [N] §2.2 (old:110) `maxListings` defaults to max(500, listingIds.length) and is also the per-source cap. Listed: default 500 (fb-scrap-engine/.actor/input_schema.json:61), run-wide (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:305). → `README.md:46`; detail batches of more than 500 IDs.
- [N] §2.2 (old:111) Internally `maxPagesPerSource` is `maxPagesPerSearch` + 3 (bootstrap, bootstrap retry, browser reserve). Listed: a spare request for the bootstrap retry (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:107-110,472-475); a v2 reserve for the fallback (fb-scrap-engine/README.md:390-391). → the withdrawn formula.
- §2.2 (old:112) The exact `maxDetails` default, min(6000, maxListings + ceil(maxListings/10)). Listed: "maximum listings plus 10%", at most 6,000 (fb-scrap-engine/.actor/input_schema.json:91-93); the rounding is not stated.
- [N] §2.2 (old:113) The default `maxRequests` = min(20000, feeds×(maxPagesPerSearch+3) + items×itemReserve + maxDetails). Listed: "enough for the page and detail caps" (fb-scrap-engine/.actor/input_schema.json:98). → the withdrawn `actorDefaultMaxRequests`; `README.md:49`.
- [N] §2.2 (old:114) Discovery gets floor(`maxRunSeconds`/2), and the detail pass runs to the full deadline. Listed: "half" (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:306). → `maxRunSeconds` sizing.
- §2.2 (old:116) `useDetailCache: true` needs `ACTOR_ID` on the platform.
- [N] §2.2 (old:119) With `sourceDiagnostics` off, `route`, `httpStopReason` and `searchControls` are null and there are no `candidateIds`. Listed: "Record every observed listing ID and HTTP route details" (fb-scrap-engine/.actor/input_schema.json:164). → `README.md:55` (keeping it on is still the conservative choice).
- §2.2 (old:121) A `proxyConfiguration` that is not a plain object throws. (The no-country default is still supported: fb-scrap-engine/docs/EVIDENCE_LEDGER.md:77-78.)
- §2.2 (old:123) The fixed v3 internals: `mode`, `queryPipeline`, `matchQuery`, `queryOutputMode`, `expandSearch`, `generatedSearchUrls`, `blockResources`, `httpSearchFirst`, `httpSearchProbe` and `allowResidentialFallback`. The recorded run shows `mode: "extract"` (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:2).
- [N] §2.2 (old:125) Source order is searches, then `startUrls`, then `listingIds`, de-duplicated by URL; `sourceIndex` is that position; "Provide searchTerms with cityId, listingIds, or startUrls." is thrown when there is none. Listed: IDs come after searches (fb-scrap-engine/README.md:73-74). → mapping `sourceOutcome` rows back to sources.

### §2.3 Budget arithmetic (old:127-134)
- [N] §2.3 (old:129) itemReserve = (graphql ? 2 : 1) + (fallback ? 1 : 0). Listed: qualitative only, "a failed replay, its page and any browser fallback" (fb-scrap-engine/README.md:75-78), and graphql reserves two (fb-scrap-engine/.actor/input_schema.json:91). → the withdrawn formula.
- [N] §2.3 (old:130) Each search reserves `maxPagesPerSearch` + 3 requests. → the withdrawn formula.
- [N] §2.3 (old:131) The split between discovery and details, min(maxDetails, maxListings, max(0, maxRequests − discoveryNeed)); the detail pass may use what discovery left unused. Listed: "searches keep their page allowance first and details get the rest" (fb-scrap-engine/README.md:82-83).
- [N] §2.3 (old:132-134) The worked examples: 12 (3 terms, 1 page), 1,226 (2 terms, 60 pages, `maxListings` 1,000) and 950 (200 IDs on graphql). → the withdrawn test expectations.

### §2.4 Validation errors (old:136-157)
- [N] §2.4 (old:136-155) The 16 v3 validation messages, and that a rejected input ends FAILED with no dataset and no `RUN_SUMMARY`. Listed: not documented for v3 (new §7 last row, Q3). → gateway and adapter error handling.

### §2.5 Recommended presets (old:159-217)
- [N] §2.5 (old:163) "Use the actor's own default formula": A = 4×terms, B = 7×terms, C = 63×terms, D = 2×IDs + `maxDetails`; D fits under the gateway's 1,000 only up to 225 IDs. Listed: batches of up to about 200 (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:68,108-109), which stands without the formula. → the withdrawn presets; `README.md:76`.
- [N] §2.5 (old:169-215) The four presets' exact values:
  - A: `maxRequests` 12, 120 s, 512 MB, about 240 s timeout;
  - B: 21, 300 s;
  - C: `maxListings` 4,200, 189, 900 s, timeout of at least 1,100 s;
  - D: 950 (750 on the page route), 900 s, 1,024 MB, timeout of at least 1,100 s.

  Listed: the check patterns and their costs (new §1.3), and "timeout above `maxRunSeconds`" (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:309-310). → the withdrawn presets.
- [N] §2.5 (old:197) "Allow about 1,400 listings per term, so at most 3 terms per sweep." Listed: about 1,300 per full feed (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:303-304), 2,400 in one 100-page `gaming pc` sweep (:246-249), and a cap of 5,000 (fb-scrap-engine/.actor/input_schema.json:61). → the withdrawn `fullSweep`.
- [N] §2.5, §6 (old:199, 828, 830) Settled sweep costs of $0.003 (short feed, 86 listings) to $0.031 (build 1.0.79), and the note that "$0.01 (short)" has no run behind it. Listed: $0.01 to $0.031 per term (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:65, under the heading "settled, or *estimate*" at :60; fb-scrap-engine/docs/HANDOFF.md:144), and $0.031 for a full `3090` read (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:316-317). → spend planning (new §6.1 now carries $0.01).
- [N] §2.5, §4.9 (old:217, 922) Mixed runs:
  - searches that fill `maxListings` crowd out the IDs;
  - the IDs' placeholder rows end `not-requested-*` but keep `directItemUnresolved` and a misleading `detailError`;
  - so requeue on `detailOutcome` and `detailAttempted`, never on `detailError`.

  Listed: IDs run after searches "within the request, result and time limits" (fb-scrap-engine/README.md:73-74); the crowding is only an inference (new §2.2 rule 3). → the "not both" rule (keep it as Nabvy policy); requeue logic.

### §2.6 Deprecated inputs (old:219-225)
- §2.6 (old:221,224) The full v2 and v1 key lists, and "inputVersion 1 is accepted". Listed: v2 example keys (fb-scrap-engine/README.md:149-217); `searchQuery` and `maxPrice` (:463).
- §2.6 (old:223) Monitor writes into `marketplace_monitor`, according to the code. Listed: Monitor uses a private Supabase schema (fb-scrap-engine/README.md:421); leave `marketplace_monitor` alone (fb-scrap-engine/docs/HANDOFF.md:240-242).
- [N] §2.6 (old:225) `includeListingDetails`, `radius`, `sortBy`, `minPrice`, `maxPrice` and `daysSinceListed` each throw in v3. Listed: price and date limits are left out on purpose (fb-scrap-engine/README.md:134), and unknown fields are rejected (:95-96). → the withdrawn test cases.

### §3.1 Search URL and binding (old:231-243)
- §3.1 (old:235-243) The rules for a bindable URL: the www., m. or web. host; a path of 1–30 digits; exactly one `query`; radius 1–999; `ref`, `fbclid` and `utm_*` ignored. Listed: `locale=en_GB` breaks binding, `_rdc` is accepted, radius and `sortBy` are bound, and "all other parameters stay rejected" (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:67-76). That last point conflicts with the old "ignored" set.

### §3.2 The HTTP route (old:245-270)
- [N] §3.2 (old:247-253) When the route runs (`pageBudget` ≥ 2 + reserve), and its per-search caps: at most 102 requests, 100 pages and 5,000 listings; `knownIds`; 15 s per request.
- §3.2 (old:257-264) The bootstrap and replay mechanics:
  - Impit client with no redirects;
  - acceptance checks: status 200, route retained, at most 2 MiB, HTML, exactly one template, the LSD token;
  - replay options: `credentials: 'omit'`, 8 MiB cap;
  - the paging conditions.

  Listed: the v2 mechanics (fb-scrap-engine/README.md:379-399); a 646–762 KB page (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:84-85).
- [N] §3.2 (old:266) `nextCursor` is always null, so there is no resumable cursor: to read deeper, raise `maxPagesPerSearch` in the same run. Listed: v2 diagnostics record cursor presence but not its value (fb-scrap-engine/README.md:414). → sweep design (no resuming across runs).
- §3.2 (old:268) A result is accepted only when `status` is `ok` and binding is `verified`.
- [N] §3.2 (old:270) Request cost: 1 bootstrap, plus 1 POST per page, plus one possible retry. Listed: none. The recorded run is consistent: `requestsUsed` 2 for 1 page (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:80,82). → `maxRequests` sizing.

### §3.3 Bootstrap retry (old:272-274)
- §3.3 (old:274) What triggers a retry (network or redirect, including a failed first POST, with 2 or more requests left), and the diagnostics `bootstrapRetries` and `firstStopReason`. Listed: one retry of a redirected bootstrap in a new session, deployed in 1.0.80 and untested live (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:107-110,472-475).

### §3.4 When HTTP does not verify (old:276-295)
- [N] §3.4 (old:280) The deadline gives `truncated`/`time-limit` with `route: unfinished`. Listed: `truncated`/`time-limit` (fb-scrap-engine/README.md:106-108), but `route: failed` when "the run deadline arrived first" (:103-105). → coverage logic must accept both values.
- [N] §3.4 (old:281-285) With the fallback off, a search is `request-cap` (0 requests) or `extraction-error` with the texts "HTTP search unverified; browser fallback disabled.", "This source has no HTTP route; …" or "…no browser request remained". Listed: `route: failed` (fb-scrap-engine/README.md:84-85).
- §3.4 (old:286-290) Browser-fallback mechanics: 20 s navigation, a 12 s wait, 2,000 px scrolls counted as requests, CDN assets bypassing the proxy, a 500-listing cap.
- [N] §3.4 (old:292-293) Errors matching `/redirect|challenge|verification|login|HTTP 403/i` become `blocked`, others `extraction-error`, and the raw message becomes `stopReason`; an unbound page gives `partial`/`source-binding-unverified`. Listed: v2 `partial/source-binding-unverified` (fb-scrap-engine/README.md:170). → block alerting; what operators see.
- §3.4 (old:295) The browser request policy (Facebook-owned hosts; `blockedbyclient`).

### §3.5 Source binding (old:297-314)
- [N] §3.5, §11 (old:299-308, 1102) Binding details:
  - a single numeric `doc_id`;
  - the query compared case-sensitively and the radius strictly;
  - sort null or `CREATION_TIME_DESCEND`;
  - no cursor;
  - at least one listing ID, so an empty feed can never bind.

  Listed: the v2 gist (fb-scrap-engine/README.md:170) and the two variables checked (:120-123). → empty-search handling; the risk that every search falls back if Facebook normalises the values.
- §3.5 (old:312) `searchControls` rounding (1 dp and 3 dp), present only with diagnostics on. Listed: its meaning (fb-scrap-engine/README.md:121-123); the recorded shape (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:15-20).
- [N] §3.5, §5.2 (old:314, 667) `sourceBindings` can also be `unknown`, and a verified copy replaces an unverified one. Listed: `verified` or `unverified` (fb-scrap-engine/README.md:410). → the Zod enum.

### §3.7 Feed behaviour (old:327-336)
- [N] §3.7, §5.2 (old:336, 676) A "was" price appears on about 21% of rows. Listed: 39.9% of desktops (fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:88).

### §3.8 Scheduling inside a run (old:338-344)
- [N] §3.8 (old:340-342) Searches and raw URLs run one at a time, in order; the per-call `pageBudget` formula; usage is clamped. Listed: IDs run in parallel batches after searches (fb-scrap-engine/README.md:73-74). → run-time sizing for multi-term runs.

### §3.9 Source statuses and stop reasons (old:346-388)
- [N] §3.9 (old:352) `complete`/`source-exhausted`. Listed: none; Facebook never sent `has_next_page: false` (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:113-115). → `README.md:128`; the fixture test at lines 139-146.
- [N] §3.9 (old:356) `source-results-limit` (the per-source or HTTP listing cap).
- [N] §3.9 (old:358) `truncated`/`request-cap`. Listed: unattempted details only (fb-scrap-engine/README.md:81; fb-scrap-engine/.actor/input_schema.json:91).
- [N] §3.9 (old:359) `continuation-unavailable` as a current degraded code, including every browser-fallback read. Listed: only as the misleading pre-1.0.80 end-of-read code (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:116-117).
- [N] §3.9 (old:361-362) The `blocked` and `extraction-error` statuses with raw messages. Listed: v2 "all-blocked or all-unreadable" (fb-scrap-engine/README.md:170).
- §3.9 (old:364,366) Unreachable values (`verified-empty` for searches, `source-confirmed-empty`, `cursor-cycle-or-no-progress`, `invalid-page-contract`); dataset stop reasons outside the allow-list become `other`.
- [N] §3.9 (old:365) A genuinely empty search always ends `extraction-error` or `failed`, so the app cannot tell "no results" from "failed". Not in the listed files. → never read an empty search as "nothing new"; retry policy.
- [N] §3.9 (old:368-388) The 17 `httpStopReason` codes, the `failureCategory` values and `httpStatus`. Listed: none; `page-cap` was seen (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:14; new Q10). → operator diagnostics.

### §3.10 `searches[].route` (old:390-404)
- [N] §3.10 (old:396) `route: http` can still be degraded (`time-limit` or `continuation-unavailable`), and a tight `maxRequests` reads as `page-cap`.
- [N] §3.10 (old:397) `route: unfinished` (deadline or `request-cap`, for a search that was reached).
- [N] §3.10 (old:400) `route: null` (diagnostics off, HTTP skipped, an exception, or a search the run never started, with `pages: 0`).
- [N] §3.10, §11 (old:402, 1085) The README's "failed when the deadline arrived first" is not what the code emits (`unfinished`). Listed: the README only (fb-scrap-engine/README.md:103-105). → treat any unlisted `route` value as degraded.

### §3.11 When the whole run fails (old:406-415)
- [N] §3.11 (old:408-411) A v3 run ends FAILED, after writing its output, only when no listing was collected and every source is `blocked` or `extraction-error`. Listing-ID runs never fail this way; searches-only runs can. Listed: v2 only (fb-scrap-engine/README.md:170). → job status against coverage.
- §3.11 (old:414) A billing-cap abort also writes nothing. Listed: an aborted run yields nothing (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:309-310).

### §4.1 Where item fetches happen (old:421-430)
- [N] §4.1 (old:423) The discovery fetch order for IDs (graphql, then page, then browser); `collected` means `full_verified`, photos, attributes or a category name, and anything else is `metadata-only`. Listed: the two outcome names (fb-scrap-engine/README.md:335,412). → requeue logic.
- §4.1 (old:428) Detail output order equals input order. The recorded run's dataset order matches `candidateIds` (new §3.1).
- [N] §4.1 (old:429) With `includeDetails: false`, every search row gets `detailOutcome: not-requested-cap`. → ingest of listings-only runs.
- §4.1 (old:430) Detail errors are swallowed, and `detailError` is kept generic so that proxy credentials cannot leak.

### §4.2 The graphql route (old:432-448)
- §4.2 (old:434-436) Sessions have at most 64 cookies; the template must be unique; replies are capped at 2 MiB and 15 s.
- [N] §4.2 (old:437-440, 212, 424) The second fetch:
  - a replay needs the exact ID *and* a `full_verified` description (otherwise `description-missing` or `identity-unverified`);
  - the detail pass fetches an ID a second time if it is not `full_verified` (`detailAttempts` 2);
  - so a listing without a description can cost up to 4 requests;
  - `detailRetryCount` counts these.

  Listed: a failed replay is followed by a page request (fb-scrap-engine/README.md:54-56); "The description pass sent 4 of the 55" (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:241-243). → request sizing.
- §4.2 (old:441) A session also rotates after 3 consecutive failures, or when it has no template.
- [N] §4.2 (old:442) Three failed bootstraps disable replays for the rest of the run. → how route health reads `failedBootstraps`.
- [N] §4.2 (old:443) The breaker thresholds (20 replays, 85%) are fixed and cannot be set from the input. Listed: the thresholds (fb-scrap-engine/README.md:53-54); the test sets them explicitly (fb-scrap-engine/test/route-health.test.js:102).
- [N] §4.2 (old:444-447) The `detailRoute.failures` categories (`identity-unverified`, `network`, `redirect`, `http-status`, `parse`, `empty`, `byte-limit`, `bootstrap-*` and others). Listed: `description-missing` only (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:243). → operations; the route-health port decision.

### §4.3 The page route (old:450-458)
- §4.3 (old:452,454) A cookie-less GET, at most 2 MiB and 15 s; the "changed listing identity" error.
- [N] §4.3 (old:453) At most 2 redirects; a page-route detail fetch reserves 1 request, so no redirect is followed. Listed: a redirect is followed only when the reservation covers it (fb-scrap-engine/README.md:79).
- §4.3 (old:455-457) Limits of structured extraction: 8 MiB of HTML, 256 scripts, 4 MiB per script, 100,000 nodes, depth 80, 8 description matches. Listed: "conflicting, malformed or oversized objects fail closed" (fb-scrap-engine/README.md:412).

### §4.4 How details merge onto a card (old:460-475)
- [N] §4.4 (old:466) v3 labels every item result `seo`, and item title, price, location, coordinates and image never replace a non-empty card value. Listed: none. The recorded provenance is consistent (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:101-132).
- [N] §4.4 (old:468) `money`, `currency`, the availability flags and the other detail fields overwrite the card's values.
- [N] §4.4 (old:472) `price` (the card) and `money` (the item) can disagree after enrichment; use `money`. Listed: none. They were equal on all 20 recorded rows (new §3.3). → `README.md:92`.
- [N] §4.4 (old:475) `collected` does not mean a description was read, because any parsed price counts. → requeue on `descriptionStatus`, not on `detailOutcome`.

### §4.5 `descriptionStatus` and `descriptionComplete` (old:477-514)
- §4.5 (old:479) `descriptionStatus` is a nullable enum in `dataset_schema.json`. Listed: the three values (fb-scrap-engine/README.md:233-241).
- [N] §4.5 (old:485-500) What produces `descriptionComplete` and how merges treat it (exact-ID structured text only; the Open Graph fallback forces false); rows from searches alone are always false. Listed: not documented (new Q11).
- [N] §4.5 (old:502-511) Nabvy storage advice built on the dropped code facts:
  - `description_status` NOT NULL is safe;
  - generate `description_complete` rather than storing it independently;
  - Zod accepts it as optional, with an anomaly check;
  - never set it, because the actor's matcher trusts either flag.

  → the task 0.3 schema and the contracts.

### §4.6 `detailOutcome`, retries and `detailError` (old:516-543)
- [N] §4.6 (old:518-527) The outcomes `not-requested-cap`, `not-requested-request-cap`, `not-requested-time-limit`, `cache-hit` and `cache-deferred`; every v3 row carries an outcome; the summary counts a missing one as `not-requested`. Listed: `collected`, `extraction-error` and `metadata-only` (fb-scrap-engine/README.md:335,412). → the Zod enum; requeue logic.
- [N] §4.6 (old:531) In v3, one retry follows the first round of attempts. Listed: v2 candidate mode (fb-scrap-engine/README.md:302-307); for v3, only the "10% … for one retry of failures" budget (fb-scrap-engine/.actor/input_schema.json:91).
- [N] §4.6 (old:533-534) A failed retry keeps the first `detailOutcome` and adds `detailError`; a successful retry clears it.
- [N] §4.6 (old:536-543) The four fixed `detailError` strings.

### §4.7 and §4.8 Photos and the SEO fallback (old:545-569)
- §4.7 (old:549) Photo URLs are validated: https on fbcdn.net, fbsbx.com or facebook.com; no credentials or port; at most 4,096 characters.
- [N] §4.7 (old:551-552) `photoGalleryComplete` is true only when the validated count equals the raw count, false above 40, and null without a gallery. Listed: check both fields (fb-scrap-engine/README.md:256-258). Recorded: 4 and `true` on row 1, null elsewhere (new §3.3).
- [N] §4.7, §5.2 (old:557, 719) `imageUrl` is not host-validated, unlike `photoUrls`. → UI display.
- §4.8 (old:563-569) The Open Graph checks: the title must not be generic ("Facebook", "Marketplace"); a non-empty `og:description`; `og:image` only from trusted hosts. Listed: ID-bound Open Graph text gives `partial` (fb-scrap-engine/README.md:327-330,412).

### §4.9 Direct `listingIds` (old:571-581)
- [N] §4.9 (old:573-578) The placeholder-row fields (IDs, source maps, `directItemUnresolved`, `descriptionStatus: missing`, outcome `not-requested-time-limit` or `extraction-error`) and how they are rewritten to `not-requested-*`. Listed: `directItemUnresolved` with `extraction-error` (fb-scrap-engine/README.md:332-338); a removed ID returns such a row, verified on v2 only (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:254-255).
- §4.9 (old:579) The exact conditions for `resolvedByDetailPass`. Listed: the flag, and "no failure markers" on the row (fb-scrap-engine/README.md:109-111).
- [N] §4.9, §11 (old:581, 1095) A requested ID that a search also returned is marked attempted before any fetch, which inflates `detailAttemptedCount`. → accounting.

### §4.10 and §4.11 Detail cache and response inventory (old:583-595)
- §4.10 (old:585,587) The cache store name, the `ITEM_<id>` keys, that entries are never evicted, and the status `write-error`. (The cache stays off.)
- §4.11 (old:593) The output is split into `responseInventory.{page,graphql}`.

### §5.1 Output location and timing (old:626-648)
- §5.1 (old:628-632) Write order: listing rows, then `sourceOutcome` rows, then `RUN_SUMMARY`. Recorded: 20 listing rows, then the outcome row (new §3.1).
- §5.1 (old:636-641) Output-schema links; the key-value schema still calls `RUN_SUMMARY` "for v2 runs".

### §5.2 Listing row fields (old:650-743)
- [N] §5.2 (old:666) `foundBySearchTerms` is `[]` on rows that come only from listing IDs.
- [N] §5.2 (old:673) `money.kind` is `fixed`, `free`, `unknown` or `ambiguous`. Recorded: `fixed` only. → `README.md:92`; the fixture test at line 85.
- [N] §5.2 (old:674) `price: 0` means free. Listed: £0 prices occur (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:194-195).
- [N] §5.2, §8 (old:675, 955) Currency mapping: £ to GBP, any $ to USD, € to EUR; USD rows were seen. Listed: Dublin gives EUR (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:57), and "foreign currencies" (:194-195). → `README.md:93`.
- [N] §5.2 (old:677-678) What `variablePrice` (`{min, max}` money) and `sourceComparison` (Facebook's comparable price) mean. Listed: none; null in the recorded run (new Q11).
- §5.2 (old:684,688,692) A title is never invented (`not_exposed`); an empty item subtitles array keeps the card's subtitles; `categoryPath` has at most 12 names.
- [N] §5.2 (old:710) Availability flags can be null. Recorded: all boolean. → `README.md:99`; the fixture test at line 91.
- §5.2 (old:708,711-713) `inventoryCount` is an integer or null; `viewerIsSeller` is false or null; `listedAt` may come from `timestamp`; `originGroup` and `parentListing` are raw objects.
- §5.2 (old:720-723) A card's `listing_photos` passes through unvalidated; `photoUrls` are de-duplicated; `videos` are sanitised raw metadata.
- [N] §5.2, §11 (old:729, 1128) Seller shapes: an item seller is projected to `{id, name, short_name, profile_picture{uri|url}}`, with Facebook-hosted pictures only; a card seller is Facebook's raw object with unrestricted keys. Listed: `{id, name, short_name, profile_picture.uri}` (fb-scrap-engine/docs/design/SELLER_DATA.md:27); "The short name never appeared" (:55); most sellers come from search cards (:35). → the redaction v2 comment; the ingest schema.
- [N] §5.2 (old:730) `sourceFields` is 43% of output bytes. Listed: none. The principle of not sending `sourceFields` to an AI is supported (fb-scrap-engine/README.md:250-252).
- [N] §5.2 (old:731) `sourceFields.directRequest` (`{id}`) on rows for requested IDs, and `sourceFields.dom`.
- [N] §5.2 (old:737) The full provenance vocabulary (`dom`, `not_exposed`, `not_requested`, `ambiguous`, `extraction_failed`, `cached_detail`), and "`seo` in v3 means from the item response". Recorded: `search`, `detail` and `seo` (new §3.3).
- §5.2 (old:743) The 20 legacy fields that v3 never emits. Listed: `targetQuery`, `queryMatch` and `queryMatchStatus` are v2 only (fb-scrap-engine/README.md:220-225; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:417-419).

### §5.3 `sourceOutcome` rows (old:745-762)
- [N] §5.3 (old:753) The `sourceUrl` query allow-list; `null` for URLs outside `/marketplace/`; there is no `listingId` field, so parse it from `/marketplace/item/<id>/`. → mapping outcome rows to IDs.
- [N] §5.3 (old:754) `sourceRoute` values `item`, `search`, `category`, `location` or `null`. Recorded: `search`.
- [N] §5.3 (old:755) The `sourceStatus` enum (`complete`, `verified-empty`, `truncated`, `partial`, `blocked`, `extraction-error`; unknown values become `extraction-error`). → the fixture test at lines 139-146.
- [N] §5.3 (old:757) The `sourceStopReason` allow-list, with fallbacks `blocked`, `extraction-error` and `other`.
- §5.3 (old:758-759) Pages and rows may be null; `resolvedByDetailPass` appears only when true.
- [N] §5.3, §5.4, §8, §11 (old:762, 790, 966, 1094) `RUN_SUMMARY.sourceOutcomes[].stopReason` and diagnostics can hold raw exception text and listing card text, possibly even a proxy URL with credentials (unverified). Use the sanitised rows for anything users see. Listed: none. → the gateway stores the raw summary in `jobs.result` (nabvy/supabase/README.md:26-29); operator tools.

### §5.4 `RUN_SUMMARY` (old:764-792)
- [N] §5.4 (old:778) `searches[].status` is `not-started` when missing; `pages` counts GraphQL pages but not the bootstrap. Recorded: `pages` 1 with `requestsUsed` 2 (consistent).
- §5.4 (old:781,783-784) `detailRetryCount` = Σ max(0, attempts − 1); `detailPageStats` holds at most 10,000 samples; at most 10 `queryIds`.
- [N] §5.4, §7 (old:787, 905) `candidateIds` holds up to 5,000 IDs. Listed: v2 says up to 500 (fb-scrap-engine/README.md:387-389); the v3 cap is not documented (new Q14). → coverage audits of sweeps.
- [N] §5.4 (old:792) All the `diagnostics.httpSearchFirst` fields (`failureCategory`, `httpStatus`, `bootstrapRetries`, `firstStopReason`, `browserFallback`, `deadlineReached`); a browser's `pageDiagnostics` can hold card text. Recorded: 7 fields (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:78-93).

### §5.5 Schema gaps (old:794-813)
- [N] §5.5 (old:794-807) Every fact about `dataset_schema.json`:
  - 86 declared properties, with `additionalProperties: true`;
  - `descriptionComplete` and `resolvedByDetailPass` undeclared;
  - `write-error` missing;
  - no enum for `detailOutcome`;
  - 20 declared fields that are never emitted.

  Listed: no dataset schema (new Q2). → Nabvy's Zod row schema can rest only on observed rows.
- [N] §5.5 (old:811-813) Type notes: `description` is declared `string|object`; `categoryId` is `string|number`; the overview view. Recorded: `categoryId` is a numeric string (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:99). → the fixture test at line 80.

### §6 Costs and performance (old:817-890)
- §6 (old:829) The build label (1.0.79) on the $0.031 sweep. Listed: settled, with no build given (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:316-317).
- §6 (old:838) Cold details at scale: $1.854 for 1,163 listings in 32 min. Listed: about $1.6 per 1,000 (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:318).
- §6 (old:856) "2027-03-21 or -22 (the sources differ)". Every listed file says 2027-03-21 (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:341; fb-scrap-engine/docs/MONETISATION_INPUTS.md:45-46; fb-scrap-engine/docs/design/SCALE_PLAN.md:86).
- [N] §6 (old:864) Discovery-only full reads took 139–165 s for about 1,290 listings over two terms (1.0.77–1.0.78), roughly 70–85 s per term. Listed: none. → `maxRunSeconds` for sweeps.
- [N] §6 (old:868-871) Memory 512–2,048 MB with the heap at 75% (see §2.1).
- §6 (old:888) Lever: `fields`/`omit` on downloads. (This conflicts with lossless collection anyway. The shortest Apify retention is still supported: fb-scrap-engine/docs/design/SELLER_DATA.md:316-317.)

### §7 Limits and failure modes (old:894-936)
- [N] §7 (old:900-905) Limits not in the listed files:
  - terms of at most 80 characters and URLs of at most 2,048;
  - per search, at most 102 requests and 15 s per request;
  - response caps: bootstrap 2 MiB, replies 8 MiB, cursor 4,096 characters;
  - parser caps: 8 MiB and 64 JSON documents;
  - item caps: page 2 MiB and 15 s, 2 redirects, replies 2 MiB, 64 attributes, 16 subtitles, 24 delivery types, 16 videos;
  - browser caps: 500 listings, 20 s.

  Listed: the input ranges (fb-scrap-engine/.actor/input_schema.json:15-183), 40 photos (fb-scrap-engine/README.md:257-258), and browser fallbacks one at a time (:80).
- [N] §7 (old:911-922) The failure-mode codes (`bootstrap-request-failed`, `request-template-unavailable`, `blocked`, empty search as `extraction-error`, `request-cap`, starved IDs). See §3.4, §3.9 and §2.5 above.
- §7 (old:936) The T2 runner had no resume. Listed: results go to `.verification/paired-2026-09-23/` (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:476-478).

### §8 What the app must and must never do (old:940-972)
- [N] §8 (old:944) "Pin a build" and "pass memory and timeout", sourced to an unlisted design. Pinning stays a Nabvy decision (nabvy/docs/questions.md:14). Memory and timeout are supported (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:309-314).
- [N] §8 (old:945,948-949) "Validate with Zod mirroring §2.2", the coverage rule, and "decide on `detailOutcome`/`detailAttempted`, never `detailError`" all rest on the dropped items above.

### §9 The actor repository and its agent (old:976-1052)
- §9 (old:978-989) The `AGENTS.md` rules (reading order, Git exclusions, `npm run spend -- --budget 40 --runs 0`, no AI service chosen). Listed: the dev-machine rule (fb-scrap-engine/docs/HANDOFF.md:82-83; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:16,452-468) and Node 22 or later (fb-scrap-engine/README.md:10).
- §9 (old:991-1007) The docs map (current, historical, logs, validation).
- §9 (old:1009-1016) The build and review process (1.0.82 review rounds: 8, then 9 plus 2 defects). The obsolete-evidence and breach lists are still supported (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:437-468).
- [N] §9 (old:1018-1032) The test suite (42 files, 390 tests) and what it pins, "the de facto contract". → without it Nabvy has no written contract (new Q2).
- §9 (old:1046-1052) The actor's ordered next-work list, including "default proxy country GB" and lazy-loading legacy code. Listed: cards and pivots next (fb-scrap-engine/docs/HANDOFF.md:153-154); the photo query (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:480-481); compact output (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:221-222); v2 to be removed (fb-scrap-engine/README.md:145-146).

### §10 Other code in the repository (old:1056-1075)
- §10 (old:1063-1066) The contents of the query matcher, GPU classifier, valuation (30-day median, at least 10 comparables, bands) and price-drop rule (at least 5,000 minor units *and* at least 5%). Listed: the files are named for reuse (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:241-243); the matcher's unknown/no-match meaning (fb-scrap-engine/README.md:220-230). [N] The price-drop rule would have informed Nabvy's price-drop watch.
- §10 (old:1067-1070) Details of the Monitor store, notifications (1,900-character cap, 5xx/429 treated as unknown), viewer security and review tooling. Listed: gists only (fb-scrap-engine/README.md:247-252,459,480; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:414-422,433-434).
- [N] §10 (old:1071) The spend CLI's Apify endpoints (`/users/me/limits`, `/usage/monthly`, `/actor-runs`). → a reference for the gateway's spend governor.
- §10 (old:1072-1075) Evaluation scripts, `postcodes.io` behind the actor's geo code, sorting, dev scripts. Listed: use a UK postcode service (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:425-428).

### §11 Inconsistencies and open questions (old:1079-1134)
Items not already listed above:
- §11 (old:1098) The graphql template search's 20,000-node budget.
- §11 (old:1112,1117) The test counts 374, 386 and 390; the plan called "custom Bronze". Listed: Creator (fb-scrap-engine/docs/MONETISATION_INPUTS.md:45; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:339).
- [N] §11 (old:1127) The actor's spend check needs the token locally, so Nabvy's governor must live in the gateway (it already does: nabvy/supabase/README.md:45-52).
- [N] §11 (old:1132) Whether Apify injects the schema default `inputVersion: 3` into runs started through the API. (Moot: the gateway requires 3.)
- [N] §11 (old:1133) The key-value record size limit for a `RUN_SUMMARY` holding 5,000 `candidateIds`.

### Not carried over, although the listed files support it (restore in the new reference)
- [N] The description-missing caveat, formerly old:620:
  - the 1.0.82 check had 50 replays, 3 of them failed as `description-missing` (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:237,241-243);
  - route health counts `detailOk` against `detailRequests` (fb-scrap-engine/app/route-health.js:6,13-14,54,91-93), so one such run gives 47/50 = 0.94 < 0.95 with 50 ≥ 50 attempts, which means `page`/`low-success`/`alert` (**computed**);
  - the in-run breaker trips when more than 15% of at least 20 replays fail (fb-scrap-engine/README.md:53-54).

  → nabvy/docs/questions.md:12; nabvy/services/source-adapters/test/route-health.test.ts:190-195.
- [N] Tests T3 (photo fetch, $0.05–0.15), T4 (photo gold set, $0.4–0.6), T5 (block rate, about $0.45 or a stepped ramp), T7 (grid spacing, about $0.05), and the parallel-details and shared-bootstrap tests (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:251-258; fb-scrap-engine/docs/design/SCALE_PLAN.md:131-141). The new reference names only T1, T2 and T6.
- [N] A newest-first check every 30 minutes costs about $3.2 a month per term ($0.0022 × 48 × 30, **computed** from fb-scrap-engine/docs/EVIDENCE_LEDGER.md:319), against about $45 for a full sweep at the same cadence (:430-431).
- [N] The listed container design recommends reusing actor code outside the list: `gateway-input.js`, `gateway-summary.js`, `detail-cache.js`, `review-handoff.js`, `review-verdict.js`, `query-matching.js`, `matching.js`, `valuation.js`, `geo.js`, `postcode.js`, `money.js` and `apify-spend.js` (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:234-247). The ledger recommends the matcher's patterns (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:369-372).
- [N] Which actor Nabvy calls (new Q9) is largely answered by the listed files: private builds 1.0.45–1.0.65 ran on `YfdUav3sZ2BgEf8rh` (fb-scrap-engine/README.md:352-368); the "private Apify verification Actor" is kept separate from "the historical production Actor" (:484); live traffic runs on the "private test Actor" (fb-scrap-engine/docs/HANDOFF.md:82-83) (**inference**).
- [N] The 512 MB dispute leans towards 512 MB working on 1.0.82. The memory guard, which acts only below 1 GB, turned the fallback off in the 512 MB run (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:239; fb-scrap-engine/README.md:88-89), so the "runs at 1 GB" line (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:337-338) looks stale (**inference**).
- Rotherham's seed point (53.4732, −1.3019; fb-scrap-engine/docs/data/city-pages.seed.json:6227-6228) is about 5.6 km from Facebook's centre for it (53.434, −1.355; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:45-47) (**computed**).
- "About 45% cheaper on 200 listings" (fb-scrap-engine/README.md:46-48; fb-scrap-engine/.actor/input_schema.json:119) conflicts with the ledger: the settled −45% comes from a 20-listing pair (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:214-216), while the 200-listing run measured completeness (:222-231).
- The v2 AI handoff leaves raw `sourceFields`, seller metadata and signed photo URLs out of AI payloads (fb-scrap-engine/README.md:250-252).

---

## Nabvy code and docs that rely on out-of-scope sources

The whole repository was searched for the listed patterns, excluding `node_modules` and the old reference itself. That search found explicit hits in only four files: `route-health.ts`, `route-health.test.ts`, `services/source-adapters/README.md` and the redaction v2 migration. The fixture test and the questions log carry old-reference content without citing actor files, so they were found by content and are included. Citations of `HANDOFF.md` in `docs/decisions.md` and `docs/questions.md` all point to material inside its two sections (for example fb-scrap-engine/docs/HANDOFF.md:145,151,188).

### `services/source-adapters/src/domain/facebook-actor-input.ts` and its test (withdrawn in `747c24d`; last version `ae06eaa`)

Neither file exists at HEAD. Before they return, each rule needs a source.

| Where (`…@ae06eaa`) | Rule | Listed files or recorded run | Proposed fix |
| --- | --- | --- | --- |
| `facebook-actor-input.ts:3-6` | "Mirrors the actor's own v3 validation (`src/gateway-input.js`)" | Out of scope | Re-source: "`input_schema.json` ranges plus Nabvy's and the gateway's own rules" |
| `:8` | `PINNED_ACTOR_BUILD = '1.0.82'` | Recorded run on 1.0.82 (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:12); ledger check (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:232-245) | Keep (Nabvy decision) |
| `:13-15` | ≤20 terms, ≤80 characters, ≤1,000 IDs | 20 and 1,000 supported (fb-scrap-engine/.actor/input_schema.json:18,77); 80 is not | Keep 20 and 1,000; drop 80 or keep it as a Nabvy limit marked "not the actor's" |
| `:18-19,151-158` | `termKey`: NFKC, en-GB lower case, whitespace collapsed | Only "duplicates are ignored regardless of case" (fb-scrap-engine/.actor/input_schema.json:18) | Keep as Nabvy's own de-duplication, not a claim about the actor |
| `:33` | `strictObject` (unknown keys fail) | README:95-96 says rejected; the key set equals the schema's properties (fb-scrap-engine/.actor/input_schema.json:8-183) | Keep; re-source |
| `:47` | `cityId` `^\d{5,30}$` | Numeric string only (fb-scrap-engine/.actor/input_schema.json:24-30) | Change to a digit string (`^\d+$`), or mark the bounds unverified |
| `:52` | Listing IDs `^\d{1,30}$` | "numeric listing IDs" (fb-scrap-engine/.actor/input_schema.json:77); recorded IDs have 16–17 digits (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:2945) | Change to `^\d+$` |
| `:49-64` | Numeric ranges and enums | All in the schema (fb-scrap-engine/.actor/input_schema.json:31-160) | Keep; cite the schema |
| `:57,65,66,68-72` | Literals: `browserFallback` false, `useDetailCache` false, `sourceDiagnostics` true, RESIDENTIAL + GB | Supported (fb-scrap-engine/README.md:84-85; fb-scrap-engine/docs/design/SCALE_PLAN.md:76-77; fb-scrap-engine/.actor/input_schema.json:164; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:77-80,333-336) | Keep. `sourceDiagnostics` stays on as the conservative choice; its old rationale (route null without it) is dropped |
| `:80-82` | Terms need `cityId`; `cityId`, `radiusKm` and `sort` only with terms | Not documented. The listed test normalises `{listingIds:['1']}` without `cityId` (fb-scrap-engine/test/route-health.test.js:112) | Keep as Nabvy rules (conservative); do not describe them as the actor's |
| `:85,88,90,92,93` | Needs a source; not searches and IDs together; distinct terms and IDs; `maxDetails` needs `includeDetails` | Not actor rules. "Not both" is an inference from fb-scrap-engine/README.md:73-74 and fb-scrap-engine/docs/EVIDENCE_LEDGER.md:305 | Keep as Nabvy rules; re-source |
| `:100-104` | Memory 512, 1,024 or 2,048; timeout 60–1,800 s | The gateway (nabvy/supabase/migrations/20260924020000_apify_gateway.sql:87-91). The 512 minimum is disputed (fb-scrap-engine/README.md:86-87 against fb-scrap-engine/docs/EVIDENCE_LEDGER.md:337-338) | Keep; mark 512 as disputed |
| `:114` | Throws only when `maxRunSeconds` > timeout (equality allowed) | "Set the Apify timeout above `maxRunSeconds`" (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:309-310) | **Change behaviour**: require timeout > `maxRunSeconds`, with a margin |
| `:120-147` | `actorDefaultMaxRequests` = min(20000, feeds×(pages+3) + items×reserve + maxDetails), with a `maxListings` default of max(500, n) | Only the 20,000 cap (fb-scrap-engine/.actor/input_schema.json:100), the ≈10% detail margin (:91) and per-listing reserves (fb-scrap-engine/README.md:75-78). "+3" and max(500, n) are out of scope | **Change behaviour**: replace it with Nabvy's own documented budget (see the note below the table); never call it the actor's default; always send `maxListings` explicitly |
| `:192-237` | Presets A–D (12/21/189/950 requests, 120/300/900 s, 512/1,024 MB, ≤3-term sweeps at 1,400 per term, 225-ID cap) | Only the patterns (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:63-68), 60 pages and about 1,300 per term (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:303-304), 26 s for 3 page-1 terms (:239), 1 GB for detail runs (fb-scrap-engine/README.md:71-72), batches of about 200 (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:68) | Re-derive the values from Nabvy's own budget. Mark timings as Nabvy choices. Cap detail batches at 200 on the design's authority, not the formula's |
| `facebook-actor-input.test.ts:47-70` | Actor-rejection cases: `minPrice`, `daysSinceListed`, blank term, 81 characters, `cityId` `'1234'`, missing `cityId`, `includeDetails`+`maxDetails`, `radiusKm` without terms, no source | Unknown keys (fb-scrap-engine/README.md:95-96) and schema types and ranges are supported (a JSON number for `cityId` and `'60'` for `maxRequests` violate the declared types: fb-scrap-engine/.actor/input_schema.json:26,97). The rest are out of scope | Keep the cases; rename the test "Nabvy rejects" rather than "what the actor itself rejects" |
| `facebook-actor-input.test.ts:106-139` | Expectations of 12, 1,226 (from the actor's `test/gateway-input.test.js`), 950 and 4 | Out of scope | Drop, or restate them as tests of Nabvy's own budget function |
| `facebook-actor-input.test.ts:179-186` | 225 IDs fit on graphql, 226 do not; 450 fit on page | Derived from the formula | Drop; test the 200-ID batch cap instead |

**A budget that rests only on listed evidence** (proposal, for Nabvy to own):
- **Per search:** 1 bootstrap, plus the pages, plus 1 spare for the documented bootstrap retry (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:107-110). The recorded run used 2 requests for 1 page (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:80,82).
- **Per detail:** 2 requests on graphql, 1 on the page route (fb-scrap-engine/.actor/input_schema.json:91), plus 10% for one retry (same line).
- **Why a generous cap is safe:** `maxRequests` is a hard cap "never exceeded" (fb-scrap-engine/README.md:78), so oversizing only raises the gateway's reservation. An undersized cap shows up as unattempted details (fb-scrap-engine/README.md:81), and Nabvy requeues those.

### `services/source-adapters/src/domain/route-health.ts`

| Where | Claim | Support | Proposed fix |
| --- | --- | --- | --- |
| nabvy/services/source-adapters/src/domain/route-health.ts:1 | A port of `app/route-health.js`, "kept behaviour-for-behaviour identical" | In scope (fb-scrap-engine/app/route-health.js:1-97). One divergence: `:144` adds `successRate !== null`, whereas the JS evaluates `null < minSuccess` as true (fb-scrap-engine/app/route-health.js:54). With a caller option `minAttempts` ≤ 0 and no graphql replays, the JS returns `page`/`low-success` and the port stays on graphql. The defaults never reach this case | Document the divergence in the comment, or remove the extra check so the port really is identical |
| nabvy/services/source-adapters/src/domain/route-health.ts:5-6 | A reply for a listing with no description counts as a failed replay | Supported (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:241-243; fb-scrap-engine/app/route-health.js:13-14) | Cite those lines, not only `docs/questions.md` |

### `services/source-adapters/test/route-health.test.ts`

| Where | Claim | Support | Proposed fix |
| --- | --- | --- | --- |
| nabvy/services/source-adapters/test/route-health.test.ts:9-10 | Eight tests ported; two of the actor's tests exercise its internals | In scope (fb-scrap-engine/test/route-health.test.js:25-135; internals at :99-115) | None |
| nabvy/services/source-adapters/test/route-health.test.ts:191-194 | "The actor's 1.0.82 live check: 50 replays, 47 answered, 3 for listings with no description" | 50 replays with 3 failed as `description-missing` (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:237,241-243). The 47 is derived; the ledger gives no `detailOk` | Cite the ledger lines and say that 47 is computed |

### `services/source-adapters/test/facebook-run-fixture.test.ts` (no citation; carries old-reference content)

| Where | Claim | Support | Proposed fix |
| --- | --- | --- | --- |
| nabvy/services/source-adapters/test/facebook-run-fixture.test.ts:4-6,159 | The input "obeys the actor's v3 rules" | Out of scope | Re-word to "`input_schema.json` properties and the gateway's rules" |
| :17-41 | `V3_INPUT_KEYS` (23 keys) | Equals the schema's properties (fb-scrap-engine/.actor/input_schema.json:8-183) | Re-source the comment; keep |
| :70 | `listingId` matches `^\d{1,30}$` | The length bound is out of scope | Use `^\d+$` or mark the bound unverified |
| :80 | `categoryId` is a string or a number | From the old dataset-schema note; recorded as a numeric string (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:99) | Mark unverified |
| :85 | The `money.kind` enum | Out of scope; recorded `fixed` only | Mark unverified (the fixture passes either way) |
| :91 | Availability values may be null | Out of scope; recorded all boolean | Mark unverified |
| :98 | `descriptionComplete` equals `descriptionStatus === 'full_verified'` | Holds on the 20 recorded rows only; not documented (new Q11) | Keep as an *observed* invariant; say so |
| :139-146 | The `sourceStatus` enum | Out of scope. Only `truncated` was recorded (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:7065); `partial` appears in v2 text (fb-scrap-engine/README.md:170) | Mark unverified; a new value should fail loudly and be documented |
| :162 | `cityId` matches `^\d{5,30}$` | Numeric string only (fb-scrap-engine/.actor/input_schema.json:24-30) | Use `^\d+$` |
| :168 | `maxRunSeconds` ≤ timeout | The ledger says the timeout must be *above* it (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:309-310) | Use `<` if the gateway changes |

### `services/source-adapters/README.md`

| Where | Claim | Support | Proposed fix |
| --- | --- | --- | --- |
| nabvy/services/source-adapters/README.md:5 | "Implemented so far: … actor-input validation with run presets" | Stale: withdrawn (:185-192) | Edit |
| :9 | The actor is called "Marketplace Verification Private" | Not in the listed files or the recorded run. The README says "private Apify verification Actor" (fb-scrap-engine/README.md:484) | Cite the gateway's `actor_info` job, or drop the name |
| :12-15 | The reference was "compiled from a complete read … checked against its code" | Out of scope | Point to the rebuilt reference and its sources |
| :28-57 | "v3 accepts exactly these 23 keys; any other key fails the run before it starts (reference §2.2, §2.4). Integers must be JSON integers." The table includes `inputVersion` 1/2/3, ≤80-character terms, "needs `cityId`", the `cityId` regex and "only with `searchTerms`", a `sort` default of `default`, `listingIds` default `[]`, `maxListings` max(500, n), and `maxRequests` "formula (reference §2.3)" | Key names, types, ranges and most defaults: fb-scrap-engine/.actor/input_schema.json:8-183. "Rejected": fb-scrap-engine/README.md:95-96. The no-country proxy default: fb-scrap-engine/docs/EVIDENCE_LEDGER.md:77-78. The listed items are out of scope | Rebuild the table from `input_schema.json` with line citations; mark "not documented" rows (default `sort`, `maxRequests` formula, `maxListings` with IDs) |
| :64 | Slugs "cannot be source-bound" | Partly supported: slugs redirect and are rejected (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:34-38); extra parameters use the browser route (fb-scrap-engine/.actor/input_schema.json:85) | Re-source |
| :66 | "No category browse in v3" | `startUrls` accepts category URLs (fb-scrap-engine/.actor/input_schema.json:85); category feeds on the fast route are untested (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:486) | Re-word: category URLs only through `startUrls`, which the gateway refuses |
| :69-70,138-139 | "(ADR 0002)" | fb-scrap-engine/README.md:3,134 | Re-source |
| :76 | "About 200 per batch on graphql" (from the 225-ID formula limit) | Batches of up to about 200 (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:68,108-109) | Re-source to the design |
| :77 | "(reference §2.5)" | These are Nabvy and gateway rules (nabvy/supabase/migrations/20260924020000_apify_gateway.sql:93-110) | Re-cite |
| :89 | IDs exceed JavaScript's safe integers | A 17-digit recorded ID (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:2945) | Re-source to the run |
| :91 | "The search card's title wins over the item's" | Observed on 20 rows (provenance `search`) | Say "observed" |
| :92 | The `money.kind` enum; "the card's price can disagree after enrichment" | Out of scope; equal on all 20 rows | Mark unverified; keep "use `money`" as a Nabvy choice |
| :93 | "Any `$` means USD" | EUR for Dublin only (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:57) | Mark the USD mapping unverified |
| :99 | Availability "boolean or null" | "Or null" is out of scope | Mark unverified |
| :104 | `descriptionComplete` "equal to … derive it, never store it" | Observed on 20 rows only; nabvy/docs/decisions.md:38 stores whole rows as `jsonb` anyway | "Observed equal on 20 rows; undocumented; key on `descriptionStatus`; no separate column" |
| :105 | "Only the bootstrap listing (fetched as a page) had photos" | An inference from the run (new §3.3) | Mark as inference |
| :111 | After enrichment the card's `city_page` ID "survives only here" (in `conflicts`) | Wrong: it is also in `sourceFields.search` (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:369-378) | Correct it |
| :124 | "Blocked responses … stop reasons (reference §3.9)" | Vocabulary out of scope (only fb-scrap-engine/README.md:170 for v2) | Mark unverified |
| :126 | Requests include redirects and failed replays | Supported (fb-scrap-engine/README.md:54-56,76-78) | Re-cite |
| :128 | Coverage is complete only on `http` with `source-no-new-listings` or `source-exhausted`; `results-limit` is our cap "(reference §3.10)" | `source-exhausted` and the `results-limit` meaning are out of scope. fb-scrap-engine/README.md:101-108 covers the rest; `results-limit` was recorded (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:12) | **Change behaviour** (conservative): complete only on `route: http` with `source-no-new-listings`; `page-cap` and `results-limit` are "our cap"; anything else is degraded |
| :160-161 | "Obeys the actor's v3 rules" | Out of scope | Re-word |

### `supabase/` (migrations and README)

| Where | Claim | Support | Proposed fix |
| --- | --- | --- | --- |
| nabvy/supabase/migrations/20260924024000_apify_gateway_redact_v2.sql:1-4 | "After reading the actor's code in full": card sellers are unprojected, and item sellers can carry `short_name` and `profile_picture.url` (`src/item-structured.js:85-91`) | `short_name` is listed (fb-scrap-engine/docs/design/SELLER_DATA.md:27) but never appeared (:55). `.url` and "unprojected" are out of scope. Recorded sellers have `{id, name, profile_picture{uri}}` (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:52-58) | Do not edit the applied migration. Add a note in nabvy/supabase/README.md re-sourcing it. Keep the behaviour: redaction ignores keys, so it is safe whatever the shape |
| nabvy/supabase/migrations/20260924020000_apify_gateway.sql:99-100 | `maxRunSeconds` ≤ timeout (equality allowed) | Timeout *above* `maxRunSeconds` (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:309-310) | **Change behaviour** in a new migration: strict, with a margin |
| same :108-110 | Only the presence of `proxyConfiguration` is checked | RESIDENTIAL and GB are the reliable choice (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:77-80,333-336) | **Change behaviour**: require RESIDENTIAL and `apifyProxyCountry: "GB"` |
| same :93-110 | `useDetailCache` is not checked | No second durable copy in Apify (fb-scrap-engine/docs/HANDOFF.md:220-221; fb-scrap-engine/docs/design/SCALE_PLAN.md:76-77) | **Change behaviour**: refuse `useDetailCache: true` |
| same :81,93,96 | `->> … ::integer` accepts `"60"` and `"3"` as strings | The schema types are integer (fb-scrap-engine/.actor/input_schema.json:10,97) | **Change behaviour**: require `jsonb_typeof = 'number'` |
| same :87-88 | Memory 512, 1,024 or 2,048 | 512 is disputed; 2 GB runs happened (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:313); the 2,048 maximum is not documented | Keep; note it |
| nabvy/supabase/README.md | No actor-file citations; it describes the gateway's own rules (:17-20) | Nabvy's own | Update only if the migrations change |

### Docs

| Where | Claim | Support | Proposed fix |
| --- | --- | --- | --- |
| nabvy/docs/questions.md:10 | "The actor's code sets it to exactly `descriptionStatus === 'full_verified'` (`docs/fb-actor-reference.md` §4.5)" | Code is out of scope; observed on 20 rows (new §3.3, Q11) | Re-word as observed; cite new Q11 |
| nabvy/docs/questions.md:12 | The caveat, citing the old §4.12 | Supported (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:237,241-243; fb-scrap-engine/app/route-health.js:13-14,54; fb-scrap-engine/README.md:53-56) | Re-cite to those lines |
| nabvy/docs/questions.md:14 | "The actor repository does not say which build `latest` points to" | That came from reading outside the list. The listed files are also silent (new §2.1); the recorded run resolved `latest` to 1.0.82 (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:12,16) | Re-word to "the listed files do not say" |
| nabvy/docs/questions.md:15 | Photos: no gallery on graphql; capture not built | Supported (fb-scrap-engine/.actor/input_schema.json:119; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:3-4,97-107,255). "Fetched as a page" is an inference | Mark the inference |
| nabvy/docs/questions.md:17 | Names `facebook-actor-input.ts` comments citing `src/gateway-input.js` | The file is withdrawn | Update when this report lands |
| nabvy/docs/progress.md:14-15 | "Full reference in `docs/fb-actor-reference.md`"; "real input schema … in `services/source-adapters/README.md`" | The README's table is out of scope (see above) | Update after the replacement |
| nabvy/docs/fb-actor-sources.md:15-18 | Points to the old reference, "being rebuilt" | — | Point to the rebuilt reference |
| nabvy/docs/decisions.md:7-26,46-54 | Cites HANDOFF (two sections), the designs and the seed only | In scope. `:46` "not written yet" is still true locally at 09:28 UTC | None. Optional: `:18` "T2" is the actor's test, and could be confused with Nabvy's T2 timestamp (nabvy/docs/architecture.md:88); say "actor test T2" |
| nabvy/CLAUDE.md:5,9,12 | Precedence; actor rules; the seller-data supersession | Owner's rules (nabvy/docs/fb-actor-sources.md:51-59), consistent with fb-scrap-engine/docs/HANDOFF.md:82-93 | None |
| nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/README.md | Run facts | All from the run files (for example nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:15-20) | None |

---

## Questions for the owner

1. **Can the actor's owner write down the v3 input contract?** The listed files give types and ranges but not:
   - the accepted-key behaviour;
   - ID and term formats;
   - which field combinations are refused;
   - the defaults for `sort`, for `maxListings` with IDs, and for `maxRequests`;
   - what a rejected input looks like (Apify status, message, `RUN_SUMMARY`).

   *Meaning:* Nabvy's validation can enforce only the schema plus its own rules, and cannot compute the actor's default `maxRequests`. The withdrawn presets must use Nabvy's own budget. *Restores it:* `APP_INTEGRATION_GUIDE.md`, which HANDOFF says will give "the contracts … and how to call the Actor" (fb-scrap-engine/docs/HANDOFF.md:118-119), or the same text in `README.md` or the schema descriptions. Otherwise, add `src/gateway-input.js` and `test/gateway-input.test.js` to the reading list.
2. **Can a dataset schema and a `RUN_SUMMARY` schema be added to the list?** Examples are `.actor/dataset_schema.json`, or the same content in the guide, with the full vocabularies:
   - `status`, `stopReason`, `route` (including `unfinished` and `null`), `detailOutcome`, `detailError`, `detailRoute.failures`, `sourceStatus` and `sourceStopReason`;
   - the field meanings of `descriptionComplete`, `price` against `money`, `money.kind`, currency symbols including `$`, `variablePrice`, `sourceComparison`, and the seller shapes.

   *Meaning:* Nabvy's Zod row and summary schemas, its coverage rule and its requeue rule can only be built from one 20-row run, so unknown values must be treated as degraded or unattempted. *Restores it:* those files on the list.
3. **What does an empty search look like, and when does a v3 run end FAILED?** The dropped facts said an empty search can never be verified and ends `extraction-error`, and a searches-only run with all searches failed or empty ends FAILED. *Meaning:* without this, Nabvy may mistake "no results" for a failure, or the reverse. *Restores it:* one paragraph in `README.md` (today only v2 is described: fb-scrap-engine/README.md:170).
4. **What do requests and time cost per search and per detail?** The gaps are:
   - bootstrap, pages, the retry spare and the fallback reserve;
   - the second detail fetch (up to 4 requests for a listing without a description);
   - whether the graphql session page counts as a detail request (new Q12);
   - seconds per term for full reads.

   *Meaning:* the gateway's 1,000-request cap and its cost reservation (0.5 MB per request: nabvy/supabase/migrations/20260924020000_apify_gateway.sql:19,27) are sized without the actor's own arithmetic. *Restores it:* an extension of the README's "Cost controls", or a ledger entry.
5. **What can `RUN_SUMMARY` and the run's key-value store contain?** The dropped facts said raw exception text, possibly proxy URLs with credentials (unverified), listing card text, and Crawlee session state (cookies not established). *Meaning:* Nabvy stores the raw summary in `apify_gateway.jobs.result` and committed a `RUN_SUMMARY` fixture (nabvy/supabase/README.md:26-29; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/README.md:19). Until this is answered, treat both as internal-only. *Restores it:* a statement in the README.
6. **Which build does `latest` point to, and should Nabvy pin?** Also: is the production actor frozen, and at which build? The old reference drew these from HANDOFF lines outside the two sections (old:42,47). *Restores it:* extend the HANDOFF reading to its status lines, or state the current build in `README.md`. The listed files already support `YfdUav3sZ2BgEf8rh` being the private test and verification actor (fb-scrap-engine/README.md:352-368,484), so new Q9 needs only a confirmation.
7. **Is the "$0.01 (short)" full-sweep figure settled or estimated?** The design labels it settled (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:60,65). The dropped evidence said a settled short feed cost $0.003 and that $0.01 had no run behind it. *Meaning:* cadence and spend planning. *Restores it:* a ledger entry with the run IDs.
8. **The listed container design recommends reusing twelve actor source files that are not on the list** (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:234-247). Should any of them be added to the reading list, for example `money.js` and `query-matching.js`? Or does Nabvy write its own (nabvy/docs/decisions.md:46)? The conservative default is to write Nabvy's own.
9. **Should Nabvy adopt these rules as its own policy?** They stand without the actor's code:
   - never mix searches and `listingIds` in one run;
   - require timeout > `maxRunSeconds`;
   - have the gateway refuse `useDetailCache: true`, non-GB or non-residential proxies, and string-typed integers;
   - count coverage as complete only on `http` with `source-no-new-listings`.

   All of these are conservative.
10. **The description-missing caveat** (nabvy/docs/questions.md:12) is now backed by listed files (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:241-243; fb-scrap-engine/app/route-health.js:54). The rebuilt reference should hold it. The owner's decision on the port (subtract `description-missing` from attempts, or not) is still pending.
11. **The two pending documents and T2.** As of 09:28 UTC:
    - `APP_INTEGRATION_GUIDE.md` and `COPY_ADVERT_SPAM.md` are absent from the local checkout, and GitHub was not checked;
    - all 13 listed files are unchanged since 01:04 UTC;
    - T2's results are expected after about 21:00 UTC (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:476-478; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:254). They will reach Nabvy only through a ledger or design update.

    Recheck through the session's GitHub access (nabvy/docs/fb-actor-sources.md:4-5) once the actor's owner pushes, and compare the fingerprints in the new reference's preamble. Items 1–5 would mostly be answered if the guide lands.
