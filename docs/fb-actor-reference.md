# Facebook actor reference

**What this is.** Nabvy's working reference for the owner's private Apify actor, "Facebook Marketplace Gateway" (fb-scrap-engine/.actor/input_schema.json:2). It says how Nabvy calls the actor, what to send, what comes back, what it costs, how it fails, and what the listed files say the app must do. The actor is a plain fetch tool: it runs the searches it is given, fetches item details and returns every listing it found, without filtering or judging them (fb-scrap-engine/README.md:3; fb-scrap-engine/.actor/input_schema.json:3). Nabvy does everything else.

**Sources.** This reference was rebuilt on 2026-09-24 from the owner's listed files only, plus Nabvy's own recorded run of the actor. No other file in the actor repository was opened, listed, searched or cited, and its git history was not used. The files were read at 2026-09-24 08:53 UTC. The fingerprints below let a later pass see whether any of them has changed since.

| Listed file (in fb-scrap-engine/) | Part used | Lines | sha256 (first 12) | Modified (UTC) | The file's own status line |
| --- | --- | ---: | --- | --- | --- |
| docs/HANDOFF.md | **Lines 80–253 only:** "Rules" (80–112) and "The app: what we want it to do, and what the data allows" (114–252) | 427 | 70853648f4fc | 2026-09-24 01:04 | Owner decisions dated 2026-09-24 (fb-scrap-engine/docs/HANDOFF.md:87, fb-scrap-engine/docs/HANDOFF.md:94) |
| docs/design/PARTS_INTELLIGENCE.md | all | 395 | 68000f48b577 | 2026-09-24 01:04 | "proposed, 2026-09-24" (fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:3) |
| docs/design/CONTAINER_LISTINGS.md | all | 261 | a22ec1d2b08b | 2026-09-24 01:04 | "proposed, 2026-09-23" (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:3) |
| docs/design/SELLER_DATA.md | all | 364 | 1cdd729407b9 | 2026-09-24 01:04 | "proposed, 2026-09-24. This is not legal advice." (fb-scrap-engine/docs/design/SELLER_DATA.md:3) |
| docs/data/city-pages.seed.json | all | 8,506 | 64b48cf96ebf | 2026-09-24 01:04 | Runs of 2026-09-22 to 2026-09-23 (fb-scrap-engine/docs/data/city-pages.seed.json:2) |
| docs/data/part-patterns.json | all | 99 | 25d64b70e5b4 | 2026-09-24 01:04 | From the 2026-09-24 offline parts analysis (fb-scrap-engine/docs/data/part-patterns.json:2) |
| app/route-health.js | all | 97 | 4f01b100e6a1 | 2026-09-24 01:04 | "For the calling web app, not the Actor" (fb-scrap-engine/app/route-health.js:1) |
| test/route-health.test.js | all | 135 | 4e6416997e8f | 2026-09-24 01:04 | — |
| .actor/input_schema.json | all | 185 | 763a256afb96 | 2026-09-24 01:04 | — |
| docs/design/SCALE_PLAN.md | all | 141 | a7ede334db02 | 2026-09-24 01:04 | "proposed, 2026-09-23" (fb-scrap-engine/docs/design/SCALE_PLAN.md:3) |
| docs/MONETISATION_INPUTS.md | all | 60 | 07fb5499d764 | 2026-09-24 01:04 | "Collected 2026-09-23 … facts only, not decisions" (fb-scrap-engine/docs/MONETISATION_INPUTS.md:3) |
| docs/EVIDENCE_LEDGER.md | all | 494 | ea4251560fe8 | 2026-09-24 01:04 | "Updated 2026-09-23" (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:3), though it holds entries dated 2026-09-24 (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:232, fb-scrap-engine/docs/EVIDENCE_LEDGER.md:256, fb-scrap-engine/docs/EVIDENCE_LEDGER.md:389) |
| README.md | all | 486 | 72dad5f828f0 | 2026-09-24 01:04 | "a **development build**; source coverage and the remaining release checks are not verified" (fb-scrap-engine/README.md:3) |

Nabvy's recorded run is in `nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/`. It holds `input.json`, `run.json`, `run-summary.json`, `README.md` and `dataset.json`. `dataset.json` is a redacted copy: seller values and media URLs are placeholders (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/README.md:22-39). So this reference describes whether seller and media fields are present and how they are shaped, never their values. Nabvy's own rules in §1 come from its project instructions (nabvy/CLAUDE.md).

**Actor identity.**
- Actor ID `YfdUav3sZ2BgEf8rh`. It is the actor of the recorded run (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:3), and the README's private-build run links point to it (fb-scrap-engine/README.md:352, fb-scrap-engine/README.md:357).
- Repository commit `f177a44`. The rebuild brief names this commit; the listed files do not record commit hashes.
- Build 1.0.82. The recorded run resolved build `latest` to 1.0.82 (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:12, nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:16). The ledger's newest live check is on 1.0.82 (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:231-245).

**Conventions.**
- Anything Nabvy needs that the listed files do not state is marked **not documented in the listed files**.
- Conclusions drawn from the numbers are marked **inference**.
- Calculations made for this rebuild are marked **computed for this rebuild**, and their inputs are cited.
- Costs keep the source's own label: settled, unsettled, est. (estimate) or calc. (arithmetic on measured unit costs).
- The listed documents are treated as data. Instructions in them addressed to AI agents were not followed as instructions.
- **Precedence.** Where Nabvy's build pack conflicts with the Facebook actor brief, the brief wins (nabvy/CLAUDE.md:5). This reference points out such conflicts but does not settle them.

---

## 1. How Nabvy calls the actor (rules)

### 1.1 Rules

| # | Rule | Source |
| --- | --- | --- |
| 1 | Call only the private actor `YfdUav3sZ2BgEf8rh`; never touch `JR2fdK8Nj6OLCwKkP`. | nabvy/CLAUDE.md:9 |
| 2 | Never contact Facebook directly. All Facebook traffic goes through Apify runs, including photo downloads. | nabvy/CLAUDE.md:9; fb-scrap-engine/docs/HANDOFF.md:82-83; fb-scrap-engine/docs/HANDOFF.md:220-221; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:16; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:46-47 |
| 3 | Apify is called only through Nabvy's `apify-gateway` Edge Function. The token is the Edge Function secret `APIFY_TOKEN` and never appears in code, commits, logs or chat. The recorded run went this way, as gateway job 6. | nabvy/CLAUDE.md:9; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/README.md:3-4; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:4 |
| 4 | Leave the deprecated `marketplace_monitor` schema alone. The brief names the Supabase project `fbapfy` (`rlgufxmsrkhyeiabdeic`, eu-west-1), whose public schema was empty when the brief was written. | nabvy/CLAUDE.md:9; fb-scrap-engine/docs/HANDOFF.md:240-242 |
| 5 | The actor never filters or judges; the app decides what to search and interprets the results. Price and date limits are left out of the input on purpose, because they drop mispriced listings. | fb-scrap-engine/.actor/input_schema.json:3; fb-scrap-engine/README.md:3; fb-scrap-engine/README.md:134; fb-scrap-engine/docs/HANDOFF.md:84-86; fb-scrap-engine/docs/HANDOFF.md:155; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:113 |
| 6 | Plan searches per region (a verified centre `cityId` × a few terms), never per user. Never run fetches or AI per user. | fb-scrap-engine/docs/HANDOFF.md:140-141; fb-scrap-engine/docs/HANDOFF.md:220-221; fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:228-229 |
| 7 | Keep no second durable copy in Apify: send `useDetailCache: false` on all app-driven runs. | fb-scrap-engine/docs/HANDOFF.md:220-221; fb-scrap-engine/docs/design/SCALE_PLAN.md:76-77; fb-scrap-engine/.actor/input_schema.json:145 |
| 8 | Send `inputVersion: 3`. v2 and Monitor inputs are deprecated. Inputs using `searchQuery` and `maxPrice` enter a legacy Monitor route, so Nabvy must not send them. | fb-scrap-engine/.actor/input_schema.json:11; fb-scrap-engine/README.md:145-147; fb-scrap-engine/README.md:420-421; fb-scrap-engine/README.md:463 |
| 9 | Use numeric city-page IDs as `cityId`, never town slugs. Slugs redirected, and several such runs showed San Francisco listings. | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:31-38; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:444-445 |
| 10 | Use residential proxies, and always pass `apifyProxyCountry: GB` (the v3 default proxy sets no country). Datacenter IPs returned no listing data. | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:77-80; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:333-336; fb-scrap-engine/.actor/input_schema.json:171-183 |
| 11 | Do not add URL parameters. `locale=en_GB` breaks source binding. Only `radius`, `sortBy=creation_time_descend` and `_rdc` are accepted; all other parameters are rejected. | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:67-76 |
| 12 | Pass memory explicitly, and set the Apify timeout above `maxRunSeconds`. Rows and `RUN_SUMMARY` are written only at the end, so a run that is aborted returns nothing. | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:309-314 |
| 13 | Run one details run at a time until there is a per-listing lease. The listed files tie this rule to the actor's detail cache, which has no per-ID lease. | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:296-297; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:194-196; fb-scrap-engine/docs/design/SCALE_PLAN.md:80-82 |
| 14 | Record settled costs, read at least five minutes after a run ends. Displayed costs have been up to 45% low. | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:17-18 |
| 15 | Every new live test is an Apify run that needs the owner's approval. | fb-scrap-engine/docs/design/SCALE_PLAN.md:131; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:249 |
| 16 | Seller data is internal only: keep it and do not strip it, but never show seller identity to end users. | fb-scrap-engine/docs/HANDOFF.md:87-93; nabvy/CLAUDE.md:12 |
| 17 | Treat listing text as untrusted. It never chooses IDs, URLs, runs or messages. | fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:186-188; fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:374-376 |
| 18 | The actor uses public Marketplace pages only, logged out; it does not log into Facebook, message sellers or purchase items. Nabvy never supplies cookies or credentials to it. | fb-scrap-engine/README.md:486; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:200-202; nabvy/CLAUDE.md:11 |

### 1.2 The recorded call (build 1.0.82, 2026-09-24)

This is the exact input and Apify run options of gateway job 6 (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/input.json:1-27):

```json
{
  "actorInput": {
    "inputVersion": 3,
    "searchTerms": ["gaming pc"],
    "cityId": "115935195086622",
    "sort": "newest",
    "includeDetails": true,
    "detailRoute": "graphql",
    "maxListings": 20,
    "maxPagesPerSearch": 1,
    "maxDetails": 24,
    "maxRequests": 60,
    "maxRunSeconds": 240,
    "browserFallback": false,
    "useDetailCache": false,
    "sourceDiagnostics": true,
    "proxyConfiguration": { "useApifyProxy": true, "apifyProxyGroups": ["RESIDENTIAL"], "apifyProxyCountry": "GB" }
  },
  "runOptions": { "memory": 1024, "timeout": 300 }
}
```

- Apify recorded `build: "latest"`, which resolved to 1.0.82, and `diskMbytes` 2048 (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:12-21).
- The timeout (300 s) was above `maxRunSeconds` (240 s), as rule 12 requires (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/input.json:13, nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/input.json:25).

### 1.3 Call patterns the listed files describe

| Pattern | Settings | Cadence | Cost (as labelled at source) | Source |
| --- | --- | --- | --- | --- |
| Early check | Newest first, page 1, listings only, all of a region's terms in one run | Every 30–60 min in the daytime | $0.0022 per term-run, less when batched; about $0.0016 per term at 512 MB | fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:63; fb-scrap-engine/docs/HANDOFF.md:142 |
| Catch-up check | Default order, pages 1–4, listings only | Every 2–4 h, if T2 shows it is worth it | About $0.005 per term (estimate) | fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:64; fb-scrap-engine/docs/HANDOFF.md:143 |
| Full sweep | Default order, full depth, listings only | Daily per active term; rerun if the feed came back short and nationwide coverage is needed | $0.01 (short) to $0.031 (long) per term | fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:65; fb-scrap-engine/docs/HANDOFF.md:144 |
| Details | `listingIds` batches chosen by the app (one global queue, batches of up to 200); `graphql`, or `page` where photo links are needed | From the app's queue | `graphql` about $0.00092 each; `page` about $0.00166 | fb-scrap-engine/docs/HANDOFF.md:148-150; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:68 |
| Repeat of a search | Run it again with `includeDetails: false`, then send only listings not yet described through `listingIds` | — | — | fb-scrap-engine/README.md:135-139 |

- The cadence itself is set by test T2, which was still running when the files were written: "T2 sets the cadence" (fb-scrap-engine/docs/HANDOFF.md:145; fb-scrap-engine/docs/design/SCALE_PLAN.md:54-56).
- A full read of one term needs about 60 pages (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:302-304), and the fixed search grid puts city IDs 80–100 km apart (fb-scrap-engine/docs/design/SCALE_PLAN.md:71-73).

---

## 2. Input

### 2.1 Fields

The input schema is an object (`schemaVersion` 1) with `additionalProperties: true` and no `required` list (fb-scrap-engine/.actor/input_schema.json:4-7). `inputVersion` is the only field with a schema `default`. Every other default below comes from description text (fb-scrap-engine/.actor/input_schema.json:8-183).

| Field | Type | Default | Limits | Meaning | Recorded run | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `inputVersion` | integer (hidden in Console) | 3 | — | "3 is the gateway contract. Deprecated v2 jobs must send 2 explicitly." | 3 | fb-scrap-engine/.actor/input_schema.json:8-14 |
| `searchTerms` | array of strings | none stated (Console prefill `["road bike"]`) | up to 20; duplicates ignored regardless of case | Each term runs as its own Marketplace search in `cityId`. | `["gaming pc"]` | fb-scrap-engine/.actor/input_schema.json:15-23; fb-scrap-engine/README.md:39-43 |
| `cityId` | string (numeric) | none (prefill `115935195086622`) | — | A Facebook city-page ID (for example Chichester, West Sussex, `115935195086622`). IDs taken from listing cards work too. | `"115935195086622"` | fb-scrap-engine/.actor/input_schema.json:24-30; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:39-47 |
| `radiusKm` | integer | Facebook's default ("65 km when last observed") | 1–500 | The area Facebook searches. It is sent and verified, but it is not a filter and in tests did not change results. "Newest-first results are not limited by it." Newest-first sets differed slightly by radius (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:155-157). | not sent; Facebook reported 65 | fb-scrap-engine/.actor/input_schema.json:31-38; fb-scrap-engine/README.md:117-124 |
| `sort` | string: `default` or `newest` | not documented (no schema default) | — | `default` is Facebook's order; `newest` lists the most recently posted first. | `"newest"` | fb-scrap-engine/.actor/input_schema.json:39-52 |
| `includeDetails` | boolean | on | — | Fetch each listing's public description, photos and attributes. Off returns search cards only. | `true` | fb-scrap-engine/.actor/input_schema.json:53-57 |
| `maxListings` | integer | 500 (Console prefill 100) | 1–5,000 | Total listings across all searches in the run. | 20 | fb-scrap-engine/.actor/input_schema.json:58-65; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:305 |
| `maxPagesPerSearch` | integer | 20 | 1–100 | How deep each search reads, in pages of "roughly 22 listings". | 1 | fb-scrap-engine/.actor/input_schema.json:66-73 |
| `listingIds` | array of strings | none | up to 1,000 (200 before build 1.0.82) | Numeric listing IDs fetched directly, in parallel. Each forces a fresh fetch that bypasses the cache (`forceRefresh`). | not sent | fb-scrap-engine/.actor/input_schema.json:74-81; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:250-253 |
| `startUrls` | array (`requestListSources`) | none | up to 100 | "Escape hatch": Marketplace search, category or location URLs. URLs with extra parameters use the slower browser route. Category browse feeds on the fast route are untested (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:486). | not sent | fb-scrap-engine/.actor/input_schema.json:82-87 |
| `maxDetails` | integer | `maxListings` plus 10% | 0–6,000 | Cap on item-detail requests. Listings beyond it come back without details, counted as unattempted. | 24 | fb-scrap-engine/.actor/input_schema.json:88-94 |
| `maxRequests` | integer | "enough for the page and detail caps" | 1–20,000 | Hard cap on search and item requests; "the cap is never exceeded". | 60 | fb-scrap-engine/.actor/input_schema.json:95-101; fb-scrap-engine/README.md:75-78 |
| `maxRunSeconds` | integer | 900 | 10–3,600 | Collection deadline. | 240 | fb-scrap-engine/.actor/input_schema.json:102-108 |
| `detailConcurrency` | integer | 4 | 1–8 | Parallel item requests. 8 against 4 is untested (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:482). | not sent | fb-scrap-engine/.actor/input_schema.json:109-115 |
| `detailRoute` | string: `page` or `graphql` | `graphql`; `page` when cached details are reused | — | `page` downloads each item page, with its photo gallery. `graphql` replays Facebook's item request after one page per session, and returns no gallery. | `"graphql"` | fb-scrap-engine/.actor/input_schema.json:116-129; fb-scrap-engine/README.md:45-58 |
| `detailSessionSize` | integer | 40 | 5–100 | With `graphql`, how many listings share one proxy session (and IP). The normaliser rejects 1. | not sent | fb-scrap-engine/.actor/input_schema.json:130-136; fb-scrap-engine/test/route-health.test.js:111-115 |
| `browserFallback` | boolean | on; the actor turns it off itself below 1 GB of memory | — | When the fast HTTP route fails, read one page with a browser (about 9 times the cost). Off: the search is reported as failed so the app can rerun it. | `false` | fb-scrap-engine/.actor/input_schema.json:137-141; fb-scrap-engine/README.md:84-89 |
| `useDetailCache` | boolean | off | — | Reuse complete item details this actor fetched recently. "Turn it on only for standalone use." | `false` | fb-scrap-engine/.actor/input_schema.json:142-146 |
| `detailCacheTtlHours` | integer | 6 | 1–168 | Cache lifetime. | not sent | fb-scrap-engine/.actor/input_schema.json:147-153 |
| `detailCacheRetryMinutes` | integer | 60 | 5–1,440 | Retry delay for incomplete details. | not sent | fb-scrap-engine/.actor/input_schema.json:154-160 |
| `sourceDiagnostics` | boolean | on | — | "Record every observed listing ID and HTTP route details in the run summary." | `true` | fb-scrap-engine/.actor/input_schema.json:161-165 |
| `responseInventory` | boolean | off | — | Diagnostic. Writes `RUN_SUMMARY.responseInventory`: where item pages and replay responses embed other listings, related data and preloaded queries (key paths and counts only, no values). | not sent | fb-scrap-engine/.actor/input_schema.json:166-170 |
| `proxyConfiguration` | object (`proxy` editor) | Console prefill Apify `RESIDENTIAL`, country `GB`; "The v3 default proxy sets no country" | — | "Residential proxy in the city's country is the reliable choice." | RESIDENTIAL, GB | fb-scrap-engine/.actor/input_schema.json:171-183; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:77-80 |

