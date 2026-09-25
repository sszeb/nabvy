# @nabvy/seller-reply-reports

Takes one-tap reports of what a seller told a buyer, checks each against the listing, weighs it,
counts each person once, spreads it across confirmed copies, and publishes evidence per listing
and family for `suspected-labels` (`docs/design/modules/seller-reply-reports.md`; the
too-good-to-be-true design §3, §6.2, §6.4). It labels nothing and decides no mark.

A module session edits only this folder, `packages/contracts/src/modules/seller-reply-reports.ts`,
`packages/config/src/modules/seller-reply-reports.ts`, `packages/db/src/schema/seller-reply-reports.ts`,
`packages/db/tests/seller-reply-reports.test.sql` and `packages/db/migrations/seller-reply-reports/`.

## Switch and priority

Off by default (rule 11). Off: `canReport`, `submit`, `edit`, `withdraw` and `resolve` refuse
(`seller-reply-reports.off`), the aggregator and handlers write nothing, and every view is empty:
users lose the report sheet and "Your reports"; marks use listing signals only (path A). Shadow:
everything is recorded and computed and the internal views have rows, but the sheet and
`app.v_seller_reply_reports_mine` are for accounts in `testers` only, whose reports never count
(design §6.2). On: the sheet for every eligible user. MVP, shadow first (`docs/decisions.md:154-166`),
task 1.7j. `erase()` and the `account.deleted` purge run whatever the switch.

## Inputs

- Calls (web app, inside `withUser`, as `nabvy_app`): `canReport`, `submit`, `edit`, `withdraw`.
  Pipeline calls (as `nabvy_pipeline`): `aggregate`, `resolve`, `erase`, `addTesters`.
- Events, handled by `onRecorded` (this module's own `recorded`, the aggregation step after a
  tap), `onCopyAdvertClustered`, `onPickupLocationChanged`, `onListingFeedbackRecorded`,
  `onStandingChanged`, `onAccountDeleted`. `notifier.opened` needs no handler: the gate reads the
  open record when asked.
- Read through `SellerReplyReportsDeps` (every read of another module is an injected function with
  a default; `docs/questions/seller-reply-reports.md` lists the seams):
  - `switches.state()`; `@nabvy/account`'s `isActive()`; `account.v_profiles` (account age),
    `better_auth.account_active()` and `account.v_standing` (bans);
  - `listing_suppression.is_suppressed()` (the gate and the user-facing view);
  - `listing_feedback.v_bought_for_reports` (report-then-buy);
  - `copy_advert.v_members` (the cluster and its `member_set_hash`);
  - `@nabvy/pickup-location`'s `pointsFor()` and `city_pages.v_city_pages` (the listing's and the
    reported place's points), `@nabvy/location`'s `distanceKm()`;
  - `listing_ingest.v_listings` (T1);
  - seams with conservative defaults while their providers are unmerged or unpublished: notifier's
    open record (none: no sheet), detail-evidence's messaging/shipping/checkout flags (unknown),
    noise-filter (none), email verification (unknown: never counts), account-integrity's
    `linkedGroupOf()` (each user alone), copy-advert's possible original (none), gem candidates
    (none), warning-signs/parts-record fault facts (none).

## Outputs

