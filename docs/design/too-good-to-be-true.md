# Too good to be true: design summary

**Status:** condensed from `docs/design/drafts/too-good-to-be-true.md` (about 155 KB), 2026-09-24, for the coordinator and the owner. The draft is notes, not decisions: the items below are the engineering/architecture calls this design makes. Anything product-facing (wording shown to users, defaults, categories) is left as an owner question in `docs/questions.md`, not settled here.

## One-screen summary

Mark a listing **"Suspected too good to be true"** when a documented rule finds **two independent pieces of evidence** that the item isn't really where the advert says, collection is refused, or money is wanted before the buyer sees it — the owner's Isle of Wight / Chichester examples. Evidence comes from the listing itself, read from modules that already own it (`pickup-location`, `copy-advert`, `asking-price-index`/`asking-price-position`, `warning-signs` — no new detector), and from a new one-tap buyer report filed after messaging the seller (`seller-reply-reports`, filling in its existing placeholder card). The mark:

- attaches to the **listing**, never the seller; shows no score and no seller identity;
- never hides a listing or holds an alert by itself (the only wait is a gem-candidate evaluation, up to 2 minutes, which sends the alert regardless of the result);
- needs 2+ independent signals via one of three live paths — **A** two listing signals, **B** a report plus a listing signal, **C** reports from independent people — plus a review-only path **B-P** (report plus price alone), which never runs automatically;
- ships in **shadow** during the rtx3090 test hunt, then per path `shadow → reviewed → on`, gated on precision targets (≥90% on 30 reviewed cases, 0 false marks in 300).

Listing-only recall is expected to be very low: 0 of 20 recorded listings carry any listing-level signal. Reports are the main channel for cases like the owner's own two examples, which surface only in chat.

## Decisions this design takes (not product matters)

- **Read, never re-detect.** Every listing signal is read from the module that already owns it; `suspected-labels` only combines what they publish. No new detector modules.
- **Two-independent-pieces rule** for every path; price is never the sole second piece for a report; price alone, copies alone, or one report alone never marks.
- **`seller-reply-reports` is the report-intake module**, replacing the catalogue's placeholder card in full: gated on `notifier`'s open record (5 min–14 days after the user opens the listing), a Beta-reputation reporter weight (account age × upheld/not-upheld accuracy), one report per person via `account-integrity.linkedGroupOf()` (extended to cover a shared device cookie or network, not just email/card), spreading counted reports across confirmed `copy-advert` clusters, no free text in version 1, purge on account deletion.
- **`suspected-labels` gains a per-path mode machine** (`shadow` / `reviewed` / `on`) with new `evaluations`, `candidates`, `approvals`, `correction_requests` and `reviews` tables; its old `reports` table moves out to `seller-reply-reports`.
- **Sticky text signals.** Once a listing-text signal fires it stays `yes` for that listing's life; an edit that removes it after a mark has shown goes to human review rather than silently clearing the mark.
- **Abuse resistance is mechanical, not discretionary**: burst holds (3 reports/24h at any account age; 2/6h on a gem candidate), counter-report holds, a report-then-buy exemption, linked accounts collapsed to one at the lowest weight, and rate limits — all marked "starting value", to calibrate in shadow.
- **Promotion gate.** A gem candidate (an ask far below comparable asks) is evaluated against these rules before it is promoted to top picks or "while hunting we also found"; the evaluation can delay that promotion by up to 2 minutes but never delays or suppresses the alert itself.
- **Idempotency, batching and T-stamps** follow the shared module rules: both new/changed modules are cross-listing stages with input-hash-based idempotency keys, take arrays of up to 500 listing IDs, and sit outside the T0–T7 chain, recording their own `done_at`.
- **New `output-guard` checks**: a banned-wording list ("scam", "worth", "fair", "market price", …), no report-derived place/distance/kind shown below 3 agreeing reporters, no report count under 10, no seller field, no unexplained score, no reliance on the unverified `shippingOffered`/checkout flags in user-facing text.
- **Calibration plan.** Two reviewers label test-hunt listings blind to each other; report-path precision is measured only on evidence that arrived independently of the reports that formed the candidate, because Nabvy never sees the chat itself.

## Modules this design defines or changes

Every module below already has a `docs/design/modules/index.json` entry; this design adds **no new module**. (`pickup-location` is a dependency designed in a separate document not covered by this design's reading list, and is out of scope here.)

- **`seller-reply-reports`** (fills in the existing placeholder card) — one-tap report intake, eligibility and weighting, cross-copy spreading, evidence publishing; 6 owned tables, 5 views, no free text.
- **`suspected-labels`** (changed) — adds the `too_good_to_be_true` label type: 3 live paths plus 1 review-only path, per-path mode, new tables and views; its `reports` table is superseded by `seller-reply-reports`'s.
- **`warning-signs`** (changed) — new fact codes (`pay_first_text` replacing `deposit_request`, `platform_claim_text`, `away_story_text`, `off_platform_contact_text`, `urgency_text`, `thin_text`, `viewing_offered_text`, `payment_on_collection_text`, `protected_payment_text`); an expanded `low_ask_explained` reason list.
- **`copy-advert`** (changed) — `v_listing_copy_facts` gains a `text_copy_spread_km` column; a new reader grant for `seller-reply-reports`.
- **`notifier`** (changed) — records opens for card and pasted-link surfaces, not only alerts; renders the mark, report buttons and correction link; edits sent Telegram alerts when a mark is removed.
- **`want-manager` / `spec-match` / `alert-router`** (changed) — new preference keys ("Hide suspected", an alert opt-out) and their application, including the gem-candidate alert wait.
- **`listing-feedback`** (changed) — a new internal view `v_bought_for_reports`, granted only to `seller-reply-reports`, for the report-then-buy abuse exemption.
- **`account-integrity`** (changed) — a new exported `linkedGroupOf()` (now covers a shared device cookie or network, not only email/card), new report-abuse rules, shadow first.
- **`review-console`** (changed) — new queues: approvals, correction requests, sub-threshold reports, burst/counter-report holds, carried relist reports, blind calibration labelling.
- **`output-guard`** (changed) — new checks specific to this label type.
- **`ops-metrics`** (changed) — reads two new shadow-metric views; reader only.
- **No change identified** to `listing-suppression` (used as-is: fail-closed, `is_suppressed()`) or `listing-card` (a separate surface from the deal-card chip this design adds).

## What stays open

27 owner decisions — label and evidence wording, alert defaults, the "Hide suspected" default, whether report-plus-price (B-P) ever shows automatically (default: never), retention, whether to pool condition groups for the price signal, business-export inclusion, an internal seller-level review rollup, and more — are written to `docs/questions.md`, each with the conservative default taken until answered. 19 new points for legal review (added to `docs/legal-review.md` from item 23) cover the mark's wording, storing and counting user reports, linking accounts across a device or network, the public report-a-mistake form, and the test hunt team's own contacts with sellers. Staged go-live (shadow → reviewed → on) is per path, and path B-P never leaves review.

`docs/decisions.md` changed on disk after this design's Precedence check; re-verify no new conflict there before applying the card amendments below.
