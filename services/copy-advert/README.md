# @nabvy/copy-advert

Finds adverts copied and mass-posted across city pages, counts each copy cluster once internally,
and publishes a per-listing flag with facts only (`docs/design/modules/copy-advert.md`;
`docs/design/drafts/copy-advert.md`).

A module session edits only this folder, `packages/contracts/src/modules/copy-advert.ts`,
`packages/config/src/modules/copy-advert.ts` (empty; thresholds live in `src/domain/rules.ts`, see
"Decisions"), `packages/db/src/schema/copy-advert.ts`, `packages/db/tests/copy-advert.test.sql` and
`packages/db/migrations/copy-advert/`.

## Switch and priority

Off by default (rule 11 of `_rules.md`; no seed row, so `switches.state('copy-advert')` reads
`off`). Off: `recompute` and the daily expiry acknowledge and write nothing, and every internal
view returns no rows; the same while the global `pipeline` switch is off. `erase()` always runs
(erasure is a right, not a feature). Users lose nothing extra while it is off: no user-facing view
exists yet (task 1.7c), so the module has no on-switch behaviour users would notice; internally,
`asking-price-index` counts each listing on its own and `alert-router` sends one alert per listing
instead of once per cluster. Shadow behaves like on for every internal reader; only the eventual
`app.v_copy_advert_flags` (1.7c) is gated to `on`. First; the first atomic module
(`docs/decisions.md:60`). Ships in shadow: task 1.7a, `docs/design/drafts/copy-advert.md` section 9.

## Inputs

- Events: `listing-ingest.first-seen`, `listing-ingest.card-changed` (listing IDs; `listing-ingest`);
  `detail-evidence.changed` (listing IDs; `detail-evidence`); `listing-suppression.changed` (entry
  IDs; `listing-suppression` — see "Decisions" for how this module reacts to it); `account.deleted`
  (user IDs; `account`); a daily scheduled `copy-advert-expire` (`trigger/copy-advert-expire.ts`).
- Views read (all through `@nabvy/db/schema/<module>`, never a service package): `listing-ingest`'s
  `v_listings` (title, price, currency, `money_kind`, primary photo ID, city page, `listed_at`,
  card hash); `detail-evidence`'s `v_current` and `v_text` (description, `description_status`,
  evidence hash); `city-pages`'s `v_city_pages` (town labels, coordinates) and `v_area_membership`
  (`in_area`, for S4 eligibility); `listing-suppression`'s `is_suppressed()` (fails closed).
- Functions called: `@nabvy/details-queue`'s `enqueue()` (S4 candidates); `@nabvy/audit-log`'s
  `record()` (`applyCorrection()`); `@nabvy/switches`'s `state()`/`isOn()`.
- Soft (not built, not read yet): `seller-key`'s `restricted_listing_keys` (S7, 1.7d);
  `photo-review`'s `v_photo_hashes` (S6's soft half; the hard half, the card's own primary photo ID
  from `listing-ingest`, is built now).

## Outputs

- **Event** `copy-advert.clustered` v1 `{ listingIds (1-500), ruleVersion }`: listings whose
  membership or facts changed this batch. Key: `batchKey('copy-advert.clustered', listingIds)`.
- **Internal views** (`copy_advert` schema; `nabvy_pipeline`; `security_invoker`; empty while off):
  `v_members`, `v_cluster_facts`, `v_listing_copy_facts`, `v_links`, `v_review_queue`,
  `v_shadow_metrics`.
- **Restricted view** `copy_advert.restricted_accounts` (never `v_`-named, never granted to
  `nabvy_app`): empty until `seller-key` exists and S7 is built (1.7d).
- **User-facing view:** none yet. `app.v_copy_advert_flags` is task 1.7c's: the `app` schema does
  not exist yet, and the flag needs the owner's wording, display threshold and a completed legal
  review first (design section 6, "Gate before showing anything"). Meanwhile `copy_advert.flags`
  carries a direct `nabvy_app` grant on `listing_id, towns, span_days, rule_version` and an RLS
  policy with the same shape the eventual view will have, so 1.7c only has to add the view.
- **Functions** (`@nabvy/copy-advert`): `recompute(q, { listingIds, now? })` (S1-S9 for a batch),
  `expireWindow(q, now?)` (daily), `erase(q, listingIds)`, `purgeUserReports(q, userId)`,
  `report(q, userId, input)`, `applyCorrection(q, input)`.

## Tables

Schema `copy_advert`:

- `prints`: one row per listing version fingerprinted. Unique `(source, source_listing_id,
  card_hash, evidence_hash, rule_version)`; `current` marks the latest print of a listing.
- `links`: a decided pair, `listing_a < listing_b`, unique with `rule_version`; `basis` one of
  `exact_text | near_text | candidate | lookalike | text_copy`.
- `photo_matches`: internal photo-ID evidence, `listing_a < listing_b` with `rule_version`.
- `clusters`: one row per connected component, keyed on `cluster_key` (deterministic: the rule
  version and the earliest-listed member's source listing ID); `member_set_hash` versions it.
- `members`: `(cluster_key, listing_id)`; `members_one_active_idx` (unique, partial on
  `left_at is null`) keeps at most one active membership per listing.
- `flags`: `listing_id` primary key; `towns`, `span_days` (per-listing facts, 4.8), `would_show`.
- `candidate_requests`: `listing_id` primary key, the daily-cap ledger for S4.
- `overrides`: a correction the next recompute must respect (not yet enforced inside
  `recomputeClusters`; see "Decisions").
- `reports`: user rows, `(user_id, listing_id)` unique; RLS.
- `account_checks`: restricted, empty until 1.7d.

## Rules and thresholds

All in `services/copy-advert/src/domain/rules.ts`, rule version `copy-advert@1` (a departure from
rule 14 of `_rules.md`, thresholds live with the rule they version, not in `packages/config`; the
coordinator confirmed this, `docs/design/drafts/copy-advert.md` section 0 change 1).

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| `titleMinChars` | 20 | Generic recorded titles are 9-17 characters | Starting value |
| `descMinChars` | 100 | Recorded range 55-1,057, median 309 | Starting value |
| `nearText` | 0.80 | Highest similarity between different recorded listings: 0.374 | Starting value |
| `textCopy` / `textCopyMinChars` | 0.90 / 200 | Stricter than `nearText`; no in-scope measurement | Starting value |
| `windowDays` | 30 | The asking-price index's window | Starting value |
| `massPostedMinTowns` | 2 | The brief's measurement definition | From the brief |
| `flagMinTowns` | 5 (proposal) | Example wordings only ("5 towns", "12 towns in 2 days") | Owner decision pending (`docs/questions/copy-advert.md`) |
| `candidateDailyCap` | 200 | One details batch holds ~200 IDs; well within the $150/month Apify cap | Starting value |

## Fixtures and pass rate

Stage `clustering` (`test/fixtures/clustering.fixtures.ts`), on the real migrations plus core,
audit-log, switches, cost-meter, apify-gateway, listing-ingest, detail-evidence, city-pages and
listing-suppression, in PGlite with the `pg_trgm` contrib extension loaded (unlike every other
acquisition module's test support, this one needs it):

- the recorded run `fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/` alone: no links,
  no clusters, no flags (design 4.13; rows 7, 9 and 19 share the bare title "Gaming pc" at three
  different prices and are not copies);
- synthetic cases, each built by duplicating row 7 ("Gaming PC", £2,500, a full_verified,
  1,014-character description) to new listing IDs and city pages: one advert copied to 5 towns
  forms a mass-posted, would-show cluster; copies differing only in title case, whitespace and
  punctuation still cluster (`exact_text`); same title and price with an unrelated description
  splits as a `lookalike`; the same text in GBP and EUR never confirms; £0/free gets no price
  fingerprint at all; a suppressed member drops its own flag and the cluster's `listing_count` falls
  by one.

Pass rate 7/7 (2026-09-24). Other tests: `test/domain.test.ts` (normalisation including NFKC,
"+"-decoding and contact masking; fingerprints; `confirmBasis`/`isTextCopy`/`candidateEligible`
threshold boundaries; `components`; `clusterKey`/`memberSetHash` determinism; `townGroups` sharing
any label; per-listing facts leaving out the listing's own town); `test/idempotency.test.ts` (a
replayed batch writes no new prints, links, clusters or members and returns the same changed
listings; a repeated `report()` for the same user and listing writes once; a repeated
`purgeUserReports()` changes nothing further); `test/switch.test.ts` (off: no writes, empty views;
shadow: writes, but `nabvy_app` reads no flag); `test/contracts.test.ts` (every view row and the
emitted event parse; every link basis is one of the five; a would-show flag, read as `nabvy_app`
once the switch is `on`, parses as `CopyAdvertFlag`; no internal view carries a seller-like or
raw-row column); `packages/db/tests/copy-advert.test.sql` (grants per table, including the `flags`
column-level grant and its RLS policy shape; `restricted_accounts` unreachable by `nabvy_app`; the
view conventions; off/shadow/on and the `listing-suppression`-off fail-closed case; `pg_trgm` on
real Postgres). The load test of design section 8 (100,000 synthetic prints, p95 under 500 ms) was
not run in this task (`docs/questions/copy-advert.md`).

## Decisions

- **2026-09-24: view rows are Zod in contracts, not derived with `drizzle-zod`.** Every other
  merged module (`listing-ingest`, `detail-evidence`, `listing-suppression`, `run-coverage`,
  `city-pages`, `scan-recognition`, `apify-gateway`) chose the same thing: no dependency exists yet.
  This departs from `docs/design/drafts/copy-advert.md` section 0, change 11, which proposed
  `drizzle-zod` for this module specifically; `test/contracts.test.ts` checks the Drizzle view's
  columns against the hand-written schema instead.
- **2026-09-24: `app.v_copy_advert_flags` is deferred to task 1.7c.** No module has created the
  `app` schema yet (`services/account/README.md` made the same call for its own user-facing view).
  `copy_advert.flags` carries the RLS policy and column grant the eventual view will wrap, so 1.7c
  only adds the view once the schema, the owner's wording and the legal review are ready.
- **2026-09-24: `flags` gets a row for every active member of every active cluster**, not only
  members of a mass-posted one (the schema sketch's inline comment). `v_listing_copy_facts` (read
  by every internal consumer in section 7, including for non-mass-posted collapses) has no other
  backing table; `would_show` alone still decides what a user could ever be shown. Recorded as an
  open question (`docs/questions/copy-advert.md`) since it reinterprets a scaffold figure.
  Consistently, S8 forms a cluster (and a `clusters`/`members` row) for a confirmed `exact_text` or
  `near_text` link regardless of town count; only `mass_posted` (town count) and `flagMinTowns`
  (per-listing towns) gate `would_show`.
- **2026-09-24: cluster keys are not assumed stable across a recompute.** A cluster's key is
  deterministic on its earliest-listed member (design 4.8); when that member is suppressed, expires
  or is corrected out, the remaining members' cluster gets a new key. `recomputeClusters` therefore
  tracks, across every group in a pass, which listings ended up assigned to *some* active cluster
  (`stillAssigned`), and only after every group is processed closes the old membership and drops the
  flag of every listing that used to have one and is not in that set — never assuming a specific old
  key still matches. A cluster key touched this pass left with no active member is expired. Members
  are always re-keyed by closing the old membership row before inserting the new one:
  `members_one_active_idx` (partial unique on `listing_id where left_at is null`) would otherwise
  reject the insert.
- **2026-09-24: `listing-suppression.changed` recomputes every active cluster's membership**,
  since the event carries entry IDs rather than listing IDs (`docs/questions/copy-advert.md`).
- **2026-09-24: S1 always stores `desc_norm`/`desc_fp` for a `full_verified` description**,
  whatever its length; the "at least `descMinChars`" language in design 4.3's table describes when
  a print is useful for trigram lookups, not a condition on storing it — the short-description
  branch of S3 needs the fingerprint to exist to compare `desc_fp` equality.
- **2026-09-24: normalisation's contact-masking patterns are copied as literals, not imported.**
  The design points at `services/source-adapters`' fixture test (email, UK mobile) and
  `quote-redaction`'s link detector (URLs) as the patterns to match; `copy-advert` has no dependency
  on either module, so `src/domain/normalise.ts` carries its own copies with a comment citing the
  source, the same way other modules avoid an unnecessary dependency for one shared regular
  expression.
- **2026-09-24: S4's actual `enqueue()` call is gated on `city-pages`' `v_area_membership`,
  fetched live per batch.** A candidate is requested only when the undescribed side's city page is
  `in_area` for some active centre; nothing else in this module tracks "active hunts" directly.
- **2026-09-24: candidate priority is `sweep`**, the lowest `details-queue` has, standing in for
  "after sweep follow-ups" until a lower priority exists (`docs/questions/copy-advert.md`).
- **2026-09-24: `applyCorrection()` records an override and its audit row, but `recomputeClusters`
  does not read `overrides` yet.** `review-console`, the intended caller of the correction path, does
  not exist; wiring overrides into the clustering pass (S8's "connected components, with overrides
  applied") is left to whichever task builds that console or a follow-up to this one.