- Events: `seller-reply-reports.recorded` v1 `{ source, reportIds, recordedAt }` (from `submit`,
  `edit`, `withdraw`; key `…recorded:<ids>@<action>`); `seller-reply-reports.evidence-changed` v1
  `{ source, listingIds, changedAt }` (only when an evidence row's inputs hash changed);
  `seller-reply-reports.resolved` v1 `{ reportIds, resolvedAt }`. The caller publishes them after
  its transaction commits.
- Internal views (`nabvy_pipeline`; rows while shadow or on):
  - `v_listing_evidence`: listing_id, source, family, scope (`own | copy`), persons_band
    (`none | one | several | exact`), persons_exact (≥ 10 only), level, place_id and
    distance_band (only when 3 people agree), held, hold_reason, carried_from_relist (always
    false), rule_version, as_of. No user ID, no free text.
  - `v_review_items`: report_id, listing_id, reasons, details, second_answers, note_text (always
    null), eligibility, weight, status. No user ID.
  - `v_shadow_metrics`: day, reports, eligible, counter_reports, withdrawn, rate_limited,
    held_listings.
  - `v_reporter_signals` (for `account-integrity` and the admin path; granted to `nabvy_pipeline`
    only, never `nabvy_app`, until per-module roles exist): user_id, reports_24h, reports_30d,
    not_upheld, voided, over_limit, burst_involvement. No report-then-buy count.
- User-facing view `app.v_seller_reply_reports_mine` (`nabvy_app`, `security_invoker`): exactly
  `report_id, listing_id, reasons, status, created_at, withdrawable`, the caller's own reports.
  Rows while on (in shadow, to testers), never on a suppressed listing, none while
  `listing-suppression` is off. It reads only this module's RLS tables, so it needs no SECURITY
  DEFINER function (`docs/security.md`, "Cross-module reads behind a user-facing view").
- Functions: `canReport`, `submit`, `edit`, `withdraw`, `aggregate`, `resolve`, `erase`,
  `addTesters`, the handlers above, `defaultDeps`, `RULE_VERSION`.

## Tables

Schema `seller_reply_reports`:

| Table | Key columns | Unique |
| --- | --- | --- |
| `reports` | id, source, listing_id, reporter_user_id, card_hash, evidence_hash, open_via, first_opened_at, eligibility, weight_at_submit, weight, status, outcome, outcome_by, listing_shipping_offered, listing_checkout_enabled, listing_messaging_enabled, note_text (held null), tester, rule_version, created_at, updated_at, withdrawn_at | (listing_id, reporter_user_id) |
| `report_reasons` | report_id, reason, detail, second_answer, reported_place_id (a city-page ID), distance_band, counts | (report_id, reason) |
| `reporter_stats` | user_id, upheld, not_upheld, voided, last_report_at | user_id |
| `listing_evidence` | source, listing_id, family, scope, persons, weight_sum, counter_weight, level, place_id, distance_band, held, hold_reason, carried_from_relist, inputs_hash, rule_version, as_of, t1_fetched_at, done_at | (source, listing_id, family, scope, rule_version) |
| `holds` | source, scope_key (listing ID or cluster key), reason, opened_at, released_at, released_by, audit_id | (scope_key, opened_at); one open hold per (scope_key, reason) |
| `testers` | user_id, added_by, audit_id, added_at | user_id |

RLS on every table with a user ID (`reports` on `reporter_user_id`, `reporter_stats`, `testers`);
`report_reasons` is visible to the app only through its own reports. The app role has column
grants only: it can never read or write eligibility, weights, outcome or `note_text`, and a
restrictive policy lets its only update be a withdrawal. No foreign key leaves the schema.

## Rules and thresholds

`packages/config/src/modules/seller-reply-reports.ts` (design §6.7), all starting values:

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Open gate | 5 min to 14 days after notifier's open | §3.1 | Starting value; seam until notifier merges |
| Established account | 30 days (29 does not count) | §3.2; `docs/decisions.md:158` | Starting value (catalogue question 43) |
| Weight | age factor × `2(u+1)/(u+n+2)`, capped at 1 | §3.2, Beta reputation | Fixed formula |
| Rate limits | 5 an hour, 15 a day; over the limit saves at weight 0 | §3.3 (an estimate) | Starting value |
| Burst holds | 3 in 24 h any age; 2 in 6 h on a gem | §3.3 | Starting value |
| Edit window; report-then-buy | 24 h; 7 days (item family exempt) | §3.2-3.3 | Starting value |
| `collection_elsewhere` counts | ≥ 50 km from that listing (5 km rounding), by the second answer | §3.1; §2.2 L4 | Starting value |
| Levels | single ≥ 1.0; multiple ≥ 2.0 from ≥ 2 people | §3.2 | Starting value |
| Published values | exact count from 10; a place or band when 3 people agree | §4.3; `docs/decisions.md:15` | Fixed by the rule |

## Fixtures and pass rate

Four stages (backlog 1.7j), every case synthetic and marked so: no recorded run can hold a buyer's
report, because Nabvy never sees conversations. Cases are built from the owner's two examples
(`docs/decisions.md:156`) and the design's §8.3 boundaries; each folder has its `notes.md`.

- `gate` (`test/fixtures/gate.fixtures.ts`), 10 cases: open 30 minutes, 4 minutes and 15 days
  ago, no open, messaging off and unknown, suppressed, shadow non-tester and tester, banned.
- `aggregate`, 8 cases: the owner's Chichester postage-only example, postage when shipping was
  offered, protected payment, "Yes" to collection elsewhere, a household counted once, a
  counter-report hold, new and unverified accounts, a fault the listing already stated.
- `spread`, 4 cases: the owner's Isle of Wight/Manchester example across three copies, the
  possible original, no cluster, one person once per cluster.
- `privacy`, 4 cases: exact count from 10, banding under 10, a reported place needing 3 people.

Pass rate 26/26 (2026-09-25), recorded in `test/fixtures/pass-rates.json`.

Other tests: `test/domain.test.ts` (the gate, the 29/30-day boundary, the accuracy factor, every
second answer, bands, levels, linked groups, bursts, holds, statuses), `test/aggregate.test.ts`
(levels, too-new and unverified reporters, withdraw, linked accounts at the lowest weight, burst
and gem-burst holds, counter-report hold, report-then-buy, ban voiding, `resolve()`, no relist
carry, per-member location distance and no spread to the possible original), `test/submit.test.ts`
(the gate, messaging off, suppression, one report per user per listing, the edit window, withdraw),
`test/rls.test.ts`, `test/switch.test.ts`, `test/idempotency.test.ts` (a replayed aggregation
writes nothing), `test/purge.test.ts` (`account.deleted`, `erase()`), `test/contracts.test.ts`,
and `packages/db/tests/seller-reply-reports.test.sql` (grants, column grants,
`v_reporter_signals` to the pipeline only, RLS isolation, shadow for testers, the suppression and
switch filters, on real Postgres).

## Decisions

- **2026-09-25: the listing key is listing-ingest's UUID**, with `source` kept, as listing-feedback,
  pickup-location and copy-advert key theirs; the card's `source_listing_id` is not stored
  (`docs/questions/seller-reply-reports.md`).
- **2026-09-25: the web app writes the tap, the pipeline assesses it.** `submit` runs inside
  `withUser` and stores `eligibility = 'pending'`; account age, email verification, rate limits,
  bursts, testers and weights need pipeline-only reads, so `aggregate` (after the `recorded`
  event) sets them. `weight_at_submit` is the weight at that first assessment; `weight` is the
  current one. The gate failures (`no_open`, `messaging_off`, `suppressed`, `noise`, `not_active`)
  refuse the tap instead of storing it: the sheet is never offered then.
- **2026-09-25: one evidence row per listing, family and scope**; `own` from reports on the
  listing, `copy` from reports on the other members of its copy-advert cluster, re-measured from
  that member for `location`. A replay hashes the same inputs and writes nothing (§6.6).
- **2026-09-25: only `any_path` reasons reach a level**; `path_b_only` is stored on the reason for
  suspected-labels and review. Burst reports carry weight 0 and hold the row.
- **2026-09-25: every cross-module read is an injected seam** (`SellerReplyReportsDeps`), with a
  conservative default where the provider is unmerged or unpublished.
- **2026-09-25: account deletion deletes the reports outright**, and `erase()` deletes reports,
  evidence and holds on the listings; retention (owner decision 15) waits for the owner.

## Open questions

`docs/questions/seller-reply-reports.md` (folded into `docs/questions.md` by the coordinator);
too-good-to-be-true owner decisions 3, 8, 10, 11, 14, 15, 24-27; catalogue questions 16 and 43.

## Incidents

None.