**Apify run options** (not actor input):

| Option | What the listed files say | Recorded run | Source |
| --- | --- | --- | --- |
| Memory | The `actor.json` default is 1 GB. Keep 1 GB for detail runs; pass memory explicitly. Whether 512 MB is allowed is disputed: see §2.2, rule 9. | 1024 MB | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:311-314; fb-scrap-engine/README.md:71-72; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/input.json:24 |
| Timeout | Set it above `maxRunSeconds`. | 300 s | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:309-310; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/input.json:25 |
| Build | Not documented in the listed files. | `latest`, resolved to 1.0.82 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:12, nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:16 |

### 2.2 Rules between fields

1. **`maxListings` is shared** by every search in a run; it is not a per-search cap (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:305; fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:144-145).
   - In the recorded run it cut page 1 short. The search stopped with `stopReason: "results-limit"` at 20 listings (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:11-12).
   - A page holds "roughly 22 listings" (fb-scrap-engine/.actor/input_schema.json:69), and newest-first page 1 held 24 in the 1.0.82 check (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:239).
   - So the recorded run probably did not return all of page 1 (**inference**).
   - The parts design's gap-fill plan asks for `maxListings` of about 8,000 for six full-depth terms in one run (fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:141-145). That is above the schema maximum of 5,000 (fb-scrap-engine/.actor/input_schema.json:61-63). At about 1,300 listings per full feed (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:303-304), six terms need about 7,800 (**computed for this rebuild**), so the run must be split, for example into two runs of three terms (**inference**).
2. **Time split.** "Searches get half of `maxRunSeconds` when details are on" (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:306).
3. **Order and limits.** Listing-ID runs fetch in parallel batches of `detailConcurrency`, after any searches, within the request, result and time limits (fb-scrap-engine/README.md:73-74).
   - The README's "result" limit points to a result cap without naming it: it does not say whether that result limit is `maxListings` or how listing IDs share it with searches (fb-scrap-engine/README.md:73-74; fb-scrap-engine/.actor/input_schema.json:61).
4. **Request reservation.**
   - Each listing reserves the most it could send (a failed replay, its page and any browser fallback), then gives back what it did not use (fb-scrap-engine/README.md:75-78).
   - Every request counts toward `maxRequests`, including each item-page redirect followed. A redirect is followed only when the listing's reservation covers it (fb-scrap-engine/README.md:76-79).
   - With an explicit `maxRequests`, searches keep their page allowance first and details get the rest (fb-scrap-engine/README.md:82-83).
5. **`maxDetails` with `graphql`.** Each listing reserves two requests until it finishes, "so a cap set to exactly the listing count can leave the last listing unattempted" (fb-scrap-engine/.actor/input_schema.json:91). The recorded run set `maxDetails` 24 for `maxListings` 20 (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/input.json:9-11).
6. **`detailRoute` and the cache.** The default is `graphql`. With `useDetailCache` on it becomes `page`, "because cached records keep photo galleries" (fb-scrap-engine/README.md:45; fb-scrap-engine/README.md:57-58). `detailSessionSize` applies only to `graphql` (fb-scrap-engine/.actor/input_schema.json:133).
7. **`includeDetails: false` with the cache on.** Listings-only rows can still carry cached descriptions (and coordinates), so read `descriptionStatus` per row (fb-scrap-engine/README.md:113-115; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:178-182). This does not arise with `useDetailCache: false`.
8. **`browserFallback: false`** reports a failed HTTP search as `route: failed` instead of paying for a one-page browser crawl (fb-scrap-engine/README.md:84-85).
   - Below 1 GB the actor turns the fallback off itself and notes it in `RUN_SUMMARY.memoryGuard` (fb-scrap-engine/README.md:88-89).
   - v2 and Monitor inputs refuse to start below 1 GB (fb-scrap-engine/README.md:88-89).
9. **512 MB.** The listed files disagree:
   - README: listings-only checks with the fallback off "can run at 512 MB, the Actor's minimum" (fb-scrap-engine/README.md:86-87).
   - Ledger: "`actor.json` sets a 1 GB minimum, so a 512 MB request runs at 1 GB" (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:337-338).
   - Ledger, 1.0.82 check: a 512 MB listings-only run saw "the memory guard turned the browser fallback off as designed" (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:239).
   - Scale plan: 512 MB runs come "once the `actor.json` minimum is lowered" (fb-scrap-engine/docs/design/SCALE_PLAN.md:79).
10. **`radiusKm` and `sort`** are "Source binding" checks, not filters: Facebook's own request must carry `filter_radius_km` and `commerce_search_sort_by`. "The run fails the source check if Facebook does not apply it" (fb-scrap-engine/README.md:120-124; fb-scrap-engine/.actor/input_schema.json:34; fb-scrap-engine/.actor/input_schema.json:42).
    - How that failure appears to a caller is not documented in the listed files.
11. **Unknown fields.** "Unknown fields, including any filter or match rule, are rejected" (fb-scrap-engine/README.md:95-96), yet the schema sets `additionalProperties: true` (fb-scrap-engine/.actor/input_schema.json:6).
    - Where the rejection happens, and what the caller sees, is not documented in the listed files.
12. **Only two orders are usable.** Nearest first (`distance_ascend`) has never been bound or verified on the fast route, and price sort was never tested (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:166-170).
13. **Required fields** are not documented in the listed files; the schema has no `required` list (fb-scrap-engine/.actor/input_schema.json:4-7). For example, it is not stated whether a `listingIds`-only run needs `cityId`.
    - The test calls the normaliser with `{ listingIds: ['1'] }` alone and gets a normalised input back (fb-scrap-engine/test/route-health.test.js:111-113), which suggests `cityId` is not needed for listing IDs (**inference**).
14. **`startUrls` combined with `searchTerms`, `cityId` or `maxPagesPerSearch`**: how they interact in v3 is not documented in the listed files.

---

## 3. Output

### 3.1 Record types and where output lands

| Output | What it is | Source |
| --- | --- | --- |
| Dataset row, `recordType: "listing"` | One per listing. `foundBySearchTerms` names the searches that returned it. "No listing is dropped or judged." | fb-scrap-engine/README.md:97-98; fb-scrap-engine/README.md:116; fb-scrap-engine/README.md:410 |
| Dataset row, `recordType: "sourceOutcome"` | A coverage row per source: status, stop reason, page count and binding status. | fb-scrap-engine/README.md:97-98; fb-scrap-engine/README.md:410 |
| `RUN_SUMMARY` | A record in the run's default key-value store (see §4). | fb-scrap-engine/README.md:457 |

- **Writes happen once, at the end.** Rows and `RUN_SUMMARY` are written only when the run ends, so an aborted run yields nothing (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:309-310).
- **What the recorded run returned.** 21 dataset rows: 20 listing rows followed by one `sourceOutcome` row (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:13; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:7057-7068).
  - Listing rows came in the same order as `RUN_SUMMARY.candidateIds`, with `listedAt` strictly decreasing (newest first) (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:40-61; checked on all 20 rows for this rebuild).

### 3.2 Listing rows: what cards and details carry

| Level | Carries | Does not carry | Source |
| --- | --- | --- | --- |
| Search card (listings only) | Title, price, town name and city page, `listedAt` (Unix seconds), primary photo, delivery types and a category ID (not its name) | Coordinates (0 of 1,268 cards without cache hits); condition; seller attributes (15 of 5,503 cards); Facebook's multi-quantity field | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:174-177; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:196-199; fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:147-149; fb-scrap-engine/docs/design/SELLER_DATA.md:235-236 |
| Item details | Exact-ID description (`full_verified`) from 1.0.64; category, attributes, condition and a gallery of up to 40 photos from 1.0.68–1.0.69; coarse coordinates; the seller's own attribute fields | Seller ratings, badges and join year (Facebook does not serve them logged out) | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:184-188; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:196-204; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:425-426; fb-scrap-engine/docs/design/SELLER_DATA.md:29 |
| `graphql` details | Same descriptions and attributes as the page route | No photo gallery | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:211-219; fb-scrap-engine/.actor/input_schema.json:119 |

- "Missing source fields stay null or absent with provenance instead of fabricated values" (fb-scrap-engine/README.md:457).
- "Missing fields mean the public response did not supply them; they are not evidence that the item lacks those features" (fb-scrap-engine/README.md:252-254).
- Feeds can include sold rows (`availability.sold`), £0 prices and foreign currencies (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:194-195).
- Dublin results are priced in EUR (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:57; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:237).

### 3.3 Listing row fields (v3, build 1.0.82)

The full v3 row schema is **not documented in the listed files**. The listed files name only some fields, so the shapes below come from the recorded run, which had details on, the `graphql` route and the cache off.
- Every listing row there has the same 55 top-level keys. Keys are always present, and are `null` or empty when there is no value (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:2-454; key sets compared across all 20 rows for this rebuild).
- "Row n" means the nth row in dataset order.

**Identity, links and coverage**

| Field | Shape in the recorded run | Meaning | Completeness and notes | Source |
| --- | --- | --- | --- | --- |
| `recordType` | `"listing"` | Record type | All 20 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:133; fb-scrap-engine/README.md:410 |
| `listingId` | Numeric string | Facebook listing ID | 16 digits in 19 rows and 17 digits in one (`28242423458759790`), so treat it as a string | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:85; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:2945 |
| `url`, `listingUrl` | `https://www.facebook.com/marketplace/item/<listingId>/` | Item link | Identical in all 20 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:3; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:100 |
| `platform` | `"facebook"` | — | All 20 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:64 |
| `listedAt` | Integer, Unix seconds (for example `1790154165`) | When the listing was posted; search cards carry it too | All 20; provenance `detail` in this run, although search cards also carry it; equals `sourceFields.search.creation_time` and `sourceFields.detail.creation_time` on all 20; strictly decreasing in dataset order (newest first); 16.6–33.7 h before `collectedAt` | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:62; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:109; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:163; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:384; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/README.md:10-11; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:174-175 |
| `collectedAt` | ISO-8601 string | Collection time | Same value on every row, the `sourceOutcome` row included, and in the summary | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:137; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:24 |
| `foundBySearchTerms` | Array of strings | The searches that returned the listing | `["gaming pc"]` on all 20. v3 rows carry no `targetQuery`, so Nabvy links rows to its own search plan. | fb-scrap-engine/README.md:97-98; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:417-419; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:445 |
| `sourceUrls` | Array of URLs | Sources that yielded the listing | The search URL on all 20 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:134-136 |
| `sourceBindings` | Object: URL → `"verified"` or `"unverified"` | Whether each yielding source was bound to the requested query and location | `verified` on all 20. A browser fallback also reports `verified`, so check the route (§5). | fb-scrap-engine/README.md:410; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:103-106; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:427-429 |
| `provenance` | Object: field → `"search"`, `"detail"` or `"seo"` (dotted keys for `availability.*`) | Source of most filled fields; some filled fields have no key (for example `videos` on rows 3 and 17, and identity fields such as `listingId` and `url`) | Keys only for filled fields. `price`, `title`, `imageUrl` and `location` come from search, `locationCoordinates` from seo, the rest from detail (424 detail, 80 search and 20 seo keys over 20 rows). | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:101-132; fb-scrap-engine/README.md:457 |
| `conflicts` | Array of `{ field, detailValue, searchValue }` | Disagreements between the detail and search copies; the actor records them rather than choosing silently | Every row has a `locationDetails` conflict: detail coordinates against the search `reverse_geocode`. One row also has a `displayedPreviousPrice` conflict. 21 conflicts in total. | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:66-84; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:1464-1483 |

**Price**

| Field | Shape in the recorded run | Meaning | Completeness and notes | Source |
| --- | --- | --- | --- | --- |
| `price` | Number, major units (for example `200`) | Asking price | All 20; provenance search; equals `money.amountMinor / 100` in all 20 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:12; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:103 |
| `currency` | String | Currency code | `"GBP"` on all 20. Dublin rows are EUR. | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:60; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:57 |
| `money` | `{ kind, display, currency, exponent, rawAmount, amountMinor }`, for example `{ "fixed", "£200", "GBP", 2, "200.00", 20000 }` | Structured price | All 20: `kind` `fixed`, exponent 2; provenance detail | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:4-11 |
| `displayedPreviousPrice` | `null`, or money-shaped | The "was" price Facebook shows (from `strikethrough_price`) | 1 of 20 (`£499`; `rawAmount` `"£499"` from detail against `"499.00"` from search). "Source-displayed previous price is distinct from observed price history." 39.9% of desktops show one; never use it as a reference. | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:1766-1773; fb-scrap-engine/README.md:412; fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:85-88 |
| `variablePrice` | `{ max, min }` | Not documented in the listed files | `null`/`null` on all 20 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:420-423 |
| `sourceComparison` | `{ type, price }` | Not documented in the listed files | `null`/`null` on all 20 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:439-442 |

**Text**

| Field | Shape in the recorded run | Meaning | Completeness and notes | Source |
| --- | --- | --- | --- | --- |
| `title` | String | Card title | All 20; provenance search; equals `sourceFields.search.marketplace_listing_title`. Passed through unchanged, even when `+` stands in for spaces (row 2: `"MSI+AlphaSync+GTX+1660,+Ryzen+7+2700X+Gaming+PC"`). | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:13; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:466 |
| `description` | String (56–1,158 characters in the run) | Public description | All 20; provenance detail. Equals `sourceFields.detail.description` with leading and trailing whitespace trimmed (identical in 15 rows, trimmed in 5). | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:139 |
| `descriptionStatus` | `"full_verified"`, `"partial"` or `"missing"` | `full_verified`: the item response held `redacted_description.text` in an embedded `GroupCommerceProductItem` for the exact listing ID ("not a guarantee about private seller text or every other listing field"). `partial`: possibly only an SEO teaser (Open Graph text held about the first 200 characters in local, unconfirmed samples). `missing`: none captured. | `full_verified` on all 20. Only `full_verified` counts as complete; text AI runs only on it. | fb-scrap-engine/README.md:233-241; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:184-186; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:167-168; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:443 |
| `descriptionComplete` | Boolean | Not documented in the listed files | `true` on all 20 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:446 |
| `customTitle`, `customSubtitles` | `null`; `[]` | Custom titles and subtitles (in the evidence-hash allowlist) | Empty on all 20 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:138; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:431; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:127-129 |

