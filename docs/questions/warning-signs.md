# Questions: warning-signs

- **2026-09-26, task w2 warning-signs: which codes users see.** The card calls the facts "neutral
  facts for users" but names only stock phrasing as internal, and the too-good-to-be-true design
  proposes `thin_text` as user-facing and every other new code as internal until calibrated.
  Option taken: `app.v_warning_signs` shows `pay_first_text` (catalogue question 18, answered
  "yes" by the design pending wording), `box_only`, `mining_text`, `untested_text` and
  `not_working_text`; `ask_far_below_similar`, `low_ask_explained`, `thin_text` and every
  too-good-to-be-true support or counter code stay internal (`userFacingCodes` in
  `packages/config/src/modules/warning-signs.ts`, and the same list in the access migration).
  Conservative because a price or thin-text statement shown to users needs the owner's wording,
  and adding a code later is one list change. Needed from the owner: the list, and the wording
  of each shown fact.
- **2026-09-26, task w2 warning-signs: postage-only is not republished.** The card and design
  §6.5 say postage-only is read from `pickup-location`'s handover flags and republished here, but
  `pickup-location` is not on the card's "Depends on" line. Option taken: no postage-only fact;
  readers take it from `pickup_location.v_handover` directly. Conservative because it adds no
  unlisted dependency and duplicates nothing. Needed: add the edge to the card, or confirm.
- **2026-09-26, task w2 warning-signs: `v_suppressed` is not read.** The card lists
  `listing_suppression.v_suppressed` as an input. Option taken: facts are computed for every
  listing (internal) and the user-facing view hides suppressed listings with `is_suppressed()`,
  as noise-filter does. Conservative because suppression then always applies at read time,
  including to entries added after the facts were written.
- **2026-09-26, task w2 warning-signs: an `evaluations` table beside the card's `facts`.** Without
  a record of each evaluation, an evaluation that finds nothing could not clear the facts an
  earlier one found. Option taken: one `evaluations` row per (listing, evidence hash, card hash,
  input hash, rule version), with `facts` hanging off it; the views show the latest evaluation's
  facts. Conservative because it keeps the card's `facts` columns and only adds the module's own
  bookkeeping.
- **2026-09-26, task w2 warning-signs: a far-below ask explained by material-state wording.** The
  card's test says such an ask "is not flagged"; the design's P reads the pair of facts. Option
  taken: with material-state wording (not working, for parts, named fault, box only, core part
  missing, part not included) no `ask_far_below_similar` fact is written, only
  `low_ask_explained` with each reason; with only swap, offers or cosmetic wording both are
  written. Conservative because a cheap faulty item is never presented as "far below".
- **2026-09-26, task w2 warning-signs: outlier-cut asks are compared.** asking-price-index
  excludes asks outside its Tukey fences, which is exactly where a far-below ask sits. Option
  taken: members that are counted, or excluded only as `outlier`, are compared with their group;
  every other exclusion (noise, sold, suppressed, copy, relist…) is not.
- **Legal points listed, not reviewed** (`docs/legal-review.md`): storing redacted quotes of
  payment and contact wording as internal evidence; showing "asks for payment before viewing" as a
  neutral fact on a listing.
