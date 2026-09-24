# `copy-advert`: design

Status: proposed, 2026-09-24. Nabvy's own design of copy-advert spam and scam detection, built as a stand-alone atomic module. It is the first feature module the owner named (`nabvy/docs/decisions.md:60`). The brief links a `COPY_ADVERT_SPAM.md` design (`fb-scrap-engine/docs/HANDOFF.md:179,251`; `fb-scrap-engine/docs/design/SELLER_DATA.md:105`), but that file does not exist. Nabvy writes this design itself (`nabvy/docs/decisions.md:7,46`).

**How to read this.**
- **Citations.** `modules.md` is the module catalogue beside this file, and its rules and names apply unless section 0 changes them. Other citations use `path:line`: `fb-scrap-engine/…` for the actor's listed files, `nabvy/…` for Nabvy's repository. Nabvy line numbers refer to commit `7debf5d` (`nabvy/CLAUDE.md` as of `05227ec`; re-checked by the audit of 2026-09-24).
- **The recorded run.** `…/dataset.json` is Nabvy's recorded run, `nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json`. Row numbers count listing rows from 1.
- **Computed figures.** "Computed" marks figures this session worked out from that run with `copy-baseline.py` (beside this file). Its trigram similarity reimplements pg_trgm's rule and still has to be confirmed against pg_trgm itself in the module's database test.
- **Labels on figures.** Figures from the actor's analysis keep their conditions. "Calc." marks arithmetic on cited unit costs, and "starting value" marks a threshold that has not been calibrated yet.

## 0. Changes from `modules.md`, and why

The design keeps the name `copy-advert`, the "First" priority, round 6 of the dependency graph, and the switch and view rules of `modules.md`. It changes the following; the audit of 2026-09-24 applied these changes to `modules.md`, so the catalogue's card now matches:

| # | Change | Why |
| --- | --- | --- |
| 1 | Contract file `packages/contracts/src/modules/copy-advert.ts`, imported as `@nabvy/contracts/modules/copy-advert`, with error codes in the same file. Thresholds live in `services/copy-advert/src/domain/rules.ts`, versioned, not in `packages/config/src/modules/` | The foundation fixed this layout (`nabvy/packages/contracts/README.md:13-24,58-66`; `nabvy/scripts/new-module.mjs:4-7`), and the foundation's layout wins (`modules.md:7`). Thresholds are part of the rule version, so they live with the rule in `src/domain/rules.ts`. This departs from rule 14 (`modules.md:112`) and `nabvy/docs/engineering.md:15`, which put caps and thresholds in `@nabvy/config`, and is a coordinator question (section 9) |
| 2 | Seven more tables beside `clusters`, `members` and `flags`: `prints`, `links`, `photo_matches`, `candidate_requests`, `overrides`, `reports` and the restricted `account_checks` (section 5.1) | A module cannot index another module's view, so the trigram index needs this module's own copy of the normalised text. Photo-ID matches without a text link, corrections, reports and account checks need their own rows |
| 3 | The module computes its own description hash under its versioned normalisation. It does not use `detail-evidence.v_fingerprints` | Its rule version must cover the normalisation, so changing the rule reruns cleanly |
| 4 | Asks `listing-ingest` to publish the card's primary photo ID and `money.kind` in `v_listings` | Both are needed: the photo ID for photo evidence (4.6), and `money.kind` so only fixed prices are fingerprinted (4.3). The card hash already uses the photo ID (`modules.md:72`) |
| 5 | Adds `v_listing_copy_facts` (one row per listing, internal) and `v_review_queue` | Readers need per-listing facts, and hand checks need a queue (`fb-scrap-engine/docs/design/SELLER_DATA.md:345-346`) |
| 6 | Adds `audit-log` and `account` (hard) and a soft reader edge from `demand-signals` | Corrections are audited (`nabvy/docs/security.md:26`). A module with user rows purges them on `account.deleted`, and every signed-in procedure checks the account's standing (`modules.md:108`). A wanted advert posted in many towns should count once (section 7) |
| 7 | Beta scope: UK only, GBP only. Currency stays in every key | Owner, 2026-09-24 (`nabvy/docs/decisions.md:19,132,137`) |
| 8 | The user-facing flag goes live only when both hold: the owner has signed off the wording and display threshold, and the legal review of the wording that the brief requires before launch has been completed. Agents never run or commission that review (`nabvy/CLAUDE.md:29`; `nabvy/docs/decisions.md:188`). They list the point in `nabvy/docs/legal-review.md`, and the owner arranges it | The Precedence row "Labels and scores" says the wording gets legal review before launch (`nabvy/docs/decisions.md:13`; `fb-scrap-engine/docs/HANDOFF.md:104-106,186`), and that gate is not among those the owner lifted (`nabvy/docs/decisions.md:175-180`). The point is listed at `nabvy/docs/legal-review.md:21` |
| 9 | Adds a consumer: the owner's "too good to be true" mark, which uses copies across distant places and counts user reports on a listing's copies | `nabvy/docs/decisions.md:154-166`, decided after `modules.md` was written |
| 10 | Candidate detail fetches only for listings that users' hunts already returned, capped daily, at the lowest queue priority | "Nothing runs unless a user asks" and the $150 monthly Apify cap (`nabvy/docs/decisions.md:131,138`) |
| 11 | Contracts: keeps `CopyAdvertFlag`, `CopyAdvertRuleConfig` and `CopyAdvertClusteredEvent` (`modules.md:722`); drops `CopyAdvertFingerprint`; adds `CopyAdvertReportInput` and `CopyAdvertCorrection`. The view row types that `modules.md:722` calls `CopyAdvertCluster` and `CopyAdvertMember`, and a new per-listing facts row, move out of contracts: they are derived with `drizzle-zod` in `packages/db/src/schema/copy-advert.ts` as `vClusterFactsRow`, `vMembersRow` and `vListingCopyFactsRow` (section 5.3) | A fingerprint never crosses a boundary, so it stays a domain type ("rule of two", `nabvy/docs/engineering.md:21`). View rows are persisted shapes, which `packages/db` owns, and contracts must not import `@nabvy/db`, which already depends on contracts (`nabvy/packages/contracts/README.md:4-6`; `nabvy/packages/db/package.json:19-21`). Reports and corrections cross the procedure boundary |
| 12 | User-view columns change from `modules.md:721` (listing_id, flag, town_count, span_days) to listing_id, towns, span_days, window_days, rule_version | The flag is its own row, so `flag` adds nothing. `towns` and `span_days` are computed per listing and leave out the listing's own town, so a relist never shows as a count of past listings (4.8; `fb-scrap-engine/docs/design/SELLER_DATA.md:153-155`) |

## 1. What a copy advert is

**Definition used here.** A copy advert is an advert whose text and asking price are repeated, word for word or nearly, on two or more listing IDs posted in different places (Facebook city pages) within one window. This follows the brief's measurement, "identical long-title, same-price adverts across 2+ city pages" (`fb-scrap-engine/docs/design/SELLER_DATA.md:80-81`), and its product line, "the same title and price in many towns" (`fb-scrap-engine/docs/HANDOFF.md:175-176`). The flag describes the text only. It never says who posted it or which copy came first.

**Kinds the in-scope sources describe or measure.**

| Kind | What the sources say | Measured? | Source |
| --- | --- | --- | --- |
| Mass-posted identical adverts | In the sofa control, 29.1% of listings (357 in 51 clusters) were identical long-title, same-price adverts across 2 or more city pages. HANDOFF rounds this to 29% | Yes. About 37 hours of logged-out data (22 Sep 08:51 to 23 Sep 22:03 UTC), mostly "3090" and "gaming pc" around Chichester plus one sofa control, classified by regex and not checked by hand | `fb-scrap-engine/docs/design/SELLER_DATA.md:5-12,80-81`; `fb-scrap-engine/docs/HANDOFF.md:175-176` |
| Copies posted by several accounts | In all 7 clusters with 2 or more known sellers, each listing came from a different account, compared within the same run | Yes, 7 clusters | `fb-scrap-engine/docs/design/SELLER_DATA.md:82-83` |
| Copies of PC and GPU adverts | "Almost absent": 1 cluster | Yes, same sample | `fb-scrap-engine/docs/design/SELLER_DATA.md:84` |
| Look-alikes (not copies) | On PC and GPU listings, title-and-price matching forms 27 clusters (98 listings). Descriptions separate 15 of them, and seller keys separate 6, of which only 1 is not already separated by description. Nothing separates the other 11 | Yes | `fb-scrap-engine/docs/design/SELLER_DATA.md:69-73` |
| Copies used as a scam signal | "Copy adverts across cities" is one of the listing-level fraud rules, and a photo match "can attach a scam copy to a genuine seller". The owner lists "copies of the same advert across distant places" as a "too good to be true" signal | No measurement of scam copies or re-posted scam templates | `fb-scrap-engine/docs/design/SELLER_DATA.md:182-185,240-241`; `nabvy/docs/decisions.md:155` |
| Trade and template adverts | Copy adverts and stock phrasing are listing signals for trade-seller and flipper labels. The recorded run has one trader's boilerplate inside a headset sale ("We buy and part-exchange consoles, laptops, games…"), with no copy of it in that run | No measurement of how often trade adverts are copied | `fb-scrap-engine/docs/HANDOFF.md:107-110`; `…/dataset.json:3648,3722` |
| "We buy" and "I buy" adverts | Buyer adverts are 0.39% of listings (15 of 3,865). The `wantedTitle` pattern covers "we buy" and "cash for" | Share measured; whether they are mass-posted is not | `fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:219`; `fb-scrap-engine/docs/data/part-patterns.json:5` |
| Keyword-stuffed adverts | 10 descriptions carry keyword stuffing | Count only; whether they are copies is not measured | `fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:242-243` |
| Same-seller relists (not copies; `relist-merge`) | 3 pairs (0.3%) in 37 hours, "too short to measure relisting" | Rate unknown | `fb-scrap-engine/docs/design/SELLER_DATA.md:66-67` |