**Category, condition and attributes**

| Field | Shape in the recorded run | Meaning | Completeness and notes | Source |
| --- | --- | --- | --- | --- |
| `categoryId`, `categoryName`, `categorySlug` | Numeric string; string; string | Facebook category (cards carry only the ID) | All 20 from detail. Seen: Electronics & computers (17), Miscellaneous, Video Games, Household (1 each). | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:99; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:147-149; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:540; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:174-176 |
| `categoryPath` | Array of names, or `null` | From `seo_virtual_category.taxonomy_path` | 14 of 20: Desktop computers (10), Computer cases (2), Computer headsets (2). It can disagree with `categoryName`: row 2 is "Miscellaneous" with an Electronics › Computers › Computer cases path. | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:540-542; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:581-590 |
| `condition` | String label or `null` | Seller-set condition; not on search cards | 19 of 20: "Used – good" 10, "Used – like new" 5, "New" 3, "Used – fair" 1 (labels use an en dash) | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:65; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:475; fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:147-149 |
| `attributes` | Array of `{ label, value, attribute_name }`, or `null` | The seller's attribute fields, Condition included (value codes `used_good`, `used_like_new`, `new`, `used_fair`) | 19 of 20; 23 objects. Names seen: Condition, Processor type, Colour, Brand. Over 11,012 full-detail rows: Condition 10,857, Brand 2,019, Processor type 207, "Is for gaming (Y/N)" 198, Form factor 71, Product series 51. | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:92-98; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:497; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:196-199 |
| `detailSections` | `null`, or an array of the non-Condition attributes | Detail sections (in the evidence-hash allowlist) | 4 of 20, for example `[{ "AMD Ryzen 5 3600", "AMD Ryzen 5 3600", "Processor type" }]` | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:2116-2122; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:127-129 |
| `inventoryType`, `inventoryCount` | String; `null` | Facebook's multi-quantity (inventory type) field; details only. 17.8% of listings with an inventory type are multi-quantity. | `SINGLE_QUANTITY` on all 20; count `null` | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:417; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:426; fb-scrap-engine/docs/design/SELLER_DATA.md:232-237 |
| `listingStatus` | String | Facebook's renderable status | `AVAILABLE` on all 20 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:418 |

**Location**

| Field | Shape in the recorded run | Meaning | Completeness and notes | Source |
| --- | --- | --- | --- | --- |
| `location` | String town label | The card's `reverse_geocode.city` | All 20; provenance search; 18 distinct values. Ambiguous ("Hove" is the page "Brighton and Hove"), so prefer the city-page ID for place identity. | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:63; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:48-49 |
| `locationDetails` | `{ latitude, longitude }` | The docs say it carries the city page at `locationDetails.reverse_geocode.city_page.id`, which "works" as `cityId` | **0 of 20 rows have that path.** With details on, `locationDetails` holds the detail coordinates (provenance detail), and the city page appears only at `sourceFields.search.location.reverse_geocode.city_page.id` and in `conflicts[].searchValue`. See §11, Q1. | fb-scrap-engine/.actor/input_schema.json:27; fb-scrap-engine/README.md:115-116; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:433-436; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:369-378 |
| `locationCoordinates` | `{ latitude, longitude, precision }` | Item coordinates | All 20; `precision` `"coarse"`; provenance seo; the same numbers as `locationDetails`. Cards have no coordinates. | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:447-451; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:174-177 |
| City page (inside `sourceFields.search`) | `location.reverse_geocode { city, state, city_page { id, display_name } }` | The place identity to use; these IDs work as `cityId` | All 20; `state` `""` on all; 18 distinct pages. Label and page can differ: city "Poole" has page "Upton, Dorset". | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:369-378; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:3665-3672; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:39-43 |

**Media**

| Field | Shape in the recorded run | Meaning | Completeness and notes | Source |
| --- | --- | --- | --- | --- |
| `imageUrl` | URL string | The card's primary photo | All 20; provenance search. The search copy's `primary_listing_photo` also has an `id` on all 20. | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:61; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:397-403 |
| `photos` | Array of `{ id, image { uri, width, height }, accessibility_caption }`, or `null` | The item's gallery; at most 40 photos per item | **Row 1 only**: 4 photos at 540×960. `null` on the other 19. The `graphql` route returns no gallery. | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:14-51; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:467; fb-scrap-engine/README.md:257-258 |
| `photoUrls` | Array of URLs, or `null` | Gallery links | Row 1 only | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:86-91 |
| `photoGalleryTotal`, `photoGalleryComplete` | Number; boolean; or `null` | Check both before trusting a gallery | Row 1: 4 and `true`; `null` on the other 19 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:444; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:452; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:777; fb-scrap-engine/README.md:256-258 |
| `videos` | `null`, or `{ id }` | The card's `listing_video`; no video URL | 2 of 20 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:802-804; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:5706-5708 |

- **Why only row 1 has photos (inference).**
  - The `graphql` route reads one item page per session and replays the rest (fb-scrap-engine/.actor/input_schema.json:119).
  - The run had one bootstrap and 19 replays, and it downloaded one detail page (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:30, nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:36, nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:97-101).
  - So the one listing whose page served as the session page got its gallery. The listed files do not state this.
- **Photo links expire.** They carry an `oe` expiry 104–108 hours after collection (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:288-289). The actor does not read text inside images (fb-scrap-engine/README.md:254-257).

**Seller**

| Field | Shape in the recorded run | Meaning | Completeness and notes | Source |
| --- | --- | --- | --- | --- |
| `seller` | `null`, or `{ id, name, profile_picture { uri } }` | Seller identity. The design lists `{ id, name, short_name, profile_picture.uri }`, but `short_name` never appeared. | 3 of 20 (rows 1, 7 and 12); provenance detail. One numeric ID and two tokens (values redacted). 85% of seller-known listings carry an opaque, rotating token and 15% a numeric ID. | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:52-58; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:2165; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:4005; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/README.md:27-31; fb-scrap-engine/docs/design/SELLER_DATA.md:26-28; fb-scrap-engine/docs/design/SELLER_DATA.md:48-55 |
| `sourceFields.*.marketplace_listing_seller` | Same shape | Copies of the seller | Filled under `seo` and `detail` on the same 3 rows; `null` under `search` on all 20 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:243-249; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:406 |
| `viewerIsSeller` | Boolean | — | `false` on all 20 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:430 |

- **Seller coverage in the listed files.**
  - Seller ID on 35.3% of 2,999 unique listings, after repeated test sweeps (fb-scrap-engine/docs/design/SELLER_DATA.md:31-34).
  - 94.7% of those came from search cards (fb-scrap-engine/docs/design/SELLER_DATA.md:35).
  - Only 8.1% of search rows had a seller (fb-scrap-engine/docs/design/SELLER_DATA.md:38-41).
  - About 7.5% for a listing seen once (fb-scrap-engine/docs/design/SELLER_DATA.md:42-47).
  - "Anonymous responses show a seller on only 18% of rows" (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:193).
  - By detail route: the item-page route found a seller on 7.5% of listings, the cheaper detail route on 6.3% (fb-scrap-engine/docs/design/SELLER_DATA.md:36-37).
  - On search pages, seller presence looks page-level: rows with sellers come in runs of 24, inferred from row order because rows carry no page field (fb-scrap-engine/docs/design/SELLER_DATA.md:38-41).
  - Tokens: every token seen again after 20+ hours had changed (20 of 20, "a small sample"); 9–16% changed within 1–8 hours; none changed within 30 minutes or within one run; numeric IDs never changed in 37 hours (fb-scrap-engine/docs/design/SELLER_DATA.md:51-54). A hash of a token is therefore not a stable seller key (**inference**).
- **In the recorded run, sellers came only from details.** None came from search cards (**computed for this rebuild** from the rows above).

**Availability, delivery and grouping**

| Field | Shape in the recorded run | Meaning | Completeness and notes | Source |
| --- | --- | --- | --- | --- |
| `availability` | `{ live, sold, hidden, pending }` booleans | Listing state | All 20 `{ true, false, false, false }`. Feeds can include sold rows. | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:141-146; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:194-195 |
| `deliveryTypes` | Array of strings | Delivery options | `["IN_PERSON"]` on 19; `["IN_PERSON","PUBLIC_MEETUP","DOOR_PICKUP","DOOR_DROPOFF"]` on 1 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:415; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:2859 |
| `shippingOffered`, `messagingEnabled` | Booleans | — | `false` and `true` on all 20 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:437-438 |
| `parentListing`, `originGroup` | `null` | Not documented in the listed files | `null` on all 20 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:419; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:140 |

**Detail bookkeeping**

| Field | Shape in the recorded run | Meaning | Completeness and notes | Source |
| --- | --- | --- | --- | --- |
| `detailAttempted` | Boolean | Whether an item request was made in this run | `true` on all 20 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:432; fb-scrap-engine/README.md:230-232; fb-scrap-engine/README.md:270-271 |
| `detailAttempts` | Number (0, 1 or 2) | Item attempts. In v2 candidate mode a second attempt is one bounded retry after a failure or a partial or missing description (fb-scrap-engine/README.md:302-307). For v3 the schema budgets 10% extra detail requests "for one retry of failures" (fb-scrap-engine/.actor/input_schema.json:91); the exact v3 retry trigger is not documented in the listed files. | 1 on all 20 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:424; fb-scrap-engine/README.md:302-307; fb-scrap-engine/.actor/input_schema.json:91 |
| `detailOutcome` | String | Detail result. Values named in the listed files: `collected` (the run), `extraction-error` and `metadata-only`. "A successful `metadata-only` request is not proof that the complete description was read." | `collected` on all 20. The full list of values is not documented in the listed files. | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:416; fb-scrap-engine/README.md:335; fb-scrap-engine/README.md:412 |

**Raw copies**

| Field | Shape in the recorded run | Notes | Source |
| --- | --- | --- | --- |
| `sourceFields.search` | 28 keys | `id`, `is_live`, `is_sold`, `location.reverse_geocode` (above), `is_hidden`, `__typename` (`GroupCommerceProductItem`), `is_pending`, `custom_title`, `origin_group`, `creation_time`, `listing_price { amount, formatted_amount, amount_with_offset_in_currency }`, `listing_video`, `delivery_types`, `parent_listing`, `is_viewer_seller`, `max_listing_price`, `min_listing_price`, `strikethrough_price`, `primary_listing_photo { id, image { uri }, __typename }`, `created_with_seller_app`, `marketplace_listing_title`, `marketplace_listing_seller`, `marketplace_listing_category_id`, `custom_sub_titles_with_rendering_flags`, and four `__isMarketplaceListing*` keys | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:365-413 |
| `sourceFields.seo`, `sourceFields.detail` | Up to 36 keys; the two copies were identical on all 20 rows | `description`, `descriptionStatus`, `descriptionComplete`, `location` and `item_location` (coordinates), `location_text.text` (for example "Epsom, Surrey"), `listing_price { amount, currency, amount_with_offset_in_currency, formatted_amount_zeros_stripped }`, `listing_inventory_type`, `renderable_listing_status`, `marketplace_listing_category { id, slug }` and name, `base_marketplace_listing_title`, shipping, messaging and checkout flags. Some rows only: `attribute_data` (19 of 20), `listingPhotos`, `photoGalleryTotal`, `photoGalleryComplete`, `primary_listing_photo`, `marketplace_listing_seller`, `seo_virtual_category`, `strikethrough_price`. | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:151-257; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:581-590; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:1603-1605 |

- **`amount_with_offset_in_currency`.** Its meaning is not documented in the listed files.
  - It was close to, but not exactly, 133 times the GBP `amount` on all 20 rows: the ratio ran from 132.995 to 133.000, and was exactly 133 only on the £25, £50 and £95 rows. For example, it was `"26599"` for £200.00, where 133 × 200 would be 26600, and `"219445"` for £1,650.00, where 133 × 1,650 would be 219450 (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:206-210; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:904-906; ratios **computed for this rebuild**).
  - It is therefore not GBP pence. Use `money`, `price` or `listing_price.amount`.

**Documented fields that were absent from the recorded rows**

| Field | What the listed files say | Why absent (as far as documented) | Source |
| --- | --- | --- | --- |
| `detailCacheStatus`, `detailFetchedAt` | Cache status (`miss`, `refresh`, `hit`, `deferred`, `stale-fallback`) and fetch time | Described for runs with the cache on; the recorded run had it off | fb-scrap-engine/README.md:268-274; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:178-182 |
| `directItemUnresolved` | `true` on a row whose direct item route could not identify the requested ID, with `detailOutcome: "extraction-error"`. A removed ID returns one (verified on v2 build 1.0.74, not yet on v3). | No direct IDs were requested | fb-scrap-engine/README.md:332-338; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:254-255 |
| `queryMatch`, `queryMatchStatus`, `targetQuery` | v2 candidate-mode matching fields | v3 rows do not carry them | fb-scrap-engine/README.md:220-225; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:417-419 |
| `photoCaptures[]` | Proposed: key, sha256, bytes, size and status per captured photo | Proposal only; not built | fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:97-107 |
| Embedded browse-feed cards and related-search terms | About 20 cards and 10 terms per item page | Listed under "Next Actor build" (HANDOFF) and as something the Actor "could return" (ledger); not current output | fb-scrap-engine/docs/HANDOFF.md:153-154; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:278-280 |

### 3.4 `sourceOutcome` rows

