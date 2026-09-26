# @nabvy/suspected-labels

Turn documented rules into labels marking listings with a suspicion (scam, trade seller, too good to be true), each with its evidence, review queue and correction route.

## Switch and priority

Off by default. While off: no labels are created or shown, and the review queue returns no rows. Scam labels and "suspected too good to be true" run in shadow mode first (`docs/design/modules/suspected-labels.md`), so wording and precision are measured before launch. Priority: First; shadow first; legal review before launch (`fb-scrap-engine/docs/HANDOFF.md:180-187`; critical path).

## Inputs

- **Events:** `warning-signs.found`, `copy-advert.clustered`, `seller-reply-reports.recorded`, `asking-price-index.updated`
- **Views:** `warning_signs.v_facts` (warning facts and codes), `copy_advert.v_listing_copy_facts` (copy spread), `seller_reply_reports.v_reports` (user-submitted reports), `asking_price_index.v_members` (price stats)
- **Functions:** from `switches` (`state`, `is_on`); from `audit-log` (`record`)

## Outputs

- **Event:** `labels.changed` v1 `{ listing_ids: string[] }`, emitted when new labels become published
- **Internal views (not yet implemented):**
  - `v_candidates` (pending candidates waiting for review approval)
  - `v_review_queue` (prioritized candidates for human review)
  - `v_calibration` (candidates with calibration reviews for precision measurement)
  - `v_shadow_metrics` (shadow mode metrics for precision and recall)
- **User-facing view (not yet implemented):** `app.v_suspected_labels` (listing_id, label_type, evidence, shown_at, report_mistake_path); shown labels only, filtered per-path mode and approval
- **Functions:** `getLabelsForListing(db, source, source_listing_id)`, `getCandidatesForListing(db, source, source_listing_id)`, `approveCandidate(db, candidateId, decision, by)`, `evaluateTgtbtSignals(signals, reportCount)`, `hasSignal(signal, signals)`

## Tables

Postgres schema `suspected_labels`. All tables created by the single migration file.

| Table | Keys | Unique constraints |
| --- | --- | --- |
| `rules` | `id` (PK) | `(label_type, rule_id, version)` |
| `evaluations` | `(source, source_listing_id, evidence_hash, rule_version)` (PK) | — |
| `candidates` | `id` (PK) | — |
| `approvals` | `id` (PK) | — |
| `labels` | `id` (PK) | — |
| `correction_requests` | `id` (PK) | — |
| `reviews` | `id` (PK) | — |

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Path A: two listing signals | Two independent signal types present | `too-good-to-be-true.md` §1 | Starting value |
| Path B: report + listing signal | ≥1 report + ≥1 non-price listing signal | `too-good-to-be-true.md` §1 | Starting value |
| Path C: multiple reports | ≥2 reports from independent accounts | `too-good-to-be-true.md` §1 | Starting value |
| Path B-P: report + price signal | ≥1 report + price signal only (review-only) | `too-good-to-be-true.md` §1 | Starting value |

## Fixtures and pass rate

Domain logic tested in `test/domain.test.ts` with 9 synthetic cases covering paths A, B, C, B-P and edge cases. Integration tests in `test/switch.test.ts` and `test/contracts.test.ts`. Pass rate: 12 tests passed (domain, contracts, switch).

## Decisions

- **2026-09-26:** Built core infrastructure for label system: seven tables (rules, evaluations, candidates, approvals, labels, correction_requests, reviews); contracts for all label types with discriminated unions by label_type; domain logic for too-good-to-be-true path evaluation with rules for combining listing signals and user reports; repo access functions for upsert, create, approve, query; placeholder event handlers for integration. Event name format `labels.changed`. Path evaluation order: A (two listing signals) → C (multiple reports) → B-P (report + price, review-only) → B (report + listing signal, shown) → null. All tests passing, linter and typecheck clean.

## Open questions

- 16, 35: Label wording, business logic and "Hide suspected" feature defaults (owner, `docs/questions.md`)
- Pending integration: full implementation of event handlers and views, fixture test cases from test hunt

## Incidents

None.