**What is unknown.** The in-scope files hold no measurement of any of the following:
- the share of copy adverts in hardware at production volume, beyond "1 cluster";
- how many towns a copy cluster spans, or over how many days. "Same advert in 12 towns in 2 days" and "same advert in 5 towns" are example wordings, not measurements (`fb-scrap-engine/docs/HANDOFF.md:99-100,176-177`; `fb-scrap-engine/docs/design/SELLER_DATA.md:100-101`);
- whether copies reuse Facebook photo IDs or image files;
- whether copies vary their price;
- what share of copies are scams;
- copies in Ireland (no Ireland data, `fb-scrap-engine/docs/design/SELLER_DATA.md:9`).

City-page counts are lower bounds of what Facebook holds, but can exceed the number of towns (4.8). A search returns a short local feed (about 90 listings within about 100 km) or a long nationwide one (about 1,300), and newest-first checks stay within about 115 km (`fb-scrap-engine/README.md:125-130`). Busy terms span only days: the full sofa feed covered 19–23 September (`fb-scrap-engine/docs/EVIDENCE_LEDGER.md:124-127`). Nabvy also searches only what users' hunts need (`nabvy/docs/decisions.md:131`). The recorded run holds no copies (section 4.13).

## 2. Why it matters

- **To users: scam risk and noise.**
  - Copies across cities are a fraud signal (`fb-scrap-engine/docs/design/SELLER_DATA.md:182-185`).
  - The owner's "too good to be true" mark uses copies across distant places, and user reports count on a listing's copies too (`nabvy/docs/decisions.md:154-156`).
  - Users can hide likely spam (`fb-scrap-engine/docs/HANDOFF.md:175-177`).
- **To the price data.**
  - Copy adverts are the largest distortion the brief measured: 29.1% of the sofa control, against 1.7% for same-seller weighting (`fb-scrap-engine/docs/design/SELLER_DATA.md:79,95-97`). The brief's rule is to count each cluster once in asking-price bands (`fb-scrap-engine/docs/design/SELLER_DATA.md:95-96`).
  - Without the collapse, ten copies of one advert would make a group of n=10 out of one item, and asking-price position shows only at n≥10 (`nabvy/docs/decisions.md:15`).
  - Duplicates move medians. Collapsing the 2 same-seller relist pairs in priced groups moved one median: PC 4070 (n=26 to 25) from £1,050 to £1,000 (`fb-scrap-engine/docs/design/SELLER_DATA.md:66-68`). One suspect £500 card with no description moves the 5080 median by £50 (`fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:107`).
- **To alerts.**
  - The brief sends one alert per copy cluster (`fb-scrap-engine/docs/design/SELLER_DATA.md:95-96`).
  - Without it, a hunt that covers several towns gets one alert per copy. That works against the alert-precision guardrail (≥50% in beta) and the cost-per-alert guardrail (under £0.05) (`nabvy/docs/decisions.md:236,238`).
- **To the noise filter and demand counts.**
  - Noise and copies are separate questions. A mass-posted "we buy" advert is both a buy-in advert, which `noise-filter` marks whether or not this module runs (`modules.md:700-713`), and a copy.
  - Copy clusters keep one trader's advert, posted in 12 towns, from counting 12 times in demand cells, which count wanted adverts (`fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:273-275`).

## 3. Module boundary

**One job.** Find adverts copied across city pages, publish each cluster's membership and facts internally so readers count and alert once per cluster, and publish a per-listing flag with facts only.

**It does not:**
- say "scam", "trade seller" or "flipper", or apply the "too good to be true" mark. `suspected-labels` combines copy facts with scam signals (`fb-scrap-engine/docs/HANDOFF.md:178-179`; `modules.md:790-803`).
- hide listings. `spec-match` applies the user's "hide likely spam" preference (`modules.md:852-854,867-870`).
- link relists or keep history across listing IDs (`relist-merge`; `nabvy/docs/decisions.md:14`).
- compare seller identities for anything users see (`nabvy/docs/decisions.md:12`).
- fetch anything itself. It calls `detailsQueue.enqueue()` and never touches Apify or Facebook (`nabvy/CLAUDE.md:9`).
- call a model (section 5.5).
- resolve pickup locations. That is the owner's "Where an item really is" feature (`nabvy/docs/decisions.md:144-153`). Copies are placed by the listing's own city page, because the claim is where the advert was posted.

**Inputs.**