| Field | Recorded value | Meaning | Source |
| --- | --- | --- | --- |
| `recordType` | `"sourceOutcome"` | — | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:7059 |
| `sourceUrl` | The search URL | The source | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:7058 |
| `sourceIndex` | 0 | Position of the source | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:7062 |
| `sourceRows` | 20 | Rows the source yielded | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:7060 |
| `sourcePages` | 1 | Pages read | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:7063 |
| `sourceRoute` | `"search"` | Source kind (the summary's `searches[].route` holds the HTTP route) | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:7064 |
| `sourceStatus` | `"truncated"` | Status | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:7065 |
| `sourceBinding` | `"verified"` | Binding status | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:7066 |
| `sourceStopReason` | `"results-limit"` | Stop reason | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:7067 |
| `collectedAt` | Same as the listing rows | — | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:7061 |
| `resolvedByDetailPass` (documented; absent here) | `true` when discovery did not finish a listing ID but the description pass collected it; its listing row then carries no failure markers | — | fb-scrap-engine/README.md:109-111 |

- "Use the source outcome records when interpreting listing coverage; a visible card alone does not prove that a query or location filter was applied" (fb-scrap-engine/README.md:410).
- The full v3 `sourceOutcome` field list is not documented in the listed files; the table above is the recorded shape.

---

## 4. Run summary and run records

### 4.1 `RUN_SUMMARY`

`RUN_SUMMARY` is written to the run's default key-value store (fb-scrap-engine/README.md:457). Its full shape is not documented in the listed files. The recorded summary has these 19 top-level keys (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:1-113):

| Key | Recorded value | Documented meaning | Source |
| --- | --- | --- | --- |
| `mode` | `"extract"` | Not documented for v3 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:2 |
| `inputVersion` | 3 | — | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:62 |
| `requests` | 22 | All requests, including each failed replay's page request | fb-scrap-engine/README.md:54-56; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:3 |
| `searches[]` | 1 entry (§4.2) | Per search: pages, stop reason, `route`, and `searchControls` (the radius, order and centre Facebook used) | fb-scrap-engine/README.md:99-108; fb-scrap-engine/README.md:121-123; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:4-22 |
| `searchSort` | `"newest"` | The requested order | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:23 |
| `searchRadiusKm` | `null` | The requested radius (none was sent) | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:69 |
| `collectedAt` | `"2026-09-24T01:40:43.415Z"` | — | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:24 |
| `detailRoute` | Object (§4.3) | Replays, fallbacks, `circuitOpen` and the Facebook operation IDs used (`queryIds`) | fb-scrap-engine/README.md:59-61; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:25-39 |
| `candidateIds` | 20 listing IDs, newest first | Not named in the listed files; possibly "every observed listing ID" recorded under `sourceDiagnostics` (**inference**). The v2 text says `sourceDiagnostics` reports "up to 500 pre-filter candidate IDs" (fb-scrap-engine/README.md:387-389), and `RUN_SUMMARY.omittedCandidateCount` detects output truncation (fb-scrap-engine/README.md:308). Whether v3 `candidateIds` is capped at 500 is not documented in the listed files. | fb-scrap-engine/.actor/input_schema.json:164; fb-scrap-engine/README.md:308; fb-scrap-engine/README.md:387-389; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:40-61 |
| `listingsFound`, `candidateCount` | 20, 20 | — | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:63-64 |
| `detailOutcomes` | `{ "collected": 20 }` | "The summary also reports detail outcomes and unattempted details" | fb-scrap-engine/README.md:113; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:65-67 |
| `detailRequests` | 20 | Item requests (19 replays plus 1 session page in this run; **inference** from §4.3) | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:68 |
| `detailAttemptedCount`, `detailUnattemptedCount` | 20, 0 | Listings beyond `maxDetails` are "counted as unattempted"; unfetched IDs are "not attempted, never … failed". With cache hits, `detailUnattemptedCount` does not mean "missing". | fb-scrap-engine/.actor/input_schema.json:91; fb-scrap-engine/README.md:81; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:180-182; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:111-112 |
| `detailRetryCount` | 0 | Bounded retries (named in the v2 section) | fb-scrap-engine/README.md:305-306; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:105 |
| `descriptionStatuses` | `{ missing: 0, partial: 0, full_verified: 20 }` | Counts per status | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:106-110 |
| `sourceOutcomes[]` | 1 entry (§4.4) | Per-source outcome | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:70-96 |
| `detailPageStats` | `{ p90Kb: 947, pages: 1, medianKb: 947, descriptionFound: 1, p90DescriptionEndPct: 87, medianDescriptionEndPct: 87 }` | Item-page size, and where the description block ends in the page (the ledger measured 87%, p90 94%) | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:284-286; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:97-104 |

Documented summary keys that were absent from the recorded run:
- `memoryGuard`: written when memory is below 1 GB (fb-scrap-engine/README.md:88-89).
- `responseInventory`: written only when that option is on (fb-scrap-engine/.actor/input_schema.json:169).
- The cache store name and cache status counts: named in the v2 cache text (fb-scrap-engine/README.md:269-270).

### 4.2 `searches[]` entry

| Field | Recorded | Values documented in the listed files | Source |
| --- | --- | --- | --- |
| `url` | `https://www.facebook.com/marketplace/115935195086622/search/?query=gaming+pc&sortBy=creation_time_descend` | Search URL: `/marketplace/<cityId>/search/?query=…` plus the bound order | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:6 |
| `term` | `"gaming pc"` | — | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:7 |
| `pages` | 1 | — | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:8 |
| `route` | `"http"` | `http`; `browser-fallback` (reads about one page); `failed` (HTTP failed with `browserFallback: false`, or the deadline came first). "Rerun searches with either of the last two." Deployed in 1.0.80. | fb-scrap-engine/README.md:103-105; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:92-93; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:9 |
| `status` | `"truncated"` | `truncated` is documented for `time-limit` ("never as failed") (fb-scrap-engine/README.md:106-108); the recorded run also shows it when our `results-limit` cap stopped the search (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:10-12). | fb-scrap-engine/README.md:106-108; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:10 |
| `listings` | 20 | — | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:11 |
| `stopReason` | `"results-limit"` | `page-cap` (our cap); `source-no-new-listings` (Facebook's next page held only listings already seen: a normal end of feed, verified in 1.0.80); `time-limit`. `results-limit` appears in the run but is not described in the listed files. | fb-scrap-engine/README.md:101-108; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:113-117; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:472-474; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:12 |
| `sourceBinding` | `"verified"` | `verified` does not mean a full read: a browser fallback also reports `verified` | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:103-106; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:13 |
| `httpStopReason` | `"page-cap"` | Not documented separately in the listed files | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:14 |
| `searchControls` | `{ sort: "CREATION_TIME_DESCEND", latitude: 50.836, radiusKm: 65, longitude: -0.775 }` | The radius, order and centre Facebook actually used | fb-scrap-engine/README.md:121-123; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:15-20 |

### 4.3 `detailRoute` block

| Field | Recorded | Meaning | Source |
| --- | --- | --- | --- |
| `route` | `"graphql"` | Detail route used; `route-health.js` counts attempts only when this is `graphql` | fb-scrap-engine/app/route-health.js:9-12; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:26 |
| `detailRequests` | 19 | Replays attempted (read by `route-health.js` as attempts) | fb-scrap-engine/app/route-health.js:13; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:36 |
| `detailOk` | 19 | Successful replays | fb-scrap-engine/app/route-health.js:14; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:27 |
| `circuitOpen` | `false` | The breaker stopped replays for the rest of the run | fb-scrap-engine/README.md:53-61; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:31 |
| `queryIds` | `["28897280379855964"]` | Facebook operation IDs used; "A new ID means Facebook deployed a change." The same ID appeared in the ledger's 1.0.82 check. | fb-scrap-engine/README.md:59-61; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:244-245; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:29 |
| `bootstraps`, `failedBootstraps` | 1, 0 | Session pages, and those that failed to supply the replay template | fb-scrap-engine/app/route-health.js:16-19; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:30; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:37 |
| `failures`, `detailFailed`, `routedToPage`, `extraRequests` | `{}`, 0, 0, 0 | Meaning not documented in the listed files beyond the names. Failed replays are followed by a page fetch, and the ledger records one failure reason, `description-missing`. | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:241-243; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:28; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:32-34 |
| `medianResponseKb`, `maxResponseKb` | 446, 453 | Replay response size (the ledger gives about 446 KB uncompressed per reply) | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:216; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:35; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:38 |

- **Request accounting (inference).** The recorded numbers add up as follows; no listed file states it.
  - 22 requests = the search's 2 requests (`requestsUsed`) + 20 detail requests.
  - 20 detail requests = 19 replays + 1 bootstrap.
  - (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:3, nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:30, nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:36, nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:68, nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:82)
- **The ledger's 50-ID run** counted `requests` 55 = 2 bootstraps + 50 replays + 3 page fetches after 3 failed replays (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:241-243).
  - There, bootstraps came on top of one replay per ID. In the recorded run, the session page appears to have served listing 1 itself.
  - The listed files do not explain the difference (§11).

### 4.4 `sourceOutcomes[]` entry and diagnostics

- **The entry.** Fields `url`, `rows` 20, `pages` 1, `route` `"search"`, `status` `"truncated"`, `stopReason` `"results-limit"`, `sourceBinding` `"verified"` and `diagnostics` (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:70-96).
- **`diagnostics.httpSearchFirst`** (present because `sourceDiagnostics` was on): `pagesUsed` 1, `stopReason` `"page-cap"`, `requestsUsed` 2, `routeRetained` `true`, `templateFound` `true`, `bootstrapBytes` 668969, and `searchControls` as in §4.2 (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:78-93).
  - `routeRetained` was true in every 2026-09-23 run on numeric city IDs (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:31-33).
  - The search page measured 646–762 KB in the ledger (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:84-85).

### 4.5 Apify run record (`run.json`)

Nabvy's gateway stored these fields (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:1-57):

| Field | Recorded | Notes |
| --- | --- | --- |
| `apifyRunId`, `actorId`, `gatewayJobId` | `VkryjpwS6U2GBDh3k`, `YfdUav3sZ2BgEf8rh`, 6 | Gateway fields (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:2-4) |
| `settledCostUsd`, `reserveUsd` | 0.0177, 0.3363 | Gateway fields (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:5-6). How they are computed is not documented in the listed files. |
| `run.status`, `run.statusMessage` | `SUCCEEDED`; "Finished! Total 1 requests: 1 succeeded, 0 failed." | The Apify message counts 1 request while `RUN_SUMMARY.requests` is 22 (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:8-9) |
| `run.startedAt`, `run.finishedAt` | 2026-09-24T01:40:18.718Z, 01:40:44.010Z | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:10-11 |
| `run.buildNumber`, `run.options.build` | `1.0.82`, `latest` | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:12, nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:16 |
| `run.itemCount` | 21 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:13 |
| `run.usageTotalUsd` | 0.0002925739708973302 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:14 |
| `run.options` | `diskMbytes` 2048, `timeoutSecs` 300, `memoryMbytes` 1024, `isMaxTotalChargeUsdSetByUser` false | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:15-21 |
| `run.stats` | `runTimeSecs` 25.109, `computeUnits` 0.0069747222222222224, `memMaxBytes` 158183424, `memAvgBytes` 139904997.48011354, `netRxBytes` 2109602, `netTxBytes` 108567, `cpuMaxUsage` 49.75…; restart, reboot and migration counts 0 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:22-40 |
| `run.usage` | `DATASET_WRITES` 21, `KEY_VALUE_STORE_READS` 1, `KEY_VALUE_STORE_WRITES` 3, `PROXY_RESIDENTIAL_TRANSFER_GBYTES` 0.0001356257125735283, `DATA_TRANSFER_EXTERNAL_GBYTES` 0.0000977618619799614, `DATA_TRANSFER_INTERNAL_GBYTES` 0.00015270616859197617; request-queue, dataset-read, SERP and unblocker usage 0 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:41-55 |

The run folder was produced by `apify_gateway.redacted_items(6)`, and `apify_gateway.redaction_leaks(6)` returned nothing (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/README.md:24-25). Checksums match the database (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/README.md:43-48).

---

## 5. Search and detail routes, and route health

### 5.1 Search route

- **The fast HTTP route** fetches the search page (646–762 KB), reads Facebook's preloaded search request and replays it with cursors. It has been the default since 1.0.57 (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:84-87).
  - Reliability: 20 of 20 single-term runs on 1.0.74; 9 of 10 bootstraps on 1.0.79; 30 of 30 page-1 searches on 1.0.80 (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:88-91; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:253).
- **The v2 README text** describes the mechanics: bootstrap HTML, then the preloader's query ID and variables, then GraphQL POSTs in the same session (fb-scrap-engine/README.md:379-399). That the v3 `http` route works the same way is **not documented in the listed files** beyond the ledger's summary above.
- **Binding.** Numeric city-ID routes kept their route (`routeRetained` true) in every 2026-09-23 run. Since 1.0.79 the radius and newest-first sort are bound to Facebook's own request (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:31-33; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:73-76).
- **Browser fallback.**
  - Used when the fast route fails and `browserFallback` is on.
  - It reads about one page (about 24 listings instead of about 1,300), yet still reports `sourceBinding: verified`.
  - It used 16 times the proxy data and 9 times the cost of the same check on the fast route: settled $0.020 against $0.0022 (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:103-106).
- **Bootstrap 302 (known defect).** "The first request sometimes returns HTTP 302, and the search falls back to the browser." It was seen twice (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:98-102).
  - A retry of a redirected bootstrap is deployed in 1.0.80, but it is untested under a real 302 (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:472-475; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:92).
  - The ledger's text at fb-scrap-engine/docs/EVIDENCE_LEDGER.md:107-108 still says "not deployed", which line 472 supersedes.
- **Feed depth and stop.** A full read returns about 750–1,330 listings over 32–56 pages (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:111-112).
  - The route stops at the first next page holding only already-seen listings. Whether later pages bring new listings is untested, and Facebook never sent `has_next_page: false` (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:113-115).
  - The end at about 1,000–1,300 "looks like a count cap". The full `sofa` feed (1,229 listings) covered only 19–23 September, while `3090` covered March to September (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:124-127).
  - Elsewhere the ledger says a full feed "needs 60 pages and about 1,300 listings per term" (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:302-304).
- **Feed scope.** A default-order search returns either a short local feed (about 90 listings over 4 pages, all within about 100 km) or a long nationwide feed (about 1,300 listings over 55 pages) (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:131-134).
  - The radius does not decide which, and the trigger is unknown ("session or IP is plausible").
  - About 3 of 14 full-depth `3090` reads on 2026-09-23 were short (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:135-145).
  - Local listings are scattered through long feeds (median position about 180) (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:140-143).
  - Relevant listings can sit deep: position 1,852 of 2,400 in one `gaming pc` sweep that hit the 100-page cap (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:246-249); ranks 387–853 for the RTX 5080 worked example (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:396-398).
- **Feed contents.** A keyword search returns "a related slice": of the `3090` feed, 9% mentioned 3090, and near and far listings are interleaved (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:121-123).
  - In the recorded run, `gaming pc` also returned two headsets (£95 and £50) and a £25 "Builder and repair" listing (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:3648; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:4003; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:6713).
- **Newest first** (`CREATION_TIME_DESCEND`):
  - Time-ordered: 119 of 119 pairs in order at 500 km, but at 65 and 10 km one block of five older listings appeared late on page 5 (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:152-154). Do not assume strict order at the default 65 km.
  - Reaches about 115 km (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:155-157). The radius is not a filter but changes the newest-first set a little: 10 and 500 km gave identical sets, and 65 km shared 112 of 120 (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:155-157). All 20 recorded listings lay within 109.0 km of Facebook's reported centre, and 6 of 20 within the reported 65 km (**computed for this rebuild** by great-circle distance from nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:15-20 to each row's `locationCoordinates`).
  - Page 1 held about 10 days of `3090` listings near Chichester (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:158-159). In the recorded run, `gaming pc` page 1 spanned listings 16.6 to 33.7 hours old (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/README.md:10-11).
  - It is "neither complete nor prompt": it missed 11% of related listings within 65 km, 24% within 100 km and 41% within 115 km (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:160-165). Facebook's own feed lagged 0.7 h for `3090` and 12 h for `gaming pc` (one snapshot) (fb-scrap-engine/docs/design/SCALE_PLAN.md:48-49).
  - For broad container terms, newest-first pages 1–2 held 1 of 36 fresh local listings that the full sweep held (fb-scrap-engine/docs/design/SCALE_PLAN.md:50-53).
- **Ireland and Northern Ireland.** Facebook keeps the Republic's feed apart from the UK's: a 30-page Belfast search held no Republic listings, even through an IE proxy. Ireland needs its own centres, and GB proxies serve Dublin (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:61-65).

**Search centres verified in the listed files**

| City | City ID | Facebook's centre | Currency | Date / basis | Source |
| --- | --- | --- | --- | --- | --- |
| Chichester, West Sussex | `115935195086622` | 50.836, −0.775 (radius 65 km) | GBP | Recorded run, 2026-09-24 | fb-scrap-engine/docs/data/city-pages.seed.json:1593-1602; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:15-20 |
| Edinburgh | `115753025103602` | 55.955, −3.209 | GBP | 2026-09-23, newest-first page 1, fast route | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:50-57 |
| Belfast | `109312942421526` | 54.597, −5.930 | GBP | 2026-09-23 | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:50-57 |
| Dublin | `110769888951990` | 53.348, −6.259 | EUR | 2026-09-23 | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:50-57 |
| Glasgow | `106233566079281` | not documented in the listed files | — | Marked verified in the seed | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:59-60; fb-scrap-engine/docs/data/city-pages.seed.json:3105-3114 |
| Rotherham | `112991942045237` | 53.434, −1.355 | — | Never searched before; bound on the fast route (run `eXCs4q5CNKk03xfan`, $0.0018). Not marked verified in the seed. | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:45-47 |

### 5.2 Detail routes

| Route | How it works | Photos | Measured (conditions) | Source |
| --- | --- | --- | --- | --- |
| `page` | Downloads each item page (about 945 KB, about 162–170 KB over the proxy) | Yes: a gallery of up to 40 photos | 20 listings: $0.00166 per listing settled, 120 s. 1.0.82: 10 IDs, 10/10 complete, $0.0157 unsettled (about $0.00157 per listing), 44 s, 141 MB peak. | fb-scrap-engine/.actor/input_schema.json:119; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:214-216; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:238; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:281-283 |
| `graphql` (v3 default since 1.0.82) | One item page per session supplies Facebook's preloaded `MarketplacePDPContainerQuery`. Later listings replay it with only `targetId` changed; a reply is accepted only if it describes exactly that listing. | No gallery. Photos would need `MarketplacePDPC2CMediaViewerWithImagesQuery`, which is not yet an option. | Same 20 listings: 20/20 full, identical text, 97 KB per listing, 56 s, $0.00092 per listing settled. 200 listings (run `hCTDrgRdTLRSUxGNe`): 198/200 complete (99%), 193/197 replays, 340 s, 815 MB peak. 1.0.82: 50 IDs, 48/50 `full_verified`, $0.0468 unsettled (about $0.00094 per listing). | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:205-231; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:237; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:480-481 |

- **Failed replays.** Each costs a second, page request, and both count in `RUN_SUMMARY.requests` (fb-scrap-engine/README.md:54-56).
- **The actor's circuit breaker** stops replaying for the rest of a run "once at least 20 replays have completed and fewer than 85% succeeded" (fb-scrap-engine/README.md:53-54).
  - The test exercises it with explicit `breakerMinAttempts: 10` and `breakerMinSuccess: 0.85` (fb-scrap-engine/test/route-health.test.js:99-109). The actor's own defaults are stated only in the README.
- **Sessions.** With `graphql`, `detailSessionSize` listings (default 40) share a proxy session and IP. The 200-listing sample used 5 sessions rotating every 40 listings (fb-scrap-engine/.actor/input_schema.json:133; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:227-228).
  - A fresh proxy session per item raised success to 18–20 of 20 in an earlier build (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:191-192).
- **Browser fallbacks for listings** run one at a time (fb-scrap-engine/README.md:80).
- **Other listings on item pages.**
  - Item pages carry 26 other listings: 20 complete browse-feed cards plus 6 by ID (15 of 15 pages on 1.0.82).
  - Replay responses carry none, but all 47 carried `search_pivots`.
  - None of this is output yet (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:256-280).

### 5.3 Route health (`app/route-health.js`)

A helper written for the calling app, not the actor. It chooses `detailRoute` per region from recent `RUN_SUMMARY.detailRoute` objects (fb-scrap-engine/app/route-health.js:1-4).

**How the app calls it** (fb-scrap-engine/app/route-health.js:22-33; fb-scrap-engine/README.md:62-70):
- Call `recommendDetailRoute(history, state, options)` once before each detail run for a region.
  - `history` is that region's `RUN_SUMMARY.detailRoute` objects, oldest first, each with the Apify `runId` added.
  - A page-route run has no `detailRoute` stats, so store `{ runId, route: 'page' }` for it.
- Keep the returned `state` between calls; start with `null` (a null state starts on `graphql`) (fb-scrap-engine/app/route-health.js:37; fb-scrap-engine/test/route-health.test.js:58-59).
- A repeated call whose latest entry has the same `runId` returns the previous decision unchanged. Entries without a `runId` are never deduplicated (fb-scrap-engine/app/route-health.js:38-41).
- A test comment says the app keeps only the last 11 entries (fb-scrap-engine/test/route-health.test.js:131).
- It returns `{ route: 'graphql' or 'page', reason, successRate (number or null), attempts, newQueryIds, alert, state }` (fb-scrap-engine/app/route-health.js:30-31; fb-scrap-engine/app/route-health.js:55-58).

**Defaults** (overridable through `options`) (fb-scrap-engine/app/route-health.js:6-7; fb-scrap-engine/app/route-health.js:33-35):

| Option | Default | Use |
| --- | ---: | --- |
| `minSuccess` | 0.95 | Replay success rate needed to stay on `graphql` |
| `minAttempts` | 50 | Replays in the window before a success rate counts |
| `windowRuns` | 10 | Runs in the window; also the look-back for new query IDs |
| `probeEvery` | 10 | On `page`, every tenth run since the switch probes `graphql` |
| `minProbeAttempts` | 20 | Probe replays needed to judge recovery |
| `minFailedBootstraps` | 2 | Failed session pages needed before a run counts as bootstrap-failing |

**Rules** (fb-scrap-engine/app/route-health.js:9-20; fb-scrap-engine/app/route-health.js:43-96):
- **Counting.** Only `graphql` entries count. Attempts are `detailRequests`, successes `detailOk`, and `circuitOpen` must be strictly `true`.
- **Bootstrap-failing run.** A run is bootstrap-failing when it made 0 replays and `failedBootstraps` ≥ max(`minFailedBootstraps`, `bootstraps`). One templateless page "is usually a sold or removed listing".
- **Window.** After a switch, only runs made since the switch count, capped at `windowRuns`.
- **Unhealthy on `graphql`.** Any tripped circuit, any bootstrap-failing run, or (attempts ≥ `minAttempts` and success < `minSuccess`) switches to `page` with `alert: true`. The reason is checked in this order: `circuit-open`, `bootstrap-failing`, `low-success`.
- **Otherwise it stays on `graphql`**: `healthy` if attempts ≥ `minAttempts`, else `insufficient-data`. `alert` is true only if new query IDs appeared.
- **On `page`**: every `probeEvery`-th run is a `probe` on `graphql`; other runs are `still-unhealthy`.
  - Recovery is judged on probe runs alone, summed until they reach `minProbeAttempts`.
  - A probe fails (`probe-failed`, back to `page`, counter reset) on a tripped circuit, a bootstrap-failing run, or more failures than `floor((1 − minSuccess) × max(minProbeAttempts, probeAttempts))`.
  - `recovered` returns to `graphql` with `alert: true`.
  - After `probeEvery` probe runs without enough replays, the result is `probe-inconclusive`, back to `page`.
- **New query IDs.** `newQueryIds` lists the latest run's query IDs not seen in the previous `windowRuns` runs. The list stays empty when there is no history to compare against.

**Test scenarios** (fb-scrap-engine/test/route-health.test.js):
- Detail requests/successes of [100/98, 100/97] stay `healthy`, and [100/98, 100/60] switch to `low-success` (fb-scrap-engine/test/route-health.test.js:25-29).
- A 30/10 run with `circuitOpen` gives `circuit-open`, and 10/5 gives `insufficient-data` (fb-scrap-engine/test/route-health.test.js:30-32).
- A switch is followed by nine `page` decisions, then a probe, then `recovered`, and old failures do not switch it back (fb-scrap-engine/test/route-health.test.js:38-47).
- Small probes add up: 8 then 12 gives `recovered` (fb-scrap-engine/test/route-health.test.js:71-74). Ten empty probes end `probe-inconclusive` (fb-scrap-engine/test/route-health.test.js:77-84).
- A new ID `q2` gives `alert: true` (fb-scrap-engine/test/route-health.test.js:86-90).
- One templateless page out of 2 stays on `graphql`; 3 of 3 gives `bootstrap-failing` (fb-scrap-engine/test/route-health.test.js:117-123).

**Applied to the recorded run** (**computed for this rebuild**). This run's `detailRoute` block with `runId` `VkryjpwS6U2GBDh3k` and a null state gives `route: 'graphql'`, `reason: 'insufficient-data'`, `successRate` 1, `attempts` 19, `newQueryIds` [] and `alert: false`. 19 replays is below `minAttempts` 50 (fb-scrap-engine/app/route-health.js:6; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:25-39).

---

## 6. Costs and limits

Costs are the listed files' measurements, "rather than a fixed price promise" (fb-scrap-engine/README.md:287-288). Displayed costs have read up to 45% low, so settled costs are read at least five minutes after a run (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:17-18).

### 6.1 Per-run and per-unit costs

| Work | Figure | Conditions | Source |
| --- | --- | --- | --- |
| Newest-first page-1 check, one term | $0.0022 | Settled | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:319; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:63 |
| Newest-first check | about $0.002 per check | `3090` near Chichester | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:158-159 |
| Three terms batched in one run | $0.0046, i.e. $0.0015 per term (31% less than $0.0022) | Settled; build not stated for this figure (the neighbouring breakdown of batched page-1 checks is build 1.0.80) | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:323-332 |
| Three newest-first page-1 terms, 512 MB | $0.0048, about $0.0016 per term; 26 s; 103 MB peak | Unsettled (read about a minute after), build 1.0.82, 2026-09-24, run `2WNV4xKHG9GR00i4o` | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:232-239; fb-scrap-engine/docs/HANDOFF.md:142 |
| Catch-up check (default order, pages 1–4) | about $0.005 per term | Estimate | fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:64 |
| Full sweep | $0.01 (short feed) to $0.031 (long feed) per term | — | fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:65; fb-scrap-engine/docs/HANDOFF.md:144 |
| Full `3090` read | $0.031; about 40% of it dataset writes and cache lookups | Settled | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:316-317 |
| Full-depth listings-only check, every 30 min | about $0.03 per check, about $45 a month per term | No label at source (the ledger's app scheduling note) | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:429-431 |
| Listings only | about $0.02–0.04 per 1,000 listings | Settled, Creator plan, 2026-09-23, one city, one day | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:316; fb-scrap-engine/docs/MONETISATION_INPUTS.md:30-41 |
| Listings only (schema text) | about $0.0003 per result page | No date or build given | fb-scrap-engine/.actor/input_schema.json:56 |
| Browser fallback page | $0.020 (against $0.0022 on the fast route) | Settled | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:103-106; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:319 |
| Details, `graphql` | $0.00092 per listing | Settled; 20 listings; build 1.0.81 opt-in (run `sbcJsffiMPANhshN6`) | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:205-216 |
| Details, `graphql`, 50 IDs | $0.0468, about $0.00094 per listing; 5.2 MB proxy | Unsettled, build 1.0.82, run `5BiCf7P5bni9S9a7x` | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:237 |
| Details, `page` | $0.00166 per listing | Settled; the same 20 listings | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:214-216 |
| Details, `page` (item-page run) | about $0.0017 per detail; about $0.0012 of proxy at $8/GB | Settled; 20 items | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:281-283 |
| Details, `page`, 10 IDs | $0.0157, about $0.00157 per listing | Unsettled, build 1.0.82, run `ThoirBcYvoz7KALO4` | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:238 |
| Details (schema text) | about $0.0015 per listing | No date or build given | fb-scrap-engine/.actor/input_schema.json:56 |
| Details (container design) | $0.0017 per listing | 2026-09-23 design. Settled, per the table heading "Cost (settled, or *estimate*)" (the figure is not italic); route not named. It matches the ledger's settled 20-item page-route figure (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:282-283). | fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:60; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:68; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:282-283 |
| Details, cold / warm cache | about $1.6 / about $0.26 per 1,000 | Settled, Creator plan, 2026-09-23; route not stated. Warm figures need the cache, which Nabvy keeps off. | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:318; fb-scrap-engine/docs/MONETISATION_INPUTS.md:30-36 |
| Warm repeat of a large run | 84–92% less. Build 1.0.74: a 409-candidate deep run about $0.226 against about $0.0184 warm. | Build 1.0.74; the dollar figures are what the run "currently reports" (fb-scrap-engine/README.md:285-288), and the 92% was an unsettled read (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:355-357); needs the cache, which Nabvy keeps off | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:298; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:355-357; fb-scrap-engine/README.md:283-288 |
| Cold details per run | about 2,300–2,500 details (at about 0.7 requests per second) | Cold details | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:307-308 |
| Per new listing, including AI | about $0.0015–0.0025 (est.); $0.0014–0.0039 (calc.) | Shared by every user | fb-scrap-engine/docs/HANDOFF.md:232-233; fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:297 |
| Price-drop watch | about $0.028 per watched listing per month | Calc.; daily batches of 20 or more | fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:190-191 |
| Part-price gap-fill run | about $0.30–0.50; or $0.09–0.32 for six terms plus about $0.20 of details (est.) | Proposal; needs owner approval; as written, exceeds the `maxListings` maximum; see §2.2 rule 1 | fb-scrap-engine/docs/HANDOFF.md:203-204; fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:139-149 |
| **Recorded run** (1 search page, 20 details via `graphql`) | Settled $0.0177; reserve $0.3363; Apify `usageTotalUsd` 0.0002925739708973302; 22 requests; 25.109 s | Build 1.0.82, 2026-09-24, gateway job 6 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:5-6; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:14; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:31; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/README.md:8-9 |

**Where the money goes**:

| Work | Breakdown | Conditions | Source |
| --- | --- | --- | --- |
| Page-1 check | Residential proxy 48% in single-term runs and 71% with three terms batched, mostly each term's own bootstrap page (about 120 of 143 KB) | Settled, build 1.0.80 | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:323-328 |
| Full sweep | Proxy 37%, key-value reads 21% (1,230 detail-cache lookups), dataset writes 21%, compute 19% | Settled, build 1.0.80 | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:329-330 |
| Large details run | Residential proxy 75–86% | Settled | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:320 |
| Unit prices used | $0.20/CU, $8/GB residential, $0.005 per 1,000 dataset writes, $0.005 per 1,000 key-value reads | Creator plan | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:323-325 |

**Levers**:
- `useDetailCache: false` on checks and sweeps removes about 21% of a sweep (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:218-220).
- Compact single-record output would save about 21% of a sweep, but needs code (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:221-222).
- One shared bootstrap page is "the biggest saving (about 70% of frequent-check cost)", but it needs a safety review and a live test (fb-scrap-engine/docs/design/SCALE_PLAN.md:90-93).
- Searches are 75–90% of Apify spend, and search cost = centres × terms × check frequency (fb-scrap-engine/docs/design/SCALE_PLAN.md:16-17).

### 6.2 Memory, time and size

| Measure | Figure | Conditions | Source |
| --- | --- | --- | --- |
| HTTP-only runs | Peaked at 147 MB; 0.12–0.37 GB across runs | — | fb-scrap-engine/README.md:71; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:311-312; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:338 |
| Runs that fell back to the browser | 0.5–0.85 GB | — | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:312-313 |
| 200-listing `graphql` details | 815 MB peak; 340 s one at a time | Run `hCTDrgRdTLRSUxGNe` | fb-scrap-engine/README.md:71-72; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:222-230 |
| Two 2 GB detail runs | 0.40–0.51 GB peak | — | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:313 |
| 1.0.82 check | 142 MB (50 IDs, `graphql`, 71 s); 141 MB (10 IDs, `page`, 44 s); 103 MB (3 terms, 26 s) | 2026-09-24 | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:237-239 |
| Recorded run | `memMaxBytes` 158183424; `runTimeSecs` 25.109 | 1024 MB, build 1.0.82 | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:29-31 |
| Memory setting | "keep 1 GB for detail runs". The minimum is disputed: 512 MB or 1 GB (§2.2, rule 9). | — | fb-scrap-engine/README.md:72; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:337-338 |
| Cold detail rate | about 0.7 requests per second | — | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:307-308 |
| `listingIds` details | "Today `listingIds` run one after another: 20 took 120 s" | Scale plan, 2026-09-23. The README and schema now say "in parallel", and 50 IDs took 71 s on 1.0.82. | fb-scrap-engine/docs/design/SCALE_PLAN.md:80-82; fb-scrap-engine/README.md:73; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:237 |
| Search page | 646–762 KB; recorded bootstrap 668,969 bytes | — | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:84-85; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:85 |
| Item page | about 945 KB; description block ends at 87% (p90 94%) | — | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:281-286 |
| Replay reply | about 446 KB uncompressed; recorded median 446, max 453 KB | — | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:216; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:35-38 |

### 6.3 Hard limits

| Limit | Value | Source |
| --- | --- | --- |
| Input ranges | See §2.1 (for example `listingIds` ≤ 1,000, `maxListings` ≤ 5,000, `maxPagesPerSearch` ≤ 100, `maxRequests` ≤ 20,000, `maxRunSeconds` ≤ 3,600) | fb-scrap-engine/.actor/input_schema.json:15-160 |
| Photos per item | At most 40 | fb-scrap-engine/README.md:257-258 |
| Feed length | Ends at about 1,000–1,300 listings; "looks like a count cap" | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:124-127 |
| Photo links | Expire 104–108 h after collection | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:288-289 |
| Apify Creator plan | 32 concurrent runs, 64 GB RAM, 30 datacenter IPs; excess invoiced early once it reaches $200 | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:339-340 |
| Plan caps and budget | $85 a month and 10 GB residential; working budget $40 per cycle (the owner's own limit) | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:321-322; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:343 |
| Prepaid usage | One $500 pool for 2026-09-22 to 2027-03-21 on top of the plan's $6 (not monthly); $6.46 used and $499.54 left on 2026-09-23 | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:341-343; fb-scrap-engine/docs/MONETISATION_INPUTS.md:45-46; fb-scrap-engine/docs/design/SCALE_PLAN.md:85-86 |
| Block rate at volume | Untested: about 10–30k Facebook requests a day at 10k users. Raise volume in a stepped ramp, 24–48 hours per step, stopping on any rise in 302s or fallbacks, not a 200-check sample. | fb-scrap-engine/docs/design/SCALE_PLAN.md:111-113 |

### 6.4 Apify plans and the market reference

| Plan | Price | CU | Residential/GB | RAM | Concurrent runs | Source |
| --- | --- | ---: | ---: | --- | ---: | --- |
| Creator (current) | $6 per six months plus the $500 pool | $0.20 | $8 | 64 GB | 32 | fb-scrap-engine/docs/MONETISATION_INPUTS.md:45-46; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:323-325; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:339-340 |
| Starter | $19/month ($17 annual) | $0.20 | $8.00 | not documented in the listed files | 32 | fb-scrap-engine/docs/MONETISATION_INPUTS.md:50; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:345-346 |
| Scale | $199/month ($179 annual) | $0.16 | $7.50 | 256 GB | 128 | fb-scrap-engine/docs/MONETISATION_INPUTS.md:51; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:347-348 |
| Business | $999/month ($899 annual) | $0.13 | $7.00 | 512 GB | 256 | fb-scrap-engine/docs/MONETISATION_INPUTS.md:52; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:349-350 |

- These are list prices seen on 2026-09-23 (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:344).
- The plan fee converts into prepaid usage. Add-ons cost $5 per concurrent run and $1 per GB of RAM (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:351-354).
- The scale plan moves off Creator "when usage passes its caps" (fb-scrap-engine/docs/design/SCALE_PLAN.md:84-86).
- **Market reference.** The official `apify/facebook-marketplace-scraper` is priced per event: $5.00 per 1,000 listings plus $5.00 per 1,000 details at Bronze (Starter or Creator). It is $6.20 each on the Free plan, $3.80 at Silver and $2.60 at Gold (fb-scrap-engine/docs/MONETISATION_INPUTS.md:6-16).
  - Competing Store actors advertise $1.50 and $0.90 per 1,000 (fb-scrap-engine/docs/MONETISATION_INPUTS.md:22-28).
  - The listed files do not document the private actor's own Apify pricing model (for example pay per event or platform usage).

### 6.5 Scale-plan estimates (estimates only)

| Users | Centres × terms | Realistic monthly total | Per user | Source |
| --- | --- | ---: | ---: | --- |
| 1k | 20–30 × 6–8 | about $200–400 | $0.20–0.40 | fb-scrap-engine/docs/design/SCALE_PLAN.md:34 |
| 10k | 30 × 8–12 | about $470–780 | $0.05–0.08 | fb-scrap-engine/docs/design/SCALE_PLAN.md:35 |
| 100k | 40–45 × 10–16 | about $900–1,800 | $0.01–0.02 | fb-scrap-engine/docs/design/SCALE_PLAN.md:36 |

- The estimates leave out reruns of degraded checks, short feeds and failed runs (fb-scrap-engine/docs/design/SCALE_PLAN.md:41-42).
- New-listing volume is not yet measured (fb-scrap-engine/docs/design/SCALE_PLAN.md:43-44).
- Per-region plans:
  - Lean (4 terms): about $15 a month.
  - Standard (6 terms): about $31–32 a month.
  - With the $40 working budget, lean fits two regions and standard one (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:207-213).

---

## 7. Failure modes and how a caller sees them

| Failure | What the caller sees | What to do | Source |
| --- | --- | --- | --- |
| Fast search route fails (for example a bootstrap 302), fallback on | `searches[].route: "browser-fallback"`; about one page (about 24 listings); `sourceBinding` still `verified`; about 9 times the cost | Treat the search as degraded and rerun it | fb-scrap-engine/README.md:103-105; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:98-106; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:189-192 |
| Fast search route fails, fallback off | `searches[].route: "failed"` | Rerun it | fb-scrap-engine/README.md:84-85; fb-scrap-engine/README.md:103-105; fb-scrap-engine/.actor/input_schema.json:140 |
| Deadline (`maxRunSeconds`) reached | A search or listing ID the deadline stopped is `truncated` with stop reason `time-limit`, "never as failed". `route: "failed"` is also used when "the run deadline arrived first". Nothing new is sent, and no browser starts, after the deadline. | Rerun what was cut | fb-scrap-engine/README.md:103-108 |
| Apify timeout or abort before the actor finishes | No rows and no `RUN_SUMMARY` (they are written only at the end) | Keep the Apify timeout above `maxRunSeconds` | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:309-310 |
| `maxDetails` or `maxRequests` exhausted | Listings come back without details, "counted as unattempted" (`detailUnattemptedCount`); unfetched IDs are "not attempted, never … failed" | Resend them as `listingIds` | fb-scrap-engine/.actor/input_schema.json:91; fb-scrap-engine/README.md:81 |
| Our caps end a search | `status: "truncated"` with `stopReason` `page-cap` or (seen) `results-limit` | Not a failure; raise the caps if coverage is needed | fb-scrap-engine/README.md:101-102; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:10-14 |
| Short local feed instead of the long nationwide one | About 90 listings over about 4 pages (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:131-134). Its stop reason is not stated; `source-no-new-listings` is the documented normal end of a feed (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:113-117), so it probably ends that way (**inference**). | "Treat a short feed as a degraded sweep when nationwide coverage is needed" | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:113-117; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:131-145 |
| Page-1 overlap with the previous check missing | Detected by the app | Degraded: rerun, "never read as 'nothing new'" | fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:189-192 |
| Radius or order not applied by Facebook | "The run fails the source check" | How this surfaces is not documented in the listed files | fb-scrap-engine/.actor/input_schema.json:34; fb-scrap-engine/.actor/input_schema.json:42 |
| Replay fails | A page request follows (counted in `requests`); for example `description-missing` | Automatic | fb-scrap-engine/README.md:54-56; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:241-243 |
| Replays mostly fail | `detailRoute.circuitOpen: true` (≥ 20 replays and < 85% success) | `route-health.js` switches the region to `page` (`circuit-open`) | fb-scrap-engine/README.md:53-54; fb-scrap-engine/app/route-health.js:91-93 |
| Session pages stop supplying the replay template | `detailRequests` 0 and `failedBootstraps` ≥ max(2, `bootstraps`) | `bootstrap-failing`: switch to `page` | fb-scrap-engine/app/route-health.js:16-19; fb-scrap-engine/README.md:63-64 |
| Facebook deploys a change | A new ID in `detailRoute.queryIds` | `newQueryIds` with `alert: true`; watch the region | fb-scrap-engine/README.md:60-61; fb-scrap-engine/test/route-health.test.js:86-90 |
| Listing gone (sold or removed) | In the 200-listing sample, the 2 incomplete listings "no longer exist". A removed ID returns a `directItemUnresolved` row with `detailOutcome: "extraction-error"` (verified on v2 only). | Treat as gone only with that evidence; a listing missing from a sweep may still be live | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:222-224; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:254-255; fb-scrap-engine/README.md:332-338; fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:278-280 |
| Description not captured | `descriptionStatus` `partial` or `missing`; about 1–2% missing in deep runs, cause unknown | Refresh partial text before AI; a later system cannot recover words absent from the text | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:189-190; fb-scrap-engine/README.md:239-241; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:167-168 |
| Stale cached description (cache on only) | `detailCacheStatus: "stale-fallback"`; "not proof the seller has not edited the item" | Show as possibly outdated | fb-scrap-engine/README.md:273-274; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:193 |
| Photo link expired | `oe` expiry passed (104–108 h) | Refetch the item; "an expired link is never read as 'GPU not visible'" | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:288-289; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:103-104; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:174-175 |
| Memory below 1 GB | Browser fallback turned off; noted in `RUN_SUMMARY.memoryGuard`. v2 and Monitor inputs refuse to start. | Keep 1 GB for detail runs | fb-scrap-engine/README.md:86-89 |
| Datacenter proxy | Item pages returned a 331 KB page with no listing data (20 of 20, run `YSG04KLuDVby4Wk5p`); searches failed too | Use residential proxies | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:333-336 |
| Town slug or extra URL parameter | Redirects that the strict route check rejects; `locale=en_GB` gives unverified browser cards | Numeric `cityId` only; no extra parameters | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:34-38; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:67-76 |
| Overlapping detail runs using the cache | No per-ID lease | One details run at a time | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:296-297; fb-scrap-engine/README.md:275-276 |
| Seller blocks disappear | A shift in the 8.1% rate of search rows with a seller | Proposed as a coverage-limit signal | fb-scrap-engine/docs/design/SELLER_DATA.md:176-180 |
| Detail and search copies disagree | `conflicts[]` with both values; `provenance` names the source of each top-level field | The app decides | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:66-84; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:101-132 |
| Oddly encoded seller text | `+` in place of spaces in the title and description, passed through unchanged | Normalise in the app | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:466 |
| Validation error or failed run | Not documented for v3. For v2 Extract only: "A source failure retains rows from other sources. An all-blocked or all-unreadable run fails and writes per-source diagnostics to `RUN_SUMMARY`" (fb-scrap-engine/README.md:170), and every input URL gets a source outcome record, "including failed URLs in mixed runs" (fb-scrap-engine/README.md:410). The Apify status and message for a rejected input are not documented in the listed files. | Not documented in the listed files | fb-scrap-engine/README.md:170; fb-scrap-engine/README.md:410 |

- **Truncation is not failure.** The recorded run finished `SUCCEEDED` while its only search was `truncated` (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:8; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:10). Nabvy must read coverage from the summary and the `sourceOutcome` rows, not from the Apify status.
- **Cases the recorded run does not cover.** It contains no failed, sold, pending, hidden, partial or missing-description listings. It also has no page-route or browser-fallback output (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:28-33; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:106-110).

---

## 8. What the app must do

These are the duties the listed files assign to the app. Product rules marked "owner's decision" are not Nabvy's to change (nabvy/CLAUDE.md:28).

### 8.1 Calling and planning

| Duty | Source |
| --- | --- |
| Decide what to search and judge the results. Budgets, matching, distance and alerts belong to the app. | fb-scrap-engine/README.md:3; fb-scrap-engine/.actor/input_schema.json:3 |
| Use a fixed grid of search centres (city IDs 80–100 km apart, covering the UK and Ireland) × terms, never per user. Map each user to the nearest centre. Ireland needs its own centres. | fb-scrap-engine/docs/design/SCALE_PLAN.md:71-73; fb-scrap-engine/docs/design/SCALE_PLAN.md:127-129 |
| Batch each centre's terms in one run (31% cheaper, measured). | fb-scrap-engine/docs/design/SCALE_PLAN.md:75; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:331-332 |
| Combine newest-first checks with default-order checks and full sweeps. Keep full sweeps rare, and set frequency per centre and term from T2. | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:379-380; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:429-432; fb-scrap-engine/docs/design/SCALE_PLAN.md:97-98 |
| Keep per-region sweeps. A single national sweep per term is contradicted by the data (T6 tests it). | fb-scrap-engine/docs/design/SCALE_PLAN.md:94-96 |
| Rerun degraded searches: `browser-fallback`, `failed`, a missing page-1 overlap, a failed run, and short feeds when nationwide coverage is needed. | fb-scrap-engine/README.md:103-105; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:189-192; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:144-145 |
| Choose which IDs get details and send them as `listingIds` batches. R2 says every new ID in area (by city page) or shipped, whatever its price or title (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:164-166). Pipeline stage 6 adds "and are electronics, a container, a GPU or unknown" (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:67). The two statements differ, and the category condition changes detail volume and cost. | fb-scrap-engine/docs/HANDOFF.md:148-150; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:67; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:164-166 |
| Listing links pasted by users never start a per-user run: they join the shared, deduplicated details queue ($0.00092 plus AI, shared). | fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:228-229 |
| Choose `detailRoute` per region with `route-health.js`; call it before each run with stored summaries plus `runId`s. Request `page` for listings whose photos the app will review. | fb-scrap-engine/README.md:49-50; fb-scrap-engine/README.md:62-70; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:197-201 |
| Run details through one global queue, one details run at a time. Priority: frequent-check follow-ups, shortlisted refreshes, photo captures, then sweep follow-ups. | fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:194-196 |
| Run a spend governor on settled costs: at 80% of the budget slow the lowest-yield terms first, then sweeps; never drop queued work. | fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:202-203; fb-scrap-engine/docs/design/SCALE_PLAN.md:67 |
| Monitor route health, because "a Facebook change breaks every user at once"; alert on 302s and fallbacks. | fb-scrap-engine/docs/design/SCALE_PLAN.md:90-93; fb-scrap-engine/docs/design/SCALE_PLAN.md:114-115 |

### 8.2 Ingest and storage

| Duty | Source |
| --- | --- |
| Ingest every card once: the city page, the price and the "was" price, observations, and new-ID detection. HANDOFF says one observation per sighting; the proposed scale plan says store only changes. | fb-scrap-engine/docs/HANDOFF.md:146-147; fb-scrap-engine/docs/design/SCALE_PLAN.md:83 |
| Keep everything from each paid download; seller data stays internal. Keep the one durable copy in Supabase, never in Apify. | fb-scrap-engine/docs/HANDOFF.md:135-136; fb-scrap-engine/docs/HANDOFF.md:151-152; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:46-47 |
| Read `descriptionStatus` per row. Only `full_verified` text goes to text AI; refresh partial text first. | fb-scrap-engine/README.md:113-115; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:167-168 |
| Use the `sourceOutcome` rows and `RUN_SUMMARY.searches` to judge coverage. | fb-scrap-engine/README.md:410; fb-scrap-engine/README.md:99-105 |
| Link rows to Nabvy's own search plan: v3 rows carry `foundBySearchTerms`, not `targetQuery`. | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:417-419; fb-scrap-engine/README.md:97-98 |
| Use the city-page ID for place identity. Compute distance in the app from coarse detail coordinates or the city page's centre; for postcodes use a UK postcode service, not Facebook. | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:48-49; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:425-428; fb-scrap-engine/README.md:125-128 |
| Handle sold rows, £0 prices and foreign currencies. Keep EUR groups for Ireland and never convert them into GBP ones. | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:194-195; fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:286-288 |
| Build the evidence hash from an allowlist (title, full description, attributes, detail sections, custom titles and subtitles, condition, category). Leave out price, availability, listing status, location and cache status. | fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:127-131 |
| Photo bytes may be fetched only inside an Apify run, never by Nabvy's own code, not even through the Apify proxy (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:46-47; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:260-261; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:465-466). The actor returns photo links but neither downloads nor reads them (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:288-289). The capture option (`capturePhotos`, `maxPhotosPerListing` default 6, a byte cap, `photoCaptures[]`) is proposed, not built (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:3-4; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:97-107). Until it ships, Nabvy has no in-rules way to copy photo bytes. Once it exists: copy the bytes into Nabvy's own storage, since Apify run storage is only transit; key them on Facebook's gallery photo `id`; capture within about 100 hours of the detail fetch; fetch photos after the sixth only when the first six leave the GPU unstated (35% of PC listings have more than six); after review keep only the verdict and photo ID, and delete the bytes (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:48-56; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:132-135; fb-scrap-engine/docs/design/SCALE_PLAN.md:21-25). | fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:3-4; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:46-56; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:97-107; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:132-135; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:260-261; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:288-289; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:465-466; fb-scrap-engine/docs/design/SCALE_PLAN.md:21-25 |
| On ingest, move `seller` and every `marketplace_listing_seller` inside `sourceFields` into a restricted internal seller store: a private schema not exposed to the Data API. | fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:250-256; fb-scrap-engine/docs/design/SELLER_DATA.md:284-292 |
| Treat descriptions as untrusted text. Model output is limited to catalogue IDs and allowlisted fields, and quotes are checked against the source text. | fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:186-188; fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:245-247; fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:374-376 |

### 8.3 Interpretation (app-side product rules)

| Duty | Source |
| --- | --- |
| Build one parts record per listing version: listing kind, and every part with a word-for-word quote and an inclusion status. Rules first (`part-patterns.json`), AI only on gaps, once per listing, shared by every user. Keep price out of the version hash. | fb-scrap-engine/docs/HANDOFF.md:160-167; fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:233-249 |
| Find listings whose wanted part appears only in the description or photos. Acceptance tests: `29056633657273875` ("Pc", RTX 5060 in the description only) and `2756686961383848` (RTX 5080, 32GB DDR5 and 2TB NVMe in the description only). | fb-scrap-engine/docs/HANDOFF.md:127-134 |
| "Silence is never a 'no'": show "GPU not stated — ask the seller". Exclusion needs positive evidence. | fb-scrap-engine/docs/HANDOFF.md:169-170; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:43-45; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:183-185 |
| Tell "contains" from "mentions": 12 of the 14 description-only "5080" mentions were not offers. Offer a free noise filter (wanted, swap and "I buy" adverts, keyword stuffing, laptops, mention-only hits). | fb-scrap-engine/docs/HANDOFF.md:171-173; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:18-23 |
| Container detection (R1–R1c), "Confirmed" rules (R5) and photo gating (R4). | fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:150-182 |
| Asking-price position only for the same spec and condition, shown at n≥10, "thin" at 5–9, hidden below 5. | fb-scrap-engine/docs/HANDOFF.md:188; fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:175-185; fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:261-267 |
| Keep price history within one listing ID. Merge relists silently and internally. | fb-scrap-engine/docs/HANDOFF.md:191-192; fb-scrap-engine/docs/design/SELLER_DATA.md:144-155 |
| Photo review only when the text is silent; delete photo bytes after review. | fb-scrap-engine/docs/HANDOFF.md:197-198 |
| Demand signals: aggregated, with cells under 5 suppressed. | fb-scrap-engine/docs/HANDOFF.md:199-200; fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:273-275 |
| Copy-advert spam flag (owner's decision): mass-posted adverts (the same title and price in many towns; 29% of the sofa control per HANDOFF, 29.1% per the seller design, almost absent in PCs and GPUs) are flagged "likely spam" with the facts ("same advert in 12 towns in 2 days") and a hide setting. Count each cluster once in asking-price bands and send one alert per cluster; no seller data is needed. The rules are in `COPY_ADVERT_SPAM.md` (in progress, not a listed file). | fb-scrap-engine/docs/HANDOFF.md:174-179; fb-scrap-engine/docs/design/SELLER_DATA.md:79-84; fb-scrap-engine/docs/design/SELLER_DATA.md:94-107 |
| Warning signs are shown as neutral facts (deposit wording, an ask far below similar asks); no scam scores. | fb-scrap-engine/docs/HANDOFF.md:195-196 |

### 8.4 What the app must not do, and legal gates

| Rule | Source |
| --- | --- |
| Never show seller names, IDs, pictures, account links, or anything derived that identifies a seller. Redact identifying details from quotes users see; show locations no finer than town or distance; never serve photos from Nabvy's own storage. | fb-scrap-engine/docs/HANDOFF.md:212-213; fb-scrap-engine/docs/design/SELLER_DATA.md:296-301 |
| Labels ("suspected scam", "suspected trade seller", "suspected flipper") must always be worded as a suspicion and shown next to their evidence. They must follow a documented, calibrated rule, offer a report and correction route and reveal no seller identity. Scam labels run in shadow mode first; the wording gets legal review before launch. Never show an unexplained score. | fb-scrap-engine/docs/HANDOFF.md:94-112; fb-scrap-engine/docs/HANDOFF.md:214-216 |
| Never show price history across relisted listings. | fb-scrap-engine/docs/HANDOFF.md:217 |
| Never sell or share seller data, contact sellers or post on Facebook. | fb-scrap-engine/docs/HANDOFF.md:218-219 |
| Never present asking prices as sale prices or as what something is "worth". | fb-scrap-engine/docs/HANDOFF.md:222-223; fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:365-367 |
| Do not charge before legal advice on Meta's terms, database right, copyright and UK GDPR (LIA, DPIA and an Art 14 notice). | fb-scrap-engine/docs/HANDOFF.md:224-225; fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:329-331 |
| UK GDPR: an LIA and a DPIA before further collection; an Art 14 notice; an Art 21 suppression list keyed by a hash of the listing ID; processor agreements with Apify, Supabase and the AI provider; the shortest Apify run-storage retention. | fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:345-361; fb-scrap-engine/docs/design/SELLER_DATA.md:131-142; fb-scrap-engine/docs/design/SELLER_DATA.md:313-317; fb-scrap-engine/docs/design/SCALE_PLAN.md:116-126 |
| CI tests that fail on any seller field or key in user-facing output, and on identifying text. | fb-scrap-engine/docs/design/SELLER_DATA.md:324-330 |
| Proxy and session rotation and replayed queries "may raise exposure beyond contract, including under the Computer Misuse Act; this is for counsel". In this actor that covers the `graphql` detail route (which replays Facebook's item request), the fast search route (which replays Facebook's preloaded search request) and `detailSessionSize` session rotation (**inference**; fb-scrap-engine/.actor/input_schema.json:119; fb-scrap-engine/.actor/input_schema.json:133; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:84-85). Legal advice is a gate before any payment, sale or sharing with third parties, including validation sales; validation uses fake doors that deliver no data. Get the legal view before collecting seller data at scale. | fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:321-331; fb-scrap-engine/docs/design/SELLER_DATA.md:320-323 |

**Where the brief and Nabvy's build pack differ.** The brief wins (nabvy/CLAUDE.md:5), so each of these is listed for the owner rather than settled here.
- **Seller data.**
  - Nabvy's rule "Never store seller names or profile links. Public seller IDs are hashed before storage" is marked superseded for actor data by the owner's decision of 2026-09-24 ("keep everything the actor returns…") (nabvy/CLAUDE.md:12).
  - The brief says to keep seller data and not strip it (fb-scrap-engine/docs/HANDOFF.md:87-90).
  - The seller design's guidance says otherwise: don't store picture links unless a purpose is documented first, and "no measured use needs names either"; keep token-based keys and links for 7 days after a listing is last seen (suggested), and numeric-ID keys and any names for at most 90 days; keep raw names and IDs in a separate table with narrower access (fb-scrap-engine/docs/design/SELLER_DATA.md:291-309).
  - The parts design says: "Strip phone numbers, emails and names from descriptions before AI and before storage" (fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:359-360).
- **Snapshot retention.** Nabvy's "Raw provider responses live in snapshot storage for 30 days" (nabvy/CLAUDE.md:12) against "keep everything from each paid download" (fb-scrap-engine/docs/HANDOFF.md:151-152) and the design's retention points above.
- **Batches.** Nabvy's pipeline tasks process 100–500 listings (nabvy/CLAUDE.md:24). The brief keeps `listingIds` batches at up to about 200 so that frequent checks can interleave (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:68; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:108-109).

---

## 9. Data files

### 9.1 `docs/data/city-pages.seed.json`

- **Source.** "City-page IDs seen on Marketplace listing cards in Apify runs, 2026-09-22 to 2026-09-23 (mostly from searches centred on Chichester). Coordinates are town-level approximations from listing data; verify before use as search centres." (fb-scrap-engine/docs/data/city-pages.seed.json:2)
- **Shape.** `{ source, count: 771, cityPages: [771 entries] }` (fb-scrap-engine/docs/data/city-pages.seed.json:2-4).
  - Each entry has `cityPageId` (numeric string), `name`, `towns` (1–3 strings), `lat` and `lng` (number or `null`), `listingsSeen` and `verifiedAsSearchCentre` (fb-scrap-engine/docs/data/city-pages.seed.json:5-14).
  - HANDOFF describes it as "771 Facebook city IDs, 5 verified centres" (fb-scrap-engine/docs/HANDOFF.md:243-244).
- **Counts** (**computed for this rebuild** from fb-scrap-engine/docs/data/city-pages.seed.json:4-8506):
  - 5 entries have `verifiedAsSearchCentre: true`, 766 false.
  - 635 entries have coordinates and 136 have none.
  - `listingsSeen` sums to 12,366.
  - 19 pages map to more than one town (for example Brighton and Hove → Hove, Brighton).
- **Verified centres.**

  | Name | `cityPageId` | `lat`, `lng` | `listingsSeen` | Line |
  | --- | --- | --- | ---: | --- |
  | Belfast | 109312942421526 | null | 2 | fb-scrap-engine/docs/data/city-pages.seed.json:622-631 |
  | Chichester, West Sussex | 115935195086622 | null | 8 | fb-scrap-engine/docs/data/city-pages.seed.json:1593-1602 |
  | Dublin | 110769888951990 | null | 0 | fb-scrap-engine/docs/data/city-pages.seed.json:2422-2431 |
  | Edinburgh | 115753025103602 | null | 0 | fb-scrap-engine/docs/data/city-pages.seed.json:2598-2607 |
  | Glasgow | 106233566079281 | null | 0 | fb-scrap-engine/docs/data/city-pages.seed.json:3105-3114 |

  - None of the five has coordinates in the seed. Facebook's reported centres for four of them are in §5.1.
  - London (`106078429431815`, 51.5121, −0.1044, 1,086 listings seen) is not marked verified (fb-scrap-engine/docs/data/city-pages.seed.json:4459-4468).
- **Against the recorded run** (**computed for this rebuild**). 16 of the run's 18 city pages are in the seed. Chessington (`103764492995711`) and "Upton, Dorset" (`104111572957977`) are not (nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:3288-3296; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:3665-3672).
- **Relation to other counts.** The ledger counts 768 distinct city pages in `.verification/city-pages.json` (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:44). How that relates to the seed's 771 is not documented in the listed files.

### 9.2 `docs/data/part-patterns.json`

- **About.** "Case-insensitive regular expressions from the 2026-09-24 offline parts analysis … A starting point for the app rule pass: coverage was measured, precision and recall were not. Written for Python re; checked to compile as JavaScript RegExp with the i flag. Remove office 'OptiPlex 3080/3090' strings before GPU matching, and parse spec lines rather than hashtag blocks." (fb-scrap-engine/docs/data/part-patterns.json:2)
- **Shape.** `about`, `flags: "i"`, `listingKind` (6 named patterns), `fields` (8 named patterns) and `gpuModels` (19 ordered `{ model, pattern }` entries) (fb-scrap-engine/docs/data/part-patterns.json:1-99).

| Group | Entries | Source |
| --- | --- | --- |
| `listingKind` | `wantedTitle`, `wantedDescriptionFirst400Chars` (for the first 400 characters of a description), `laptopTitle`, `pcTitle`, `notAPcTitle`, `cpuOrPcTitle` | fb-scrap-engine/docs/data/part-patterns.json:4-11 |
| `fields` | GPU model, CPU model, RAM size, RAM generation, Storage size, Storage type, PSU wattage, Motherboard chipset | fb-scrap-engine/docs/data/part-patterns.json:12-21 |
| `gpuModels` | RTX 5090, 5080, 5070 Ti, 5070, 5060 Ti, 4090, 4080 Super, 4080, 4070 Ti Super, 4070 Ti, 4070 Super, 4070, 3090 Ti, 3090, 3080 Ti, 3080; RX 9070 XT, RX 7900 XTX, RX 7900 XT. Base models use negative lookaheads so they do not match Ti, Super or XTX variants. RTX 3090 and 3080 use lookbehinds against "optiplex ". | fb-scrap-engine/docs/data/part-patterns.json:22-99 |

**Checks made for this rebuild** (**computed for this rebuild**; a 20-listing check, not a precision measurement). All 33 patterns compiled as JavaScript `RegExp` with the `i` flag. Applied to the recorded run's titles and descriptions:
- `pcTitle` matched all 20 titles, and `notAPcTitle` matched both headset titles.
- Neither wanted pattern matched any listing.
- `laptopTitle` matched the desktop "Lenovo Legion Gaming PC" through `\blegion\b` (fb-scrap-engine/docs/data/part-patterns.json:7; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:4734).
- `gpuModels` matched 3 listings (RTX 3090 Ti once, RTX 5070 twice).
- 5 listings matched none of the 8 field patterns.
- "Dell OptiPlex 3090" did not match RTX 3090, and "RTX 3090" did.
- `gpuModels` has **no plain RTX 5060 entry**, although listing `29056633657273875` (RTX 5060) is an acceptance test (fb-scrap-engine/docs/HANDOFF.md:130-131). The recorded "Gaming PC RTX 5060 8GB" title matched no `gpuModels` entry; the generic "GPU model" field pattern covers it (fb-scrap-engine/docs/data/part-patterns.json:13; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:3271).

---

## 10. Evidence

Measured facts a caller relies on, with their conditions. "Unsettled" means the cost was read before Apify settled it.

| Fact | Date | Build | Sample / run | Source |
| --- | --- | --- | --- | --- |
| The recorded run returned 20 listings and 1 `sourceOutcome` row: 22 requests, 25 s, settled $0.0177, all 20 `full_verified`, 19/19 replays from 1 bootstrap, operation ID `28897280379855964` | 2026-09-24 01:40 UTC | 1.0.82 | `VkryjpwS6U2GBDh3k`; `gaming pc`, Chichester, newest first, page 1, `graphql`, 1 GB | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/README.md:3-11; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:25-39; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:106-110 |
| `graphql` details: 48/50 `full_verified` (UK 30/30, Dublin 10/10 in EUR, sofa 8/10); 71 s; 142 MB; $0.0468 unsettled; `requests` 55; breaker not tripped | 2026-09-24 | 1.0.82 | `5BiCf7P5bni9S9a7x`, 50 IDs, 1 GB | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:232-245 |
| `page` details: 10/10 complete; 10 requests; 44 s; 141 MB; $0.0157 unsettled | 2026-09-24 | 1.0.82 | `ThoirBcYvoz7KALO4`, 10 IDs, fallback off | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:238 |
| Three newest-first page-1 terms: all `route: http`, 24 listings each; 26 s; 103 MB; memory guard turned the fallback off; $0.0048 unsettled | 2026-09-24 | 1.0.82 | `2WNV4xKHG9GR00i4o`, 512 MB | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:239 |
| Item pages carry 26 other listings (20 cards plus 6 by ID; 15 of 15 pages); 10 pages gave 155 unique listings; replay responses carry pivots only (47 of 47) | 2026-09-24 | 1.0.82 | `responseInventory` on the two detail runs above | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:269-275 |
| `graphql` against `page` on the same 20 listings: 20/20 full, identical text; 97 against 170 KB; 56 against 120 s; $0.00092 against $0.00166 settled | not dated in the ledger | 1.0.81 (opt-in) | `sbcJsffiMPANhshN6` | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:205-216 |
| `graphql` 200-listing sample: 198/200 complete (99%); 193/197 replays; 196/198 descriptions identical to 23 September's; 815 MB | not dated (compared with 23 September) | before 1.0.82 | `hCTDrgRdTLRSUxGNe` | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:222-231 |
| Fast route 30/30 page-1 searches; `route` and `source-no-new-listings` verified; no 302 | — | 1.0.80 | T1, $0.03 | fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:253; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:472-475 |
| Radius does not decide feed scope: at the same moment 10, 161 and 500 km gave the long feed and 65 km the short one | — | 1.0.80 | 4 simultaneous searches | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:135-138 |
| About 3 of 14 full-depth `3090` reads were short | 2026-09-23 | — | 14 reads | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:139 |
| Newest first missed 11% (65 km), 24% (100 km) and 41% (115 km) of related listings; its newest was 6 h old against 18 min in the default feed | — | — | Same period, compared with the default feed | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:160-165 |
| Newest-first lag 0.7 h (`3090`) and 12 h (`gaming pc`) | — | — | One snapshot | fb-scrap-engine/docs/design/SCALE_PLAN.md:48-49 |
| Newest-first order and set by radius: 119 of 119 pairs in order at 500 km; at 65 and 10 km one block of five older listings appeared late on page 5; 10 and 500 km gave identical sets, 65 km shared 112 of 120 | — | — | Newest-first searches at 10, 65 and 500 km | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:152-157 |
| Two-term full-depth repeats overlap 87–95% (Jaccard); simultaneous long feeds 98–100% | — | — | — | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:119-120 |
| Browser fallback: about 24 listings, still `verified`; 16× data, 9× cost ($0.020 against $0.0022, settled) | First sighting not dated; second 2026-09-23 | 1.0.56 or 1.0.57 (first sighting; "the sources disagree"); not stated for the second or for the cost comparison | `2QeWuDsCZwK7IEhrP`, `fPvLzW53iyhPw2UBA` | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:98-106 |
| Batching three terms: $0.0015 per term against $0.0022 (31% less), settled | — | not stated (1.0.80 inferred from the neighbouring breakdown) | — | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:323-332 |
| Listings only about $0.02–0.04 per 1,000; details cold about $1.6 and warm about $0.26 per 1,000 (settled) | 2026-09-23 | — | Creator plan; one city, one day | fb-scrap-engine/docs/MONETISATION_INPUTS.md:30-41; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:315-318 |
| Full descriptions 98.3–98.8% in deep runs | — | — | Deep runs | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:189-190 |
| Datacenter IPs: 20/20 item pages with no listing data | — | — | `YSG04KLuDVby4Wk5p` | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:333-336 |
| UK and Irish centres bind on the fast route; GB and IE proxies gave identical Dublin page-1 results; Belfast feed holds no Republic listings | 2026-09-23 | — | Newest-first page 1; 30-page Belfast search | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:50-66; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:492-493 |
| Cards have no coordinates (0 of 1,268 without cache hits); card attributes 15 of 5,503; seller attributes on detail rows (11,012 rows) | — | — | Exports | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:174-177; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:196-199 |
| Seller data: ID on 35.3% of 2,999 listings; 8.1% of search rows; 85% rotating tokens; tokens seen again after 20+ h had changed (20 of 20); numeric IDs stable over 37 h | 22 Sep 08:51 to 23 Sep 22:03 UTC | — | About 37 h of logged-out data; mostly `3090` and `gaming pc` around Chichester plus a sofa control; regex-classified | fb-scrap-engine/docs/design/SELLER_DATA.md:5-16; fb-scrap-engine/docs/design/SELLER_DATA.md:31-55 |
| Where the GPU is named, in about 886 PC-like listings: title about 55%, description only 34–35%, nowhere 11–12%; bare "Pc"/"Gaming pc" titles name a GPU only in the description in 107 of 135 | not dated in the cited lines | — | Local detail runs | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:381-388; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:25-29; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:164-166 |
| Descriptions add parts: all four core fields in 13.3% (title only) against 64.1% (title + description) of 841 desktop PCs | 22–23 Sep | — | 66 datasets, 5,094 unique listings | fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:6-9; fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:38-44 |
| RTX 5080 worked example `2756686961383848`: found five times through Chichester `3090` searches, at ranks 853 of 1,301, 479 of 1,296, 387 and 444 | 2026-09-24 (offline, $0) | — | Stored data | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:389-413 |
| Photo links expire 104–108 h after collection | — | — | — | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:288-289 |
| Memory: HTTP-only 147 MB peak; 200-listing details 815 MB | — | — | — | fb-scrap-engine/README.md:71-72 |

- **Not dated in their source.** The schema's "about $0.0015 per listing" and "about $0.0003 per result page", and "65 km when last observed", carry no date or build (fb-scrap-engine/.actor/input_schema.json:34; fb-scrap-engine/.actor/input_schema.json:56).
- **Not to be cited as current.** The ledger lists results that no longer hold: results capped at 18 pages, multi-search results before 1.0.77, Monitor-in-Actor runs, town-slug and Selsey experiments, reference-actor comparisons, synthetic probe files, and "Radius does nothing" (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:437-450).
- **Stale lines inside the ledger:**
  - "The staged fix (not deployed)" (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:107-108) against "Build 1.0.80 is deployed" (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:472).
  - "The item GraphQL request has never been captured" (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:287) against the replay route (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:205-210).
  - Open question 4, "Make the replay route the default…" (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:480-481), against "It became the v3 default in build 1.0.82" (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:231).
- **The ledger's own review.** It says every claim was checked by an independent review on 2026-09-23 (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:3-6). Its 2026-09-24 entries postdate that review. Its underlying reports and `.verification/` exports are outside the listed files (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:21-25).

---

## 11. Gaps

Each gap is a question for the owner or for the actor. "Actor" means the actor's author.

### 11.1 Contract and input

| # | Question | For | Why it matters | Sources |
| --- | --- | --- | --- | --- |
| Q1 | The docs say each row carries its city page at `locationDetails.reverse_geocode.city_page.id`. The recorded rows (details on) have `locationDetails: { latitude, longitude }`, and the city page only under `sourceFields.search.location.reverse_geocode.city_page` and `conflicts[].searchValue`. Which path is the contract, and does it differ for listings-only rows? | Actor | Nabvy keys place identity and search centres on the city page | fb-scrap-engine/.actor/input_schema.json:27; fb-scrap-engine/README.md:115-116; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:369-378; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:433-436 |
| Q2 | Where is the full v3 contract: the listing row, `sourceOutcome` and `RUN_SUMMARY` schemas? HANDOFF points to `docs/APP_INTEGRATION_GUIDE.md` ("in progress"), which is not a listed file. Can it be added to the list? | Owner | Nabvy's Zod contracts must be derived from a stated schema, not a single run | fb-scrap-engine/docs/HANDOFF.md:118-119 |
| Q3 | Which input fields are required (for example `cityId` on a `listingIds`-only run)? How are unknown fields rejected, given `additionalProperties: true`? What does the caller see: Apify status, message, or an error in `RUN_SUMMARY`? | Actor | Gateway input validation and error handling | fb-scrap-engine/.actor/input_schema.json:4-7; fb-scrap-engine/README.md:95-96 |
| Q4 | What order applies when `sort` is omitted? | Actor | Nabvy should always send `sort`; the default is undocumented | fb-scrap-engine/.actor/input_schema.json:39-52 |
| Q5 | The README says listing-ID fetches run "within the request, result and time limits": is that result limit `maxListings`, and how do listing IDs share it with searches? How do `startUrls` combine with `searchTerms`, `cityId` and `maxPagesPerSearch`? Should the gap-fill plan (`maxListings` of about 8,000, above the 5,000 maximum) be split across runs, or will the `maxListings` maximum be raised? | Actor / owner | Mixed runs and caps | fb-scrap-engine/README.md:73-74; fb-scrap-engine/.actor/input_schema.json:61-63; fb-scrap-engine/.actor/input_schema.json:82-87; fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:141-145 |
| Q6 | How does a failed "source check" (radius or order not applied) appear: run status, `searches[].status`, or a `sourceOutcome` value? | Actor | Nabvy must detect it | fb-scrap-engine/.actor/input_schema.json:34; fb-scrap-engine/.actor/input_schema.json:42 |
| Q7 | What is the minimum memory for build 1.0.82: 512 MB or 1 GB? The README, ledger and scale plan disagree. | Actor | Cost of frequent checks | fb-scrap-engine/README.md:86-87; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:239; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:337-338; fb-scrap-engine/docs/design/SCALE_PLAN.md:79 |
| Q8 | Should Nabvy pin a build instead of `latest`? The recorded run used `latest`. | Owner | A new build could change output without notice | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:16 |
| Q9 | Is `YfdUav3sZ2BgEf8rh` the "private test Actor" the brief refers to, or the production actor? The README distinguishes a verification actor from "the historical production Actor". | Owner | Nabvy may call only one actor | fb-scrap-engine/docs/HANDOFF.md:82-83; fb-scrap-engine/README.md:484; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:294-295; nabvy/CLAUDE.md:9 |

### 11.2 Output meaning

| # | Question | For | Why it matters | Sources |
| --- | --- | --- | --- | --- |
| Q10 | What are `stopReason: "results-limit"` and `httpStopReason` (not in the documented list), and what is the full vocabulary of `status`, `stopReason`, `route`, `detailOutcome` and `detailRoute.failures`? | Actor | Coverage logic and reruns | fb-scrap-engine/README.md:101-108; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:10-14 |
| Q11 | What do `descriptionComplete`, `variablePrice`, `sourceComparison`, `parentListing`, `originGroup`, `detailFailed`, `routedToPage`, `extraRequests` and `listing_price.amount_with_offset_in_currency` mean? The last was about 133× the GBP amount (132.995–133.000), not an exact multiple. | Actor | Field mapping | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:206-210; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:419-446 |
| Q12 | With `graphql`, does the session page's own listing get its gallery and count as a detail request? The recorded run suggests yes (1 bootstrap, 19 replays, gallery on row 1 only). The ledger's 50-ID run counted 2 bootstraps on top of 50 replays. | Actor | Request budgeting and photo expectations | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:30-36; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:14-51; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:241-243 |
| Q13 | Which request count should Nabvy use for accounting? Apify's `statusMessage` says "Total 1 requests" while `RUN_SUMMARY.requests` is 22. | Actor | Spend and block-rate monitoring | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:9; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:3 |
| Q14 | Where does "every observed listing ID" from `sourceDiagnostics` go (`candidateIds`?), and is anything seen but not emitted? Is v3 `candidateIds` capped at 500, as the v2 text says of `sourceDiagnostics` candidate IDs, and does v3 report `omittedCandidateCount`? A 500 cap would matter for full sweeps of about 1,300 listings. | Actor | Coverage audit | fb-scrap-engine/.actor/input_schema.json:164; fb-scrap-engine/README.md:308; fb-scrap-engine/README.md:387-389; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:40-61 |
| Q15 | When will the embedded browse-feed cards, pivot terms and on-demand photo capture (`capturePhotos`, `photoCaptures[]`, or the media-viewer query) ship, and with what output shape? | Actor | Free discovery; photo review | fb-scrap-engine/docs/HANDOFF.md:153-154; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:278-280; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:480-481; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:97-107 |
| Q16 | Is `directItemUnresolved` confirmed on v3 for removed IDs, and what does a sold listing look like on the `graphql` route? | Actor | Tells gone listings from failures | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:222-224; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:254-255 |

### 11.3 Operations and cost

| # | Question | For | Why it matters | Sources |
| --- | --- | --- | --- | --- |
| Q17 | Does "one details run at a time" still apply when every run has `useDetailCache: false`? The stated reason is the cache's missing lease. And do `listingIds` now run in parallel (README) or one after another (scale plan)? | Owner / actor | Detail throughput and queue design | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:296-297; fb-scrap-engine/docs/design/SCALE_PLAN.md:80-82; fb-scrap-engine/README.md:73 |
| Q18 | Which detail cost should Nabvy budget with the cache off: $0.00092 (`graphql`, settled on 20 listings), $0.0015 (schema), $0.0017 (container design; settled, route not named) or about $1.6 per 1,000 (cold, route not stated)? | Owner | Spend governor and pricing | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:214-216; fb-scrap-engine/.actor/input_schema.json:56; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:68; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:318 |
| Q19 | How does Nabvy's gateway compute `settledCostUsd` (0.0177) against Apify's `usageTotalUsd` (0.00029), and what sets `reserveUsd` (0.3363)? What is the private actor's Apify pricing model? | Owner | Cost ledger accuracy | nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:5-6; nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json:14 |
| Q20 | What check cadence per term class, and what latency can users be promised? This waits for T2. | Owner | Scheduling | fb-scrap-engine/docs/HANDOFF.md:145; fb-scrap-engine/docs/design/SCALE_PLAN.md:54-56 |
| Q21 | Still open in the ledger: what triggers short feeds; whether pages after the first repeat-only page add listings; the cause of the 1–2% missing descriptions; block rate at high frequency; whether proxy country changes the feed; the bootstrap retry under a real 302; `detailConcurrency` 8 against 4 and proxy session reuse; category browse feeds on the fast route. | Actor | Coverage and reliability | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:470-493; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:482-486 |
| Q22 | Which centre grid should Nabvy use? The seed has 5 verified centres without coordinates, while the plan needs 25–45 centres 80–100 km apart. Glasgow's Facebook centre is not recorded, and the recorded run hit two city pages missing from the seed. | Owner | Search planning | fb-scrap-engine/docs/data/city-pages.seed.json:2; fb-scrap-engine/docs/design/SCALE_PLAN.md:18-20; fb-scrap-engine/docs/design/SCALE_PLAN.md:71-73 |

### 11.4 Product and data policy

| # | Question | For | Why it matters | Sources |
| --- | --- | --- | --- | --- |
| Q23 | For seller data, which applies to Nabvy: "keep everything … unredacted" (the owner's decision in HANDOFF and nabvy/CLAUDE.md:12), or the seller design's minimisation, 7/90-day retention and narrower-access table, and the parts design's "Strip phone numbers, emails and names from descriptions before AI and before storage" (fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:359-360)? Should the actor return an HMAC seller key instead of raw fields? | Owner | Storage design and UK GDPR | fb-scrap-engine/docs/HANDOFF.md:87-93; fb-scrap-engine/docs/design/SELLER_DATA.md:109-117; fb-scrap-engine/docs/design/SELLER_DATA.md:284-309; fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:359-360 |
| Q24 | Card observations: store one per sighting (HANDOFF) or only changes (scale plan, proposed)? | Owner | Schema and storage cost | fb-scrap-engine/docs/HANDOFF.md:146-147; fb-scrap-engine/docs/design/SCALE_PLAN.md:83 |
| Q25 | What retention N applies to raw descriptions, and what retention for Apify run storage? | Owner | Retention jobs | fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:257-259; fb-scrap-engine/docs/design/SELLER_DATA.md:316-317 |
| Q26 | Should `part-patterns.json` gain a plain RTX 5060 entry (an acceptance example), and should `laptopTitle` stop matching desktop "Legion" PCs? Precision and recall are unmeasured. | Owner | Rule pass accuracy | fb-scrap-engine/docs/data/part-patterns.json:2; fb-scrap-engine/docs/data/part-patterns.json:7; fb-scrap-engine/docs/HANDOFF.md:130-131 |
| Q27 | Is Ireland (EUR) in scope for Nabvy's first release? It needs separate centres and EUR price groups. | Owner | Currency handling | fb-scrap-engine/docs/design/SCALE_PLAN.md:127-129; fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:286-288 |
| Q28 | Has counsel reviewed the replay routes (the `graphql` detail route and the replayed search request) and session rotation before Nabvy relies on `graphql` as its default? | Owner | The parts design says these "may raise exposure beyond contract, including under the Computer Misuse Act" | fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:325-326; fb-scrap-engine/.actor/input_schema.json:119; fb-scrap-engine/.actor/input_schema.json:133 |

### 11.5 Pending updates to recheck

The listed files announce work that may change this reference within hours. As of 2026-09-24 08:53 UTC, no listed file had changed since 01:04 UTC (fingerprints in the preamble). A later pass should compare those fingerprints and reread any file that changed.

| Pending item | Expected | What it would settle | Source |
| --- | --- | --- | --- |
| Test T2 results: newest-first recall and lag against default-order and full feeds; short-feed frequency; new-listing volume | Began 2026-09-23 21:00 UTC for 24 h, so results would come after about 2026-09-24 21:00 UTC. Results go to `.verification/paired-2026-09-23/`, outside the listed files, so they would reach this reference only through an update to the ledger or the designs. | Q20; cadence; the newest-first figures in §5.1 and §10 | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:476-478; fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:254; fb-scrap-engine/docs/design/SCALE_PLAN.md:135 |
| `docs/APP_INTEGRATION_GUIDE.md` (contracts, Supabase schema, how to call the actor) | "in progress"; not a listed file | Q2–Q6, Q10, Q11 | fb-scrap-engine/docs/HANDOFF.md:118-119 |
| `design/COPY_ADVERT_SPAM.md` | "in progress"; not a listed file | Copy-advert flag rules | fb-scrap-engine/docs/design/SELLER_DATA.md:105; fb-scrap-engine/docs/HANDOFF.md:179 |
| Next actor build: embedded cards and pivot terms; the photo query option | Not dated | Q15 | fb-scrap-engine/docs/HANDOFF.md:153-154; fb-scrap-engine/docs/EVIDENCE_LEDGER.md:278-281 |
| Ledger header still "Updated 2026-09-23", with stale lines (§10) | — | Which ledger statements are current | fb-scrap-engine/docs/EVIDENCE_LEDGER.md:3-6 |

## 12. Restored after the scope check

The scope check (`docs/fb-actor-scope-report.md`) found these points supported by the listed files but missing from the rebuild. They are added here with their sources.

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
