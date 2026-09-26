# @nabvy/warning-signs

Computes listing-level warning facts, each with its evidence (a redacted quote, another module's
value, or the ask against its group), a rule ID and a rule version: neutral facts for users, and
inputs for the scam review (`docs/design/modules/warning-signs.md`). No scores, no labels, never
holds an alert. A module session edits only this folder,
`packages/contracts/src/modules/warning-signs.ts`, `packages/config/src/modules/warning-signs.ts`,
`packages/db/src/schema/warning-signs.ts`, `packages/db/tests/warning-signs.test.sql` and
`packages/db/migrations/warning-signs/`.

## Switch and priority

Off by default (rule 11 of `_rules.md`; no seed row, so `switches.state('warning-signs')` reads
`off`). While it is off, `evaluate` acknowledges and writes nothing and both views return no rows;
the same while the global `pipeline` switch is off. What users lose: no warning facts, and
`suspected-labels` has only copy clusters to work with (the card's "When off"). Shadow writes and
fills the internal view; the user-facing view shows rows only while the module is `on`. `erase`
runs whatever the switch says. Priority: Also (neutral facts); scam use in shadow first
(`fb-scrap-engine/docs/HANDOFF.md:111-112`); critical-path priority [cp 6].

## Inputs

- Events: `detail-evidence.changed` v1 `{ listingIds }` (detail-evidence),
  `listing-assessment.assessed` v1 `{ listingIds }` (listing-assessment), handled by `evaluate`;
  `asking-price-index.updated` v1 `{ groupKeys }` (asking-price-index), handled by
  `evaluateGroups` (the groups' member listings, 500 at a time).
- Views: `detail_evidence.v_current` (the current version and its description status) and
  `v_text` (title and description, left-joined: it leaves out versions with no text);
  `listing_ingest.v_listings` (card hash, card title, T1 `first_fetched_at`);
  `listing_assessment.v_assessments` (cautions and exclusions of that version; none when it has
  not assessed it); `asking_price_index.v_members` and `v_groups` (the ask, the group's median, n
  and `as_of`).
- `listing_suppression.is_suppressed()` and `quote_redaction.quote()` in the user-facing view.
  The card's `v_suppressed` is not read (`docs/questions/warning-signs.md`).
- `redact()` from `@nabvy/quote-redaction`, on every stored quote.
- Switches `warning-signs` and `pipeline`, through `@nabvy/switches` (fail closed).

## Outputs

- Event `warning-signs.found` v1 `{ listingIds }` (at most 500): every listing among the batch
  whose latest evaluation is stored, now or before. Key: sha256 of the sorted
  `listing@evidence@input@rule` lines plus the batch index, so a replay yields the same key and
  any new input a new one.
- Internal view (`nabvy_pipeline`; `security_invoker`; explicit columns; no seller field; empty
  while off): `warning_signs.v_facts`: listing_id, evidence_hash, card_hash, input_hash, code,
  reason, evidence, rule_id, rule_version, fetched_at (T1 of the input), found_at (done time).
  The facts of each listing's latest evaluation, every code included. Row type
  `WarningSignsFact`.
- User-facing view (`nabvy_app` only): `app.v_warning_signs` (listing_id, code, evidence_text):
  the user-facing codes of each listing's latest evaluation; `evidence_text` passes through
  `quote_redaction.quote()` and is null while that module is not on (fail closed: the fact
  still shows). Rows only while this module and listing-suppression are `on`, never a
  suppressed listing. `nabvy_app` has column-level select on the columns the view reads and
  row-level policies with the same conditions. Row type `WarningSignsListingFact`.
- Functions: `evaluate(q, { listingIds, now })`, `evaluateGroups(q, { groupKeys, now })`,
  `erase(q, listingIds)` for `seller-rights`; handlers `detailEvidenceChangedHandler`,
  `listingAssessmentAssessedHandler`, `askingPriceIndexUpdatedHandler`; the pure `evaluateOne`,
  `payFirstOf`, `lowestGroup`, `clauses`, `phrasePattern`, `isFacebookHost`, `inputHash`,
  `ruleVersion`, `compile`.

## Tables

Postgres schema `warning_signs`. No user rows; the pipeline role inserts, reads and deletes, and
may update only `evaluations.evaluated_at`.

| Table | Key columns | Unique keys |
| --- | --- | --- |
| `evaluations` | `listing_id`, `evidence_hash`, `card_hash`, `input_hash`, `rule_version`, `fetched_at` (T1), `evaluated_at` | `(listing_id, evidence_hash, card_hash, input_hash, rule_version)` |
| `facts` | `evaluation_id`, `listing_id`, `evidence_hash`, `card_hash`, `code`, `reason`, `evidence`, `evidence_text` (redacted quote), `rule_id`, `rule_version`, `found_at` | `(evaluation_id, code, reason)`, nulls not distinct |

Checks pin the hash and version formats, the codes and reasons (the same lists as the contract; a
test compares them), a reason only on `low_ask_explained`, and the quote length.

## Rules and thresholds

All in `packages/config/src/modules/warning-signs.ts`; every one a starting value until more
recorded runs calibrate it. Text rules read the title always and the description only when it is
`full_verified` (too-good-to-be-true design §2.1: other text is unknown, never "no"). Phrases
match inside one clause, word-bounded, case-insensitive, with the design's digit-for-letter map;
a negator (no, not, never, can't…) among the 3 words before a match drops it (5 for pay-first).
"The design" is `docs/design/drafts/too-good-to-be-true.md`.

| Code | Rule | Basis | Status | Shown |
| --- | --- | --- | --- | --- |
| `pay_first_text` | friends and family, gift, voucher or crypto, or a deposit or holding fee, at any time; bank transfer or other payment only with a before-cue ("upfront", "to hold", "before I post", "first") and no non-negated handover exclusion ("on pickup", "in person"); BT only in a payment clause; `kind` and `beforeCue` kept | design §2.2 L2 and notes; replaces `deposit_request` (`docs/packs/gpu-pc.md:44`) | starting value; row 1 is the negative case | yes |
| `platform_claim_text` | "Facebook delivery", "Meta Pay", "payment link"…, or a link whose host is not facebook.com, fb.com, fb.me or messenger.com | design L3 | starting value | no |
| `away_story_text` | "working away", "abroad", "can't meet"… | design W1 | starting value; row 3 fires | no |
| `off_platform_contact_text` | quote-redaction's phone or email detector, a non-Facebook link, or a messaging app; `contactKind` kept | design W2 | starting value; row 18's "@ BACK PANEL" never fires | no |
| `urgency_text` | "must go today", "lots of interest", "pay to hold"… | design W4 | starting value; 0 of 20 recorded rows | no |
| `thin_text` | a full description under 40 characters once Facebook's template text is removed | design W3 (shortest genuine recorded description: 56) | starting value | no |
| `viewing_offered_text` | "welcome to test", "arrange a viewing", "happy to power it on"… | design X1 | starting value; rows 3, 4, 7, 14 | no |
| `payment_on_collection_text` | "cash on collection", "bank transfer on pickup"…, not in a clause that demands a deposit | design X1 | starting value; rows 1, 14 | no |
| `protected_payment_text` | "PayPal goods and services", "pay by card", "pay on delivery"… (never bare "card") | design X2 | starting value | no |
| `box_only` | listing-assessment's `box_only` caution | the card | fixed by the card | yes |
| `mining_text` | mining, mined, hashrate, LHR unlocked ("rig" alone left out) | `docs/packs/gpu-pc.md:40` | starting value | yes |
| `untested_text` | untested, not tested, sold as seen… | `docs/packs/gpu-pc.md:41` | starting value; row 4 | yes |
| `not_working_text` | not working, doesn't work (not "if something doesn't work"), for parts, spares or repairs; `state` kept | `docs/packs/gpu-pc.md:47` | starting value | yes |
| `stock_phrasing_text` | "7-day return", "warranty on all", "we buy"… | the card; `dataset.json:3722` | starting value; row 11 | never (card) |
| `ask_far_below_similar` | ask ≤ 0.6 × the group median at n ≥ 10, in the group where it sits lowest; counted asks and outlier-cut asks only; not written when material-state wording explains it | `SELLER_DATA.md:85-87`; `docs/decisions.md:15` | starting value; shadow tests 0.7 and 0.8 | no |
| `low_ask_explained` | beside such an ask, one fact per reason: `not_working`, `for_parts`, `named_fault` (not "working or faulty"), `box_only`, `core_part_missing` (text, or an assessment exclusion of a core part with no part row), `part_not_included` (an exclusion on a part row) are material; `swap_or_trade`, `offers`, `cosmetic` are recorded and never explain | design §6.5 and P notes | starting value | no |
| Batch size | 500 listing IDs per batch and per event | rules 7 and 9 | fixed | |

Held back, as the card says: price-cut facts ("the previous price shown is above…"), any score,
photo reuse as the only evidence, seller keys. Postage-only is not re-detected, nor republished
(`docs/questions/warning-signs.md`). The survivor-bias pattern (cheap GPUs still listed are older,
45.9 days against 24.7; `PARTS_INTELLIGENCE.md:283-285`) is kept for shadow analysis only: no
rule reads how long a listing has been up.

## Fixtures and pass rate

Stage `evaluate` (`test/fixtures/evaluate.fixtures.ts`), 4 of 4 at the last recorded run
(`test/fixtures/pass-rates.json`). Each case seeds its listings into the upstream modules' own
tables (listing-ingest, detail-evidence, listing-assessment, asking-price-index) on the real
migrations in PGlite, runs `evaluate` as `nabvy_pipeline` and compares, per listing, the codes
`v_facts` shows.

- `recorded-run`: the whole recorded run (`fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k`),
  with the design's §2.4 expectations: X1 on rows 1, 3, 4, 7 and 14; row 1 never pay-first; row
  3 the away story; row 4 untested; row 11 stock phrasing only; rows 18 and 20 nothing.
- `pay-first` (synthetic, from the design's L2 notes): deposit to hold, negated exclusion,
  bare "bank transfer only", row 1's wording, friends and family, "no deposit", digit
  spellings, BT, "first come first served", pay on collection with a deposit, gift cards.
- `low-ask` (synthetic, one group of n = 12 and one of n = 9): a cheap ask explained by fault
  wording is not flagged; swaps, offers and cosmetics do not explain; the 0.6 boundary; n = 9;
  outlier-cut and sold asks; box only; a core part missing; trader boilerplate; spares or repairs.
- `text-facts` (synthetic): each text rule's positive and negative case, row 18's "@ BACK PANEL",
  Facebook and other links, partial and missing descriptions.

Other tests: `domain.test.ts` (every rule, its negatives and each threshold's boundary: 0.6, n
10, 40 characters), `idempotency.test.ts` (a replay writes nothing and keeps the key and done
time; a new version writes a new evaluation and clears the facts; a return to earlier inputs
reuses the earlier evaluation; an index update re-evaluates the group; over 500 refused;
erasure), `switch.test.ts` (off, paused pipeline, shadow, on, quote-redaction off,
listing-suppression off, a suppressed listing, `nabvy_app`'s reach), `contracts.test.ts` (view
rows and the event parse; Drizzle and contract keys match; the migrations' code lists match the
contract and `userFacingCodes`) and `packages/db/tests/warning-signs.test.sql` (grants, keys,
checks, latest evaluation, columns, codes, redaction, suppression, row policies, switch states,
the foundation's view check). No reader of this module exists yet, so "a reader's fixtures pass
with it off" waits for `suspected-labels`.

## Decisions

- **2026-09-26: an evaluation is the unit; the views show the latest.** The card's `facts` hang
  off an `evaluations` row keyed by the version, the card, the input hash (text, cautions,
  exclusions, and each group's key, `as_of`, ask, median and n: a cross-listing stage under rule
  8) and the rule version, so an evaluation that finds nothing clears earlier facts and a replay
  writes nothing. When inputs return to an earlier state, that evaluation's `evaluated_at` moves
  forward rather than a duplicate being written; that is the only update the pipeline role may
  make.
- **2026-09-26: one fact per code** (per reason for `low_ask_explained`), quoting the first
  matching clause; pay-first keeps the riskiest kind across clauses.
- **2026-09-26: quotes are the matching clause, redacted at write time** with quote-redaction's
  `redact()` and cut to 200 characters; offsets are the stored text's. The user-facing view
  passes them through `quote_redaction.quote()` again, so they fail closed with that module.
- **2026-09-26: a material-state explanation suppresses `ask_far_below_similar`** (the card's
  "not flagged"); swap, offers and cosmetic wording are recorded beside it and never suppress it.
- **2026-09-26: user-facing codes are a configured list** mirrored in the access migration; a
  test keeps the two equal (`docs/questions/warning-signs.md`).
- **2026-09-26: the done time is `found_at`**, the handler's hop time; T1 of the input is stored
  as `fetched_at` on the evaluation (rule 10).
- **2026-09-26: view rows are Zod in contracts**, as noise-filter's are; `contracts.test.ts`
  compares the keys with the Drizzle view declarations.

## Open questions

`docs/questions/warning-signs.md` (never `docs/questions.md` itself: `docs/session-conventions.md`).

## Incidents

None.