| From | What | Hard or soft |
| --- | --- | --- |
| `listing-ingest` | Events `listing-ingest.first-seen` and `listing-ingest.card-changed` (listing IDs). View `v_listings`: listing ID, source listing ID, card hash, title (the card's title wins, `fb-scrap-engine/README.md:272-274`), `price_minor`, currency, `money.kind` and primary photo ID (both added, change 4), city-page ID, `listed_at` (T0), first-fetched time (T1), last-seen time | Hard |
| `detail-evidence` | Event `detail-evidence.changed` (listing IDs). Views `v_current` (evidence hash, `description_status`) and `v_text` (the description) | Hard |
| `city-pages` | `v_city_pages` (town labels, for `towns`; coarse coordinates, for spread); `v_centres` (`reported_lat`/`reported_lng`, the spread fallback for verified centres); `v_area_membership` (`in_area`, for S4) (`modules.md:433-434`) | Hard |
| `account` | Event `account.deleted`; `isActive()` for the report procedure (`modules.md:1346`) | Hard |
| `listing-suppression` | `v_suppressed`; event `listing-suppression.changed` | Hard |
| `details-queue` | `enqueue()` for collision candidates | Hard (with it off, candidates wait) |
| `switches`, `audit-log` | `state()` and `is_on()`; `record()` for corrections | Hard |
| `seller-key` | `seller_key.restricted_listing_keys`, for the "spans accounts" check only | Soft; off until the owner decides (`modules.md:2248`) |
| `photo-review` | `v_photo_hashes` (sha256 of captured photos) | Soft; waits for actor photo capture (`nabvy/docs/questions.md:15`) |
| `review-console`, `seller-rights`, oRPC procedures | Calls: `applyCorrection()`, `erase()`, `report()` | Callers |

**Outputs.**

| Kind | Name | Readers |
| --- | --- | --- |
| Event | `copy-advert.clustered`, carrying listing IDs whose membership or facts changed | `asking-price-index`, `alert-router`, `spec-match`, `suspected-labels`, `demand-signals` (soft) |
| Internal views | `v_members`, `v_cluster_facts`, `v_listing_copy_facts`, `v_links`, `v_review_queue`, `v_shadow_metrics` | Section 7; developers |
| Restricted view | `copy_advert.restricted_accounts` (whether a cluster spans accounts, within one run). Not `v_`-named and never granted to `nabvy_app` (`nabvy/packages/db/README.md:191-192`) | The developers' read-all role only (`modules.md:47`). `v_shadow_metrics` carries no account data. Adding `ops-metrics` as a reader is owner question 38 (`modules.md:64,2277`) |
| User-facing view | `app.v_copy_advert_flags` (listing ID, towns, span in days, window, rule version) | `nabvy_app`, `notifier`, `spec-match` |
| Functions | `erase(listingIds)`, `applyCorrection(correction)`, `report(userId, input)` | `seller-rights`, `review-console`, procedures |

**When it is off.** Every reader carries on and reads a missing row as "no data", never as "no" (`nabvy/docs/decisions.md:65`; `modules.md:104`).

| Reader | Behaviour with `copy-advert` off |
| --- | --- |
| `asking-price-index` | Counts each listing on its own. More groups reach n≥10, so positions can rest on duplicates. Proposed: the index records "copy collapse unavailable" with each stats row, internally |
| `asking-price-position` | Unchanged logic, on the uncollapsed index |
| `alert-router` | One alert per listing. Dedupe per user and listing, and relist merging, still apply |
| `spec-match` | The "hide likely spam" preference has no effect: every listing shows |
| `notifier` and the listing card | No copy flag on cards |
| `suspected-labels`, including "too good to be true" | Loses the "copies across distant places" signal. A user report counts only on the listing it was made on |
| `demand-signals` | Counts each wanted advert on its own |
| `details-queue` | Receives no candidate requests |
| `review-console` | No copy clusters to check |
| `seller-rights` | `erase()` still runs while the module is off, because erasure is a right. It writes deletions only |
| `output-guard` | Still checks the view, which returns no rows |

## 4. Detection method, cheapest first

### 4.1 Eligibility

- **Listings.** Facebook listings only in v1. Cross-source links are `cross-post-links`, after the MVP (`modules.md:1190-1192`).
- **Prices.** A fixed asking price above zero, with its currency. £0, free, unknown and ambiguous money kinds never form a price fingerprint (`fb-scrap-engine/docs/EVIDENCE_LEDGER.md:194-195`; `nabvy/packages/contracts/README.md:125-127`).
- **Description evidence.** Only a `full_verified` description counts. `partial` text may be only an SEO teaser, which held only about the first 200 characters in local, unconfirmed samples, and `missing` means none was captured, so neither can confirm or refute a copy (`fb-scrap-engine/README.md:233-241`; `fb-scrap-engine/docs/EVIDENCE_LEDGER.md:184-186`).

### 4.2 Normalisation, rule version `copy-advert@1`

Normalisation applies to a working copy. Stored text never changes (`nabvy/docs/decisions.md:30`). Titles and descriptions follow the same steps, in this order:

1. **Unicode NFKC.**
2. **Plus decoding.** If the text contains "+" and no whitespace, read each "+" as a space. The recorded title "MSI+AlphaSync+GTX+1660,+Ryzen+7+2700X+Gaming+PC" arrives this way (`…/dataset.json:466`), and "+" is legitimate elsewhere ("Gaming PC + Monitor + KBM").
3. **Contact masking.** Replace URLs, emails and UK mobile numbers with the tokens `url`, `email` and `phone`: emails and UK mobile numbers with the detectors at `nabvy/services/source-adapters/test/fixtures/adapter.facebook-run.fixtures.ts:114-115`; URLs with `quote-redaction`'s link detector (`modules.md:354`).
   - Copies that differ only in a phone number stay copies.
   - A contact detail, which identifies a seller, never becomes a matching key.
4. **Case folding.**
5. **Separators.** Every character that is not a letter or a digit becomes a space: punctuation, emoji, currency signs, pipes and dashes. Digits stay, because model numbers separate look-alikes (for example "RTX 3070" and "RTX 3080").
6. **Whitespace.** Runs of whitespace collapse to one space, and the ends are trimmed. This also absorbs the trailing-whitespace difference seen between two copies of one description in a row (`…/dataset.json:3722,3745`).

The rule version is part of every key (section 4.11). Changing a step bumps it.

### 4.3 Fingerprints per listing version

| Fingerprint | Built from | When it exists |
| --- | --- | --- |
| `advert_fp` | sha256(normalised title \| `price_minor` \| currency) | Fixed price above zero |
| `desc_fp` | sha256(normalised description) | Every `full_verified` description, at any length |
| `desc_norm` | The normalised description, kept for the trigram index | `full_verified` and at least `descMinChars` normalised characters |
| `photo_id` | The card's primary photo ID (`primary_listing_photo.id`) | On 20 of 20 recorded rows (computed; for example `…/dataset.json:397-402`) |

### 4.4 Stages

Every stage runs set-based SQL over one batch (section 4.11).

| # | Stage | What it does | Cost |
| --- | --- | --- | --- |
| S1 | Normalise and fingerprint | Pure TypeScript domain function, then an upsert into `prints` | Database only |
| S2 | Group by `advert_fp` | Other current prints with the same `advert_fp`, last seen inside the window | B-tree index lookup |
| S3 | Confirm by description | For each pair in an S2 group where both sides have `desc_fp`: an equal `desc_fp` is `exact_text` at any length. When either description is shorter than `descMinChars`, it counts only if the normalised title has at least `titleMinChars` characters; otherwise the pair is a `lookalike`. Different descriptions where either is shorter than `descMinChars` make the pair a `lookalike`. Otherwise a pg_trgm similarity of at least `nearText` is `near_text`, and anything less is a `lookalike`. A `lookalike` is split. This is the brief's lesson that title and price alone merge look-alikes (`fb-scrap-engine/docs/design/SELLER_DATA.md:69-73`) | Trigram comparison inside small groups |
| S4 | Candidates | A pair in an S2 group where one side lacks `full_verified` text is a `candidate`. When the normalised title has at least `titleMinChars` characters, the brief's "long title" (`fb-scrap-engine/docs/design/SELLER_DATA.md:80-81`), and at least one member was returned for an active hunt's area (`in_area` in `city-pages`' `v_area_membership`, `modules.md:434`), the undescribed side goes to `detailsQueue.enqueue()` at the lowest priority, within `candidateDailyCap`. Descriptions are fetched "for collision candidates only" (`fb-scrap-engine/docs/design/SELLER_DATA.md:156-157`). A candidate is never collapsed or flagged | $0.00092 per fetch on the `graphql` route, about $0.00166 on the `page` route (`fb-scrap-engine/docs/HANDOFF.md:148-150`) |
| S5 | Text copies (internal) | A pair with different `advert_fp`, meaning a different title or price, but the same `desc_fp` with both descriptions at least `descMinChars` long, or trigram similarity of at least `textCopy` with both descriptions at least `textCopyMinChars` long. This is the re-posted-template path. It is internal evidence only in v1: never collapsed, never flagged, published for `suspected-labels` in shadow. No in-scope file measures templates (section 1) | GIN trigram index lookup inside the window |
| S6 | Photo-ID evidence | The same primary photo ID on two different listing IDs is recorded in `photo_matches` (5.1), and on the link as `photo_id_match` when a text link exists. It is never the only basis for a link: a photo match "can attach a scam copy to a genuine seller" (`fb-scrap-engine/docs/design/SELLER_DATA.md:240-241`) | Index lookup |
| S7 | Account check (restricted, soft) | With `seller-key` on: for each confirmed cluster, whether members seen in the same run carry different keys. Tokens are comparable only within one run (`fb-scrap-engine/docs/design/SELLER_DATA.md:48-54,106-107`) | Restricted join |
| S8 | Cluster | Connected components over `exact_text` and `near_text` links, with `overrides` applied (section 6) | Recursive CTE (4.8) |
| S9 | Facts and flags | Per cluster, then per listing (4.8, section 6) | SQL |

### 4.5 Near-duplicate technique: pg_trgm, not MinHash

| | pg_trgm similarity (chosen) | MinHash over word shingles |
| --- | --- | --- |
| Runs in | Postgres. The extension is already installed on `fbapfy` (`nabvy/docs/progress.md:9`; `nabvy/packages/db/README.md:198-199`) | New code or a new library for signatures and banding (`nabvy/CLAUDE.md:17`) |
| Index | GIN `gin_trgm_ops` on `desc_norm`, queried with `%` after `select set_config('pg_trgm.similarity_threshold', <threshold>, true)` (a `SET LOCAL`) inside the batch transaction. Each hit is rechecked with `similarity() >= <threshold>`. No session state stays on a pooled connection (`nabvy/packages/db/README.md:161`; `nabvy/docs/engineering.md:27`) | A band table and custom candidate SQL |
| Explainable | One number per pair, reproducible in a SQL test | Estimates Jaccard; depends on hash seeds and band settings |
| Scale | Enough for Nabvy's volume: the $150 monthly cap (`nabvy/docs/decisions.md:138`) at about $0.0015–0.0025 per new listing including AI (est.; `fb-scrap-engine/docs/HANDOFF.md:232-233`) buys at most about 60,000–100,000 new listings a month, even if the whole cap went on them (calc.) | Built for much larger corpora |
| Weakness | A set measure: word order is ignored, and a copy with a long added paragraph scores lower | More moving parts, and tuning with no data yet |

pg_trgm fits "rules and SQL first" (`nabvy/README.md:12`) and needs no dependency. Section 8's load test checks the cost of the lookup. MinHash stays an option if a load test ever shows the trigram lookup too slow.

### 4.6 Photo reuse: what the actor returns

| Field | Present | Usable for copies? | Source |
| --- | --- | --- | --- |
| Card primary photo ID (`sourceFields.search.primary_listing_photo.id`) | 20 of 20 recorded rows (computed) | Yes, as S6 evidence. Whether copies share photo IDs is unmeasured, and all 20 recorded IDs are distinct (computed) | `…/dataset.json:397-402` |
| Gallery photo IDs (`photos[].id`), `photoGalleryTotal`, `photoGalleryComplete` | 1 of 20; `graphql` detail replies carry no gallery | Only for page-route rows. Gallery counts are not evidence of reuse | `…/dataset.json:14-48`; `fb-scrap-engine/.actor/input_schema.json:119,126-127`; `fb-scrap-engine/README.md:255-258` |
| Image URLs and their file names | Every row. Photo ID 1393542966276599 appears under two different URLs in one row (gallery and search card), so URL equality is not photo identity | Not yet. The committed fixture hashes every media URL (`…/README.md:32-34`), so whether file names are stable cannot be checked from it. The raw rows keep the real URLs in the gateway's store (`nabvy/supabase/README.md:58-60`). Links are signed, expire 104–108 hours after collection, and Nabvy never fetches them | `…/dataset.json:16-18,398-400`; `fb-scrap-engine/docs/EVIDENCE_LEDGER.md:288-289`; `nabvy/docs/decisions.md:23` |
| Photo bytes and sha256 | None today. The input schema has no photo-capture option; photo capture is a proposed actor change | Later, through `photo-review`'s `v_photo_hashes`, and only for text-silent containers | `fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:97-107,132-135`; `nabvy/docs/questions.md:15` |

The photo ID is keyed as the brief advises ("key photos on Facebook's gallery photo `id`, not only sha256", `fb-scrap-engine/docs/design/SCALE_PLAN.md:22`).

### 4.7 The internal seller key

It has one role in this module: the restricted "spans several accounts" check (S7), which confirms internally, within one run, that a cluster spans accounts (`fb-scrap-engine/docs/design/SELLER_DATA.md:106-107`). It never blocks a copy link, because copies typically span accounts (all 7 measured clusters, `fb-scrap-engine/docs/design/SELLER_DATA.md:82-83`). It never feeds the user flag (`nabvy/docs/decisions.md:12`; `fb-scrap-engine/docs/design/SELLER_DATA.md:289-290`). Its coverage is about 7.5% for a listing seen once (`fb-scrap-engine/docs/design/SELLER_DATA.md:42-47`). Off until the owner builds `seller-key` (`modules.md:2248`).

### 4.8 Clusters, window and facts

- **Window.** 30 days: a listing is an active member while it was last seen within 30 days. It is the asking-price index's window (`fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:262-263`), so "count once" covers the same span the bands do. A daily scheduled task, `copy-advert-expire`, drops members past the window and recomputes their clusters.
- **Components.** A recursive CTE over confirmed links. The platform uses shallow graphs by recursive CTE and revisits only past three hops or 500 ms p95 (`nabvy/docs/decisions.md:207`). Exact-text members share one `desc_fp`, so they join as one group without pairwise links, and only near-text links add hops.
- **Cluster key.** Deterministic: sha256(rule version | the source listing ID of the member with the earliest `listed_at`). Each cluster also has a version, `member_set_hash`, which is sha256 of its sorted member keys. A replay therefore produces the same key and version.
- **Facts per cluster** (computed over active, unsuppressed, confirmed members):

| Fact | How it is computed |
| --- | --- |
| `listing_count` | Active members |
| `town_count` | Distinct city pages. It stays internal and drives `mass_posted`. City-page IDs, not the card's location string, because "Hove" is the page "Brighton and Hove" (`fb-scrap-engine/docs/EVIDENCE_LEDGER.md:48-49`) |
| `span_days` | Latest `listed_at` minus earliest, rounded up to whole days. Internal. `listedAt` is exact Unix seconds (`fb-scrap-engine/docs/EVIDENCE_LEDGER.md:174-175`) |
| `spread_km` | The greatest straight-line distance between member city pages. It uses `v_city_pages` coordinates and falls back to `v_centres.reported_lat`/`reported_lng` for verified centres (`modules.md:430,433`). It is unknown only when neither exists. 136 of the 771 seed entries, including all 5 verified centres, have no seed coordinates (computed from `fb-scrap-engine/docs/data/city-pages.seed.json`), among them Chichester, the rtx3090 test hunt's centre (`fb-scrap-engine/docs/data/city-pages.seed.json:1593-1599`; `nabvy/docs/decisions.md:136`) |
| `mass_posted` | True when `town_count` is 2 or more, the brief's measurement definition (`fb-scrap-engine/docs/design/SELLER_DATA.md:80-81`) |

- **Towns.** The user-facing `towns` counts distinct towns by their town labels (the `towns` field in `city-pages`), not city pages, and `flagMinTowns` applies to it.
  - Many city pages belong to one town. Computed from the seed: 258 of the 771 city pages share a town label with another page, for example 13 pages labelled "Southampton" and 11 labelled "Manchester". "Abberley, Worcestershire" is labelled "Worcester" (`fb-scrap-engine/docs/data/city-pages.seed.json:7-9`). Inaccurate labels breach the accuracy principle (`fb-scrap-engine/docs/design/SELLER_DATA.md:266`).
  - So two city pages count as one town when they share any label. A page with several labels (19 of 771, computed) counts as one town, so the count never overstates.
- **User-facing facts, per flagged listing.** They are computed from members in towns other than the listing's own.
  - `towns` = 1 + the number of those other towns.
  - `span_days` = the spread of `listed_at` over the listing itself and the earliest member in each other town, rounded up to whole days.
  - Members in the listing's own city page, or in another page of the same town, never enter a user-facing fact. A same-town relist therefore adds no town and no days, and users never see a count of past listings (`fb-scrap-engine/docs/design/SELLER_DATA.md:153-155`).
  - `other_listings` (the listing's fellow members) stays internal, in `v_listing_copy_facts`.

### 4.9 Same-seller relists and copies across sellers

The module never decides who posted what.
- **Same town.** A relist is usually one item re-posted in the same town. With matching text it joins the same cluster, but it adds no town and no days to any user-facing fact (4.8), so it never raises `towns` towards a flag. Merging it is `relist-merge`'s job (a matching description or photo within the same city page and 7 days; `fb-scrap-engine/docs/design/SELLER_DATA.md:147-152`).
- **Counting.** When both modules group the same listings, readers count them once either way.
- **Other towns.** Copies across towns are what this module flags.
- **Never shown.** Users never see "relisted", "seen before" or "same seller" (`fb-scrap-engine/docs/design/SELLER_DATA.md:337`).

### 4.10 GBP and EUR

- **Keys.** Currency is inside `advert_fp`, so a GBP and a EUR advert never form a confirmed cluster, and prices are never converted (`nabvy/docs/decisions.md:19`; `nabvy/packages/contracts/README.md:31`).
- **Text copies.** S5 evidence across currencies stays internal.
- **Beta.** The beta is UK only, so no EUR rows are expected (`nabvy/docs/decisions.md:19,132`). Irish groups stay separate when Ireland returns (`fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:287-288`).

### 4.11 Batches, idempotency and stamps

- **Batches.** Handlers take arrays of 100–500 listing IDs (`nabvy/CLAUDE.md:24`). One batch runs S1–S9 in one `withPipeline` transaction (`nabvy/packages/db/README.md:164`).
  - Candidate lookup uses one lateral join per new print, with a `LIMIT`.
  - Before S2 and S5, a batch takes `pg_advisory_xact_lock` on a hash of every `advert_fp` and `desc_fp` it touches, in sorted order. Batches that share a fingerprint then run one after the other, so each sees the other's committed prints. Nothing else serialises batches: Trigger.dev queues are per provider (`nabvy/docs/engineering.md:44`). The lock is transaction-scoped, so it is safe on the transaction pooler (`nabvy/packages/db/README.md:161`).
  - Only clusters touched by the batch are recomputed.
  - `copy-advert.clustered` is emitted in chunks of at most 500 IDs.
- **Keys.**
  - `prints` is unique on (source, source listing ID, card hash, evidence hash, rule version). `contentHash` for the key `source + sourceListingId + contentHash` (`nabvy/CLAUDE.md:25`) is sha256(card hash | evidence hash). This is `modules.md` rule 8's "listing's own hashes plus the version of the shared input read" (`modules.md:68-77`).
  - Links are unique on (listing A, listing B, rule version) with A < B.
  - Clusters are unique on cluster key; members on (cluster key, listing).
  - The event key is `batchKey('copy-advert.clustered', …)` over `listingKey()`s whose content hash is `clusterKey@memberSetHash` (`nabvy/packages/contracts/src/core/events.ts:198-217`).
  - A replayed event finds every row present and emits nothing new.
- **Stamps.** The module is outside the T0–T7 chain. It stores the T1 of each input (`input_t1`) and its own `done_at`, so its lag is measurable (`modules.md:94`). Emitted events carry no stamps beyond the envelope time.

### 4.12 Thresholds

All thresholds live in `services/copy-advert/src/domain/rules.ts` as rule version `copy-advert@1`. They are validated by `CopyAdvertRuleConfig` and each is commented with its basis. Changing a value bumps the rule version.

| Name | Value | Basis | Status |
| --- | --- | --- | --- |
| `titleMinChars` (S3 short descriptions; S4 detail requests) | 20 normalised characters | The brief used "long" titles without a length (`fb-scrap-engine/docs/design/SELLER_DATA.md:80-81`). Generic recorded titles are 9–17 characters ("gaming pc" three times, "gaming pc bundle", "hp omen gaming pc"; computed) | Starting value |
| `descMinChars` | 100 normalised characters | The recorded range is 55–1,057 normalised characters, median 309 (computed). The cut is an assumption, not measured | Starting value |
| `nearText` (S3) | pg_trgm similarity ≥ 0.80 | The highest similarity between two different recorded listings is 0.374 (rows 5 and 10). The three listings titled "gaming pc" score 0.112–0.231 against each other (computed) | Starting value; calibrated in 1.7b |
| `textCopy` and `textCopyMinChars` (S5) | ≥ 0.90 and ≥ 200 characters on both sides | Stricter than `nearText` because title or price disagree. No in-scope measurement | Starting value; internal evidence only |
| `windowDays` | 30 | The index window (`fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:262-263`) | Starting value |
| `massPostedMinTowns` | 2 distinct city pages | The brief's measurement definition (`fb-scrap-engine/docs/design/SELLER_DATA.md:80-81`) | From the brief |
| `flagMinTowns` (user display, on the user-facing `towns`, 4.8) | Owner decision. Proposal: 5 | Example wordings only: "same advert in 5 towns" and "12 towns in 2 days" (`fb-scrap-engine/docs/HANDOFF.md:99-100,176-177`) | Owner decision (Q3) |
| `candidateDailyCap` | 200 detail requests a day | One details batch holds at most about 200 IDs (`fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:68,108-109`). At $0.00092 each on the `graphql` route, or about $0.00166 on the `page` route (`fb-scrap-engine/docs/HANDOFF.md:148-150`), that is at most about $0.18–0.33 a day, $5.5–10 a month (calc.), within the $150 cap (`nabvy/docs/decisions.md:138`) | Starting value |
| Candidate queue priority | After sweep follow-ups (lowest) | The brief's four priorities do not list copy candidates (`fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:194-196`) | Starting value |

### 4.13 Baseline on the recorded run

Computed with `copy-baseline.py` over the 20 recorded listings (190 pairs). The run was newest-first page 1 for "gaming pc" around Chichester (`…/README.md:6-11`).

| Measure | Result |
| --- | --- |
| Identical normalised titles | "gaming pc" on rows 7, 9 and 19 (`…/dataset.json:2163,2916,6358`), which ask £2,500, £800 and £600 in three different city pages |
| Identical title, price and currency | None |
| Identical normalised descriptions | None |
| Highest description trigram similarity between different listings | 0.374 (rows 5 and 10) |
| Highest 5-word-shingle Jaccard | 0.004 |
| Repeated primary photo IDs | None |

Expected output of `copy-advert@1`: no links, no clusters, no candidates, no flags. That is the first negative fixture.

## 5. Data model

### 5.1 Tables (schema `copy_advert`)

Every table follows the foundation's conventions (`nabvy/packages/db/README.md:47-67,194-199`):
- `id` from `idColumn()` and `created_at`/`updated_at` from `timestampColumns()`, left out of the sketch;
- money as `price_minor bigint` plus a checked currency;
- no foreign key into another module's schema. Other modules' IDs are plain values (`modules.md:31`).

```sql
create table copy_advert.prints (             -- one row per listing version fingerprinted
  listing_id uuid not null,                    -- listing-ingest's listing ID
  source text not null,
  source_listing_id text not null,             -- digits as text (17-digit IDs exceed JS integers)
  card_hash text not null,
  evidence_hash text not null default '',      -- '' until details exist
  rule_version text not null,
  title_norm text not null,
  price_minor bigint,
  currency text check (currency in ('GBP','EUR')),
  advert_fp text,                              -- null unless a fixed price above zero
  desc_status text check (desc_status in ('full_verified','partial','missing')),
  desc_norm text,                              -- only when full_verified and long enough
  desc_fp text,
  photo_id text,
  city_page_id text,
  listed_at timestamptz,
  last_seen_at timestamptz not null,
  input_t1 timestamptz,
  done_at timestamptz not null,
  current boolean not null default true,
  unique (source, source_listing_id, card_hash, evidence_hash, rule_version)
);
create index prints_advert on copy_advert.prints (advert_fp, last_seen_at) where current;
create index prints_desc on copy_advert.prints (desc_fp) where current;
create index prints_photo on copy_advert.prints (photo_id) where current;
create index prints_trgm on copy_advert.prints using gin (desc_norm extensions.gin_trgm_ops)
  where current and desc_norm is not null;

create table copy_advert.links (
  listing_a uuid not null, listing_b uuid not null,  -- listing_a < listing_b
  basis text not null check (basis in
    ('exact_text','near_text','candidate','lookalike','text_copy')),
  similarity real,                             -- internal only
  photo_id_match boolean not null default false,
  rule_version text not null,
  decided_at timestamptz not null,
  primary key (listing_a, listing_b, rule_version)
);

create table copy_advert.photo_matches (       -- internal only; photo-ID evidence with or without a text link
  listing_a uuid not null, listing_b uuid not null,  -- listing_a < listing_b
  photo_id text not null,
  rule_version text not null,
  found_at timestamptz not null,
  primary key (listing_a, listing_b, rule_version)
);                                             -- feeds v_shadow_metrics; sets links.photo_id_match when a text link exists

create table copy_advert.clusters (
  cluster_key text primary key, rule_version text not null, member_set_hash text not null,
  price_minor bigint, currency text check (currency in ('GBP','EUR')),
  listing_count int not null, town_count int not null, span_days int not null,
  spread_km int, mass_posted boolean not null,
  status text not null check (status in ('active','expired')), as_of timestamptz not null
);

create table copy_advert.members (
  cluster_key text not null, listing_id uuid not null, source_listing_id text not null,
  city_page_id text, basis text not null, joined_at timestamptz not null, left_at timestamptz,
  primary key (cluster_key, listing_id)
);
create unique index members_one_active on copy_advert.members (listing_id) where left_at is null;

create table copy_advert.flags (                -- one per listing in a mass-posted cluster
  listing_id uuid primary key, cluster_key text not null,   -- cluster_key never leaves internal views
  towns int not null, span_days int not null,  -- per listing, own town left out (4.8)
  would_show boolean not null,                 -- towns >= flagMinTowns
  corrected text check (corrected in ('unflagged')),
  rule_version text not null, member_set_hash text not null
);

create table copy_advert.candidate_requests (
  listing_id uuid primary key, advert_fp text not null, requested_at timestamptz not null,
  resolved_at timestamptz, outcome text
);

create table copy_advert.overrides (           -- corrections the clustering must respect
  id uuid primary key, kind text not null check (kind in ('not_copy_pair','exclude_listing','confirm_pair')),
  listing_a uuid, listing_b uuid, reason text not null, audit_id uuid not null, at timestamptz not null
);

create table copy_advert.reports (             -- user rows: enable_user_rls
  id uuid primary key, user_id uuid not null, listing_id uuid not null,
  reason text not null check (reason in ('not_a_copy','other')),
  status text not null check (status in ('open','accepted','rejected')), at timestamptz not null
);

create table copy_advert.account_checks (      -- restricted; only with seller-key on
  cluster_key text not null, run_id text not null, spans_accounts boolean not null,
  checked_at timestamptz not null, primary key (cluster_key, run_id)
);
```

**Grants.**
- Pipeline tables: `allow_pipeline` with matching grants, written only by the module's code.
- `reports`: `enable_user_rls`, plus a pipeline select policy (`nabvy/packages/db/README.md:97-120`).
- `flags`: column-level `SELECT` for `nabvy_app` on `listing_id`, `towns`, `span_days` and `rule_version`, plus one RLS policy `for select to nabvy_app using (would_show and corrected is null and switches.state('copy-advert') = 'on' and switches.is_on('listing-suppression') and not listing_suppression.is_suppressed(listing_id))`.
  - `switches.state`, `switches.is_on` and `listing_suppression.is_suppressed(uuid)` are SECURITY DEFINER SQL functions owned by their modules, with `EXECUTE` granted to `nabvy_app`.
  - `nabvy_app` gets no grant on either module's tables or internal views.
  - Why: the view is `security_invoker` (`nabvy/packages/db/README.md:180-182`), and `allow_pipeline` switches RLS on (`nabvy/packages/db/migrations/core/20260924090000_core_foundation.sql:124-135`), so a grant with no policy returns nothing (`nabvy/packages/db/README.md:117-120`). The policy carries the view's filters, so a direct read of the table never shows shadow, corrected or suppressed rows.
  - The db test reads `copy_advert.flags` directly as `nabvy_app` and expects the same rows as the view.
- `account_checks` and `restricted_accounts`: the developers' read-all role only; never `nabvy_app` (5.2).

### 5.2 Views

| View | Class | Columns |
| --- | --- | --- |
| `copy_advert.v_members` | Internal | `cluster_key`, `listing_id`, `source_listing_id`, `city_page_id`, `basis`, `joined_at`, `member_set_hash`. Active, confirmed members only |
| `copy_advert.v_cluster_facts` | Internal | `cluster_key`, `listing_count`, `town_count`, `span_days`, `spread_km`, `price_minor`, `currency`, `mass_posted`, `rule_version`, `as_of` |
| `copy_advert.v_listing_copy_facts` | Internal | `listing_id`, `cluster_key`, `other_listings` (internal only), `towns`, `span_days` (the per-listing facts of 4.8), `spread_km`, `mass_posted`, `would_show`, `rule_version`, plus `text_copy_count` from S5 |
| `copy_advert.v_links` | Internal (developers, review) | `listing_a`, `listing_b`, `basis`, `similarity`, `photo_id_match`, `decided_at` |
| `copy_advert.v_review_queue` | Internal | Clusters formed or changed since their last hand check |
| `copy_advert.v_shadow_metrics` | Internal | Per day: clusters, members, candidates requested and resolved, would-show flags, look-alike splits, photo-ID matches (from `photo_matches`), reports. No account data |
| `copy_advert.restricted_accounts` | Restricted. Not `v_`-named and never granted to `nabvy_app` (`nabvy/packages/db/README.md:191-192`); the developers' read-all role only | `cluster_key`, `run_id`, `spans_accounts`, `checked_at` |
| `app.v_copy_advert_flags` | User-facing | `listing_id`, `towns`, `span_days`, `window_days`, `rule_version` |

Rules for the user-facing view:
- Every view is `security_invoker` with an explicit column list, and passes `nabvy_core.view_violations()` (`nabvy/packages/db/README.md:174-192`).
- `app.v_copy_advert_flags` returns rows only when all of these hold, and the RLS policy on `flags` (5.1) enforces the same:
  - `switches.state('copy-advert') = 'on'`;
  - `would_show` is true and `corrected` is null;
  - the listing is not suppressed, checked with `listing_suppression.is_suppressed(listing_id)`, because `nabvy_app` has no grant on `v_suppressed`;
  - `switches.is_on('listing-suppression')` (`modules.md:48,104-106`).
- The core migration creates no `app` schema yet (`nabvy/packages/db/migrations/core/20260924090000_core_foundation.sql:6,11`), so creating it is a coordinator task (9, dependencies).

### 5.3 Contracts (`packages/contracts/src/modules/copy-advert.ts`)

```ts
import { z } from 'zod'
import { defineEvents, Uuid } from '../index'

export const module = 'copy-advert'

export const CopyAdvertRuleVersion = z.string().regex(/^copy-advert@\d+$/)
export const CopyAdvertBasis = z.enum(['exact_text', 'near_text', 'candidate', 'lookalike', 'text_copy'])

export const CopyAdvertRuleConfig = z.strictObject({
  titleMinChars: z.int().min(1), descMinChars: z.int().min(1),
  nearText: z.number().gt(0).lte(1), textCopy: z.number().gt(0).lte(1), textCopyMinChars: z.int().min(1),
  windowDays: z.int().min(1), massPostedMinTowns: z.int().min(2), flagMinTowns: z.int().min(2),
  candidateDailyCap: z.int().min(0),
})

/** User-facing: facts only. No cluster key, no other listing or count of them, nothing about accounts. */
export const CopyAdvertFlag = z.strictObject({
  listingId: Uuid, towns: z.int().min(2),
  spanDays: z.int().min(0), windowDays: z.int().min(1), ruleVersion: CopyAdvertRuleVersion,
})

export const CopyAdvertReportInput = z.strictObject({
  listingId: Uuid, reason: z.enum(['not_a_copy', 'other']),
})

export const CopyAdvertCorrection = z.strictObject({
  action: z.enum(['not_copy_pair', 'exclude_listing', 'confirm_pair']),
  listingA: Uuid, listingB: Uuid.optional(), reason: z.string().min(1).max(500),
})

export const events = defineEvents(module, {
  'copy-advert.clustered': {
    1: z.object({ listingIds: z.array(Uuid).min(1).max(500), ruleVersion: CopyAdvertRuleVersion }),
  },
})

export const errorCodes = ['copy-advert.unknown_listing', 'copy-advert.invalid_correction'] as const
```

- **Types.** Each is derived with `z.infer`, never typed twice (`nabvy/packages/contracts/README.md:58-66`).
- **View row types.** They are derived with `drizzle-zod` in `packages/db/src/schema/copy-advert.ts`, beside the `vMembers`, `vClusterFacts` and `vListingCopyFacts` view definitions: `vMembersRow` (the catalogue draft's `CopyAdvertMember`, now renamed in `modules.md`), `vClusterFactsRow` (formerly `CopyAdvertCluster`) and `vListingCopyFactsRow` (the per-listing facts). Readers import them from `@nabvy/db/schema/copy-advert`. The names start with `v` because the conventions test lets another module import only `v`-prefixed names from a schema file (`nabvy/packages/db/test/conventions.test.ts:74`; `nabvy/packages/db/README.md:39-42`). `drizzle-zod` is added to `@nabvy/db` (Apache 2.0; `nabvy/docs/questions.md:23`), and the pull request justifies it (`nabvy/CLAUDE.md:17`). The contract file holds only boundary schemas and never imports `@nabvy/db`, which already depends on `@nabvy/contracts` (`nabvy/packages/db/package.json:19-21`; `nabvy/packages/contracts/README.md:4-6`); an import the other way would make a workspace cycle.
- **Event type.** `CopyAdvertClusteredEvent` is the envelope type of `copy-advert.clustered`, derived from the registry with `EventOf` (`nabvy/packages/contracts/src/core/events.ts:65-73`).
- **Report reasons.** No free text is shown to anyone. Sellers use `seller-rights`, not this form (Q8).

### 5.4 Events

| Direction | Event | Payload | Notes |
| --- | --- | --- | --- |
| In | `listing-ingest.first-seen` | listing IDs | S1–S9 for new cards |
| In | `listing-ingest.card-changed` | listing IDs | A title or price change makes a new print and may leave a cluster |
| In | `detail-evidence.changed` | listing IDs | New `desc_fp`; resolves candidates |
| In | `listing-suppression.changed` | entry IDs | Recomputes shown counts |
| In | `account.deleted` | user IDs | Deletes that user's `reports` rows within 24 hours (`modules.md:108`; `nabvy/docs/security.md:11`) |
| In | Scheduled `copy-advert-expire`, daily | none | Window expiry |
| Out | `copy-advert.clustered` | `listingIds` (1–500), `ruleVersion` | Only listings whose membership or facts changed |

Transport: Trigger.dev tasks named after the event, with task files kept thin (`nabvy/docs/engineering.md:42`; `nabvy/CLAUDE.md:61`; `nabvy/docs/decisions.md:189`). Retries follow the platform: 3 attempts, then `incidents` (`nabvy/docs/engineering.md:45`).

### 5.5 Cost per 1,000 listings

| Item | Per 1,000 listings | Basis |
| --- | --- | --- |
| Normalise, hash, look up, cluster | No per-call charge. It runs on the one Supabase database | `nabvy/docs/decisions.md:207`. Load measured in 1.7a |
| Candidate detail fetches | $0 to $0.92 on the `graphql` route, or up to $1.66 on the `page` route (calc.). About $0.27 on `graphql` if 29.1% of listings sat in copy groups and none had details yet | $0.00092 per `graphql` detail, about $0.00166 per `page` detail (`fb-scrap-engine/docs/HANDOFF.md:148-150`); the sofa share (`fb-scrap-engine/docs/design/SELLER_DATA.md:80-81`); calc. For hardware it is near $0: every new in-area listing is already detailed (`fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:164-166`), copies are "almost absent" (`fb-scrap-engine/docs/design/SELLER_DATA.md:84`), and the brief costs its 98 PC and GPU collision candidates at about $0.09 (`fb-scrap-engine/docs/design/SELLER_DATA.md:156-157`). Capped at about $5.5–10 a month by `candidateDailyCap` (calc.) |
| AI | $0 | No model call |
| Storage | About 0.3 MB of normalised text, plus the trigram index (size measured in the dry-run) | Median 309 characters per description (computed); calc. |

**No AI.** Exact hashes and trigram similarity decide copies deterministically, and the evidence users see is a count of towns, which a model would not improve. A per-pair model call would also scale with pairs, not listings, against "AI at most once per listing" (`nabvy/docs/decisions.md:21,42`). If look-alikes that nothing separates (11 of 27, `fb-scrap-engine/docs/design/SELLER_DATA.md:73`) prove common in Nabvy's data, the fix is a sharper text rule, not a model.

## 6. Outputs to people

**Developers see everything** (`nabvy/docs/decisions.md:30`):
- clusters, members, links with their basis and similarity, candidates, look-alike splits and shadow metrics, through the internal views;
- the account check, through the restricted view.

Developer reads of restricted views are logged with a reason (`modules.md:2249`).

**Users see one flag, only as allowed.**
- The view carries facts only: towns, days and the window, computed per listing without its own town (4.8).
- The wording is the owner's (`nabvy/CLAUDE.md:30`). Proposals:
  - **A, the brief's wording** (`fb-scrap-engine/docs/HANDOFF.md:175-177`; `fb-scrap-engine/docs/design/SELLER_DATA.md:100-101`): "Likely spam: same advert in 12 towns in 2 days."
  - **B, Nabvy's label format** ("Suspected …:" followed by the facts; `nabvy/docs/fb-actor-sources.md:58-59`; `nabvy/docs/decisions.md:13`): "Suspected copy advert: the same advert and price appear in at least 12 towns, posted over 2 days (last 30 days)."
  - Either way the counts say "at least", because Nabvy sees only what hunts search (section 1).
- Beside the flag:
  - "Hide adverts like this", the user's preference, which `spec-match` applies (`modules.md:852-854`);
  - "Report a mistake", which calls `report()`.
- Escalation to "Suspected scam: …" belongs to `suspected-labels` and needs a scam signal besides the copy facts (`fb-scrap-engine/docs/HANDOFF.md:178-179`). For the "too good to be true" mark, the owner lists copies across distant places as a signal in its own right (`nabvy/docs/decisions.md:155`). How many signals the mark needs is `suspected-labels`' rule, calibrated in shadow (`nabvy/docs/decisions.md:162,166`; `modules.md:790-803`). `copy-advert` sets no condition on it.

**When the flag is not shown:**
- the module is not `on`;
- the listing's `towns` (4.8) is below `flagMinTowns`;
- the listing's links are only candidates, text copies or photo matches;
- a correction unflagged the listing or split its pair;
- the listing is suppressed, or `listing-suppression` is off.

Counts leave out suppressed members.

**Never shown** (`fb-scrap-engine/docs/design/SELLER_DATA.md:289-290,332-338`; `fb-scrap-engine/docs/HANDOFF.md:212-217`):
- cluster keys;
- the other listings' IDs, links, titles or towns, or a count of other or past listings;
- seller names, IDs or pictures;
- "same seller", "spans accounts" or account counts;
- "relisted", "seen before", or history across listing IDs;
- similarity values or any score;
- photo matches;
- locations finer than a count of towns.

**Shadow first.** The module ships in `shadow`.
- Internal readers use confirmed clusters: the index collapse and one alert per cluster, the brief's internal use (`fb-scrap-engine/docs/design/SELLER_DATA.md:94-97`).
- Users see nothing (`modules.md:98-102`).
- It runs in shadow through the owner's rtx3090 test hunt, the first end-to-end acceptance test, which names copy-advert detection (`nabvy/docs/decisions.md:136`).
- Every cluster the hunt forms goes through `v_review_queue` for a hand check (`fb-scrap-engine/docs/design/SELLER_DATA.md:345-346`).

**Report and correction route.**
- **Reports.** A signed-in user's report is recorded through an oRPC procedure inside `withUser` (`nabvy/CLAUDE.md:14`) and appears in `v_review_queue`. The procedure checks the account's standing through `account` before calling `report()` (`modules.md:108`; `nabvy/docs/decisions.md:124`), and is rate-limited per user like other feedback endpoints (`nabvy/docs/security.md:25`). A user's report rows are deleted within 24 hours of `account.deleted` (5.4).
- **Corrections.** An admin in `review-console` decides. `applyCorrection()` writes an override, audited through `audit-log`, which the next recompute respects. The case is exported as a fixture (`modules.md:1111-1116`; `nabvy/docs/fixtures.md:39`).
- **Sellers.** A seller who objects uses `seller-rights` by listing link (`fb-scrap-engine/docs/design/SELLER_DATA.md:140-142`). It may also call `applyCorrection()`.

**Gate before showing anything.**
- Every condition for a suspected label holds (`fb-scrap-engine/docs/HANDOFF.md:97-103`):
  - worded as a suspicion;
  - shown next to its evidence;
  - from a documented rule with calibrated thresholds (1.7b);
  - with a report and correction route;
  - never revealing identity.
- The owner signs off the wording and the display threshold.
- The brief asks for legal review of the wording before launch (`fb-scrap-engine/docs/HANDOFF.md:104-106,186`; `fb-scrap-engine/docs/design/SELLER_DATA.md:253-255`), and the Precedence row keeps it (`nabvy/docs/decisions.md:13`). Agents do not run it (`nabvy/CLAUDE.md:29`; `nabvy/docs/decisions.md:188`). The flag stays off until the owner confirms the review is complete. The point is listed at `nabvy/docs/legal-review.md:21`.

## 7. Uses by other modules

Readers use `v_members`, `v_cluster_facts` and `v_listing_copy_facts`, never the tables.

| Module | Use | Notes |
| --- | --- | --- |
| `asking-price-index` | Counts each confirmed cluster once per group: one ask, since members share price and currency by construction. Relists and copies both collapse (`fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:264-265`; `fb-scrap-engine/docs/design/SELLER_DATA.md:95-96`) | Suggestion: place the cluster in the group of its earliest-listed member |
| `asking-price-position` | Positions over the collapsed index, so n≥10 counts items, not copies (`nabvy/docs/decisions.md:15`) | Via the index |
| `alert-router` | One alert per cluster: after alerting a user on any member, it drops the other members for that user within the window (`fb-scrap-engine/docs/design/SELLER_DATA.md:95-96`) | Suggestion: alert on the member nearest the user (`location.distanceKm()`) |
| `spec-match` | Reads `app.v_copy_advert_flags` and applies "hide likely spam" to listings with a shown flag only | In shadow the preference does nothing. Its role has `SELECT` on the view (rule 5 of `modules.md`) |
| `noise-filter` | None in v1. Noise and copies are separate reasons, both listing-level | It could later read `v_listing_copy_facts` (soft) for trade adverts posted in many towns |
| `suspected-labels` | Evidence for "suspected scam" and the "too good to be true" mark: `town_count`, `span_days`, `spread_km`, `mass_posted`, `text_copy_count`. `v_members` spreads user reports across a listing's copies (`nabvy/docs/decisions.md:155-156`). "Same advert in 5 towns" is also the brief's example of trade-seller evidence (`fb-scrap-engine/docs/HANDOFF.md:99-100`). Any count it shows users comes from the per-listing `towns` and `span_days` in `v_listing_copy_facts`, never from cluster-level counts (4.8) | Consumer's starting value for "distant": a spread of at least 100 km (an area's radius, `modules.md:430`; local feeds reach about 100 km, `fb-scrap-engine/README.md:125-126`) |
| `demand-signals` | Counts a mass-posted wanted advert once per cell and week (soft edge, change 6) | Cells under the threshold are still suppressed (`modules.md:805-808`) |
| `notifier` and listing screens | Show `app.v_copy_advert_flags` when on | `modules.md:944-945` |
| `review-console` | `v_review_queue`, `applyCorrection()` | |
| `seller-rights` | `erase(listingIds)` deletes prints, links, memberships, flags, requests and reports for those listings, and the `photo_matches` and `overrides` rows that name them, then recomputes their clusters. It may also call `applyCorrection()` | `modules.md:1034-1042`; the `applyCorrection()` call is on the catalogue card |
| `ops-metrics` | `v_shadow_metrics` | |
| `output-guard` | Checks the user view and the flag contract | `modules.md:1049-1057` |

## 8. Evaluation

**Fixture set** (stage `clustering`; stage `flag` from 1.7c):
- **Recorded negatives.**
  - The recorded run as a whole gives no links and no flags (4.13).
  - Rows 7, 9 and 19 share a title and are not copies.
  - All 20 photo IDs differ.
- **Synthetic cases**, marked `"synthetic": true` with the recorded row they start from (`modules.md:140`), because the recorded run holds no copies (`modules.md:2271`):

| Case | Expected |
| --- | --- |
| One recorded advert copied to 5 and to 12 city pages with the same price | A confirmed cluster, mass-posted |
| Copies that differ only in case, whitespace, punctuation, emoji, "+" encoding or a phone number | Still one cluster |
| Same title and price, different description | Split as a look-alike, the brief's lesson (`fb-scrap-engine/docs/design/SELLER_DATA.md:69-73`) |
| Same title and price, one `partial` description | A candidate plus one `enqueue()` call, no flag |
| Identical short description (under `descMinChars`), long title | One cluster |
| Identical short description, generic short title | Split as a look-alike |
| Same text in one city page twice | One town, no flag |
| A same-town relist listed 25 days earlier plus copies in 5 other towns | The relist adds no town and no days to the user-facing facts |
| The same text in GBP and EUR | No confirmed cluster |
| £0 or free | No fingerprint |
| Same description, different price | `text_copy` evidence only |
| A shared photo ID with different text | A `photo_matches` row only, no link |
| A suppressed member | Counts drop, and its own flag is hidden |
| A correction that splits a pair | The split holds on the next recompute |

- **Real positives**, as they arrive:
  - clusters from the rtx3090 hunt's runs;
  - the owner-approved control run, if approved (Q7): the brief's non-hardware control found 29.1% copies (`fb-scrap-engine/docs/design/SELLER_DATA.md:80-81`). Estimated cost: one full sweep at $0.01–0.031 (`fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:65`), plus details for about 358 candidates at $0.00092, about $0.33 (calc. from the 1,229-listing sofa feed, `fb-scrap-engine/docs/EVIDENCE_LEDGER.md:124`). About $0.34–0.36 in all (est.).
- **Hand-checked look-alikes** from Nabvy's own runs (`fb-scrap-engine/docs/design/SELLER_DATA.md:345-346`).

**Labelling protocol.**
- **A true copy.** Two or more listing IDs whose title and description are the same after normalisation, or differ only in contact details, spacing, punctuation, emoji, case or a place name, at the same asking price and currency, with members in two or more city pages within 30 days.
- **Not a copy:**
  - the same generic title with different text (a look-alike);
  - one item re-posted in the same city page (a relist);
  - one trader's different items that share boilerplate but differ in spec lines or model numbers.
- **Copied genuine adverts.** A genuine advert and a copy of its text are a copy. The flag makes no claim about which came first.
- **Records.** The labeller records member IDs, a verdict (`copy`, `lookalike`, `relist` or `unsure`) and short quotes as evidence in `notes.md`. `unsure` stays out of the rates but is kept.
- **Privacy.** Labels stay with the module's fixtures, in the redacted form fixtures use (`nabvy/fixtures/README.md:86-90`).

**Targets before leaving shadow.** These are owner decisions (Q9). The conservative defaults are starting values:

| Target | Default | Basis |
| --- | --- | --- |
| Cluster precision for internal collapse | ≥95% of confirmed clusters are true copies on the hand-checked set | Starting value. Precision over recall (`nabvy/README.md:11`) |
| Flag precision | No false flag among at least 30 hand-checked would-show clusters | With no errors in 30 checks, the 95% upper bound on the error rate is about 3/30 = 10% (calc., the rule of three) |
| Recall | ≥80% of hand-labelled copy clusters found | Starting value; a missed copy only double-counts |

**CI tests** (`modules.md:142-151`):

| Test | Checks |
| --- | --- |
| `test/domain.test.ts` | Each normalisation step; the fingerprints; threshold boundaries at 0.79 and 0.80, and at 99 and 100 characters |
| `test/fixtures/clustering.fixtures.ts` | One `it` per case |
| `test/idempotency.test.ts` | A second run of a batch writes nothing and emits nothing. A second `account.deleted` for the same user changes nothing, and no report rows remain after it |
| `test/concurrency.test.ts`, on the dry-run database | Two concurrent batches, each holding one copy of the same advert, form one cluster (the advisory lock, 4.11) |
| `test/switch.test.ts` | Off: no writes and empty views. Shadow: no user rows. `asking-price-index` fixtures still pass with this module off |
| `test/contracts.test.ts` | Contracts parse; samples in `fixtures/contracts/copy-advert/` (`nabvy/packages/contracts/README.md:102-115`) |
| `packages/db/tests/copy-advert.test.sql`, run by `pnpm db:dry-run` | Only the pipeline writes. The user view has exactly its columns, leaves out suppressed listings through `is_suppressed()`, and is empty when the module is not `on` or suppression is off. Reading `copy_advert.flags` directly as `nabvy_app` returns the same rows as the view. `nabvy_app` cannot read `restricted_accounts`. `view_violations()` is clean. pg_trgm reproduces the Python baseline (0.374 is below `nearText`) |
| Load test on the dry-run database | 100,000 synthetic prints: per-batch lookup p95 under 500 ms (starting value; basis: the graph-query revisit threshold at `nabvy/docs/decisions.md:207`) |

**Pass-rate tracking.** `services/copy-advert/test/fixtures/pass-rates.json` holds the recorded rate, written with `pnpm test:fixtures --module services/copy-advert --record`. CI fails when a stage falls below it (`nabvy/fixtures/README.md:25-77`; `nabvy/CLAUDE.md:23`). Every mistake found in review becomes a fixture.

## 9. Build plan

Task IDs insert after 1.7 (risk screener v0), which `copy-advert` partly replaces (`modules.md:2102`). Existing IDs are not renumbered: lettered IDs insert new tasks, as 0.5a and 1.5a do (`nabvy/docs/backlog.md:14,27`). Each task runs on its own branch, `task/<id>-copy-advert`, with one pull request, which the reviewer session merges (`nabvy/docs/decisions.md:76-78`).

**Standing definition of done for every task** (`nabvy/CLAUDE.md:22`):
- types in `@nabvy/contracts/modules/copy-advert`, and schema in `@nabvy/db/schema/copy-advert` with its migrations;
- a fixture-based test;
- `pnpm typecheck && pnpm lint && pnpm test && pnpm test:fixtures && pnpm db:dry-run` clean;
- a note in `services/copy-advert/README.md` (template `modules.md:114-127`), with a rules table of value, basis and status;
- a `docs/progress.md` row, written by the coordinator (`nabvy/docs/decisions.md:77`).

| ID | Task | Definition of done (beyond the standing items) | Depends on |
| --- | --- | --- | --- |
| **1.7a** | **copy-advert core, in shadow.** Scaffold with `pnpm new:module copy-advert`. Build the contracts, tables, indexes and views of section 5; the S1–S6 and S8–S9 stages; handlers for the five input events and the daily expiry; `copy-advert.clustered`; `erase()`, `applyCorrection()`, `report()`; candidate requests behind `candidateDailyCap` | On the recorded run: no links, no flags. Every synthetic case in section 8 passes. The idempotency and switch tests pass. The db test passes, including pg_trgm against the Python baseline. The load test is within budget. Ships `shadow`, with the user view empty. `drizzle-zod` is added with its justification | Done: 0.2, 0.3, 0.6 (`nabvy/docs/progress.md:8-9,13`). Hard: `switches` (1.9a) and `audit-log` (1.9b), `listing-ingest` (1.3a) with change 4, `detail-evidence` (1.3c), `details-queue` (1.4a), `city-pages` (1.2a), `listing-suppression` with `is_suppressed()`, `account`. Soft: `seller-key`, `photo-review` (stubs, `modules.md:11`). Task IDs are those of `actor-integration.md` section 6; the audit's consolidated backlog gives `listing-suppression`, `account` and the stubs theirs |
| **1.7b** | **Backtest and calibration.** Hand-check every cluster from the rtx3090 hunt's runs, and from the control run if approved. Measure pair and cluster precision and recall and the flag precision. Check photo-file-name stability on raw rows in the gateway's store, a query on the stored rows with no Facebook traffic. Record the calibrated thresholds as `copy-advert@2` if they change | A calibration report in the module README: counts, precision and recall with sample sizes, the distribution of towns and days per cluster, and the proposed `flagMinTowns`. Labelled cases added as fixtures. `pass-rates.json` recorded. The Q9 targets met, or their shortfall reported | 1.7a; the rtx3090 hunt running (`nabvy/docs/decisions.md:136`); Q7 for the control run. Copies in PCs and GPUs are "almost absent" (1 cluster, `fb-scrap-engine/docs/design/SELLER_DATA.md:84`), so without Q7 expect too few positives to calibrate `flagMinTowns` or meet the flag-precision target |
| **1.7c** | **User-facing flag.** `app.v_copy_advert_flags` goes live when the switch moves to `on`. The report procedure, and the correction path through `review-console` or an admin procedure until 4.5 | Owner sign-off on the wording, display threshold and hide default (Q2–Q5) recorded in `nabvy/docs/decisions.md`. `output-guard` cases for this view and contract pass. Stage `flag` fixtures. The legal-review point updated. The owner confirms the legal review of the wording is complete | 1.7b, with enough positives: it stays blocked until the control run, or enough hunt clusters, exist; `output-guard`; `listing-suppression` on; the `app` schema (a foundation follow-up); `review-console` (4.5) or an admin procedure |
| **1.7d** | **Optional evidence.** S7 account check in `copy_advert.restricted_accounts`. `photo-review`'s sha256 as S6 evidence | Restricted grants tested (developers' read-all role only). Photo evidence never forms a link alone. Shadow metrics show the effect | `seller-key` (Q11; `modules.md:2248`); `photo-review` after actor photo capture (`nabvy/docs/questions.md:15`) |

**Coordinator points** (not owner decisions).

Applied to `modules.md` by the audit of 2026-09-24:
- change 4 in `listing-ingest`'s card (primary photo ID and `money.kind` in `v_listings`);
- the soft edge from `demand-signals`, and `audit-log` and `account` in `copy-advert`'s dependencies (`account.deleted`, `isActive()`);
- `listing-suppression` exports `listing_suppression.is_suppressed(uuid)`, and `switches` its `state()` and `is_on()`, as SECURITY DEFINER SQL functions with `EXECUTE` for `nabvy_app` (5.1; rule 5);
- `review-console` depends on `copy-advert` (`v_review_queue`, `applyCorrection()`);
- `seller-rights` may call `copy-advert.applyCorrection()`;
- `spec-match` reads `app.v_copy_advert_flags` instead of `v_members`, and its role gets `SELECT` on it;
- `ops-metrics` reads `v_shadow_metrics`;
- `asking-price-index` records "copy collapse unavailable" on its stats rows while `copy-advert` is off (section 3);
- the catalogue's contract list, tables, views and user-view columns for `copy-advert` now match sections 5.1–5.3.

Still open:
- create the `app` schema in a core migration (a foundation follow-up task);
- thresholds in the module's `src/domain/rules.ts` instead of `packages/config` (change 1): confirm the departure from rule 14 (`modules.md:112`; `nabvy/docs/engineering.md:15`).

## 10. Open questions for the owner

Each question states the option taken meanwhile and why it is the conservative one.

1. **Approve this design** and the changes in section 0.
   - *Meanwhile:* nothing module-specific is built until the owner approves the catalogue (`modules.md` question 1; wave 1 waits for that approval, `nabvy/docs/handoff.md:115`). Once approved, 1.7a is built first, in shadow.
   - *Why conservative:* no code rests on an unapproved structure, and nothing reaches users.
2. **The flag's wording:** A ("Likely spam: …") or B ("Suspected copy advert: …"), both in section 6. The owner's wording names which count is shown: towns by label, as 4.8 proposes, or city pages.
   - Option A would need the owner to exempt the copy flag from the "Suspected …:" rule (`nabvy/docs/fb-actor-sources.md:58-59`) and from `output-guard`'s check that every label starts "Suspected" (`modules.md:800,1051`).
   - The owner also chooses the texts "Hide adverts like this" and "Report a mistake", and the report reasons.
   - *Meanwhile:* nothing shown; the drafts use B and are used only in shadow review.
   - *Why conservative:* wording shown to users is the owner's (`nabvy/CLAUDE.md:30`).
3. **The display threshold** (`flagMinTowns`, and whether a days limit applies).
   - *Meanwhile:* none shown. The proposal of 5 towns waits for 1.7b's distribution.
   - *Why conservative:* a higher threshold shows fewer, surer flags.
4. **"Hide adverts like this" by default.**
   - *Meanwhile:* off. Users choose to hide.
   - *Why conservative:* nothing is hidden silently (`nabvy/docs/architecture.md:66`).
5. **Legal review before showing the flag.** The brief requires it before launch (`fb-scrap-engine/docs/HANDOFF.md:104-106,186`), the Precedence row keeps it (`nabvy/docs/decisions.md:13`), and agents never run or commission it (`nabvy/CLAUDE.md:29`; `nabvy/docs/decisions.md:188`).
   - *Meanwhile:* the flag stays off until the owner confirms that the legal review of the wording is complete. The point is listed at `nabvy/docs/legal-review.md:21`.
   - *Why conservative:* nothing reaches users until both the owner and the review have cleared the wording.
   - *Also to list there, without analysis:* the "likely spam" flag, and user reports counted on copies (`nabvy/docs/decisions.md:156`).
6. **Internal collapse while in shadow.**
   - *Meanwhile:* the index and `alert-router` use confirmed clusters (exact or near text, with the description agreeing) from the start, and every such cluster is hand-checked through the review queue.
   - *Why conservative:* only description-confirmed matches are collapsed, and the brief builds this use first (`fb-scrap-engine/docs/design/SELLER_DATA.md:94-97`).
7. **A control capture run** for real positives: one non-hardware term like the brief's sofa control, about $0.34–0.36 (est., section 8). It is extra collection outside users' hunts (`nabvy/docs/decisions.md:131`). The control run's descriptions are fetched as part of the owner-approved one-off run (`search-planner`'s `one_off_runs`, `modules.md:459,463`), outside S4's hunt-area rule. Without it, 1.7b expects too few positives to calibrate `flagMinTowns` or meet the flag-precision target, and 1.7c stays blocked until enough hunt clusters exist (section 9).
   - *Meanwhile:* synthetic positives and whatever the rtx3090 hunt finds.
   - *Why conservative:* it spends nothing without approval.
8. **Reports spread across copies.** A copy cluster can include the genuine advert that scammers copied (`fb-scrap-engine/docs/design/SELLER_DATA.md:240-241`), and the owner's rule counts a report on a listing's copies (`nabvy/docs/decisions.md:156`).
   - *Meanwhile:* `v_members` gives `suspected-labels` each listing's copies, and `copy-advert` sets no condition on the mark (section 6).
   - *Proposal for `suspected-labels`' open questions:* a copy shows the mark only with at least one signal of its own, computed in shadow first, so that one report cannot label an unrelated seller's genuine advert.
   - *Why conservative:* how many signals the mark needs is `suspected-labels`' rule, calibrated in shadow (`modules.md:790-803`; `nabvy/docs/decisions.md:166`), so this module publishes membership and decides nothing about the mark.
9. **Precision and recall targets before leaving shadow** (section 8).
   - *Meanwhile:* the defaults in section 8.
   - *Why conservative:* it favours precision (`nabvy/README.md:11`).
10. **Text copies** (same description, different title or price).
    - *Meanwhile:* internal evidence only, never collapsed or flagged.
    - *Why conservative:* no in-scope measurement supports treating them as one item.
11. **The "spans accounts" check.** It needs `seller-key` (`modules.md:2248`).
    - *Meanwhile:* off.
    - *Why conservative:* it adds no seller-level processing, and the user flag never needs it.
12. **Retention** of the normalised text, links and reports. Retention is unset (`nabvy/docs/decisions.md:36`; `nabvy/docs/questions.md:13`).
    - *Meanwhile:* kept until the owner decides; `erase()` is always honoured.
    - *Why conservative:* it follows "keep everything" and still respects erasure.
