# Open questions: parts-record

- **2026-09-25, w2 parts-record: the photo-review seam (soft edge).** The card's inputs include
  `photo-review.reviewed` and `v_verdicts`; photo-review does not exist yet
  (`docs/design/modules/soft-edges.json`). Option taken: `record()` takes an injected
  `photoVerdicts` function over the batch's listing versions, typed by `PartsRecordPhotoVerdict`
  (part type, catalogue ID or brand-only, the photo ID as the quote, a photo-review version); the
  default returns none, so `photo_version` stays null and no photo part exists. When photo-review
  ships it supplies the function over its `v_verdicts` and its `reviewed` event calls `record()`.
  Conservative because a photo never read is "not stated", never "no", and nothing is invented.
- **2026-09-25, w2 parts-record: the kind's values.** The card names the kinds as a standalone
  part, a desktop PC, a laptop, or a wanted or swap advert; parts-rules and parts-ai settle
  `wanted_or_swap`, `laptop`, `pc` or `not_a_pc`, and the brief says derive, never retype. Option
  taken: `PartsRecordKind` is `PartsRulesKind`; a standalone part (a card sold alone) is not
  told apart from `not_a_pc` until an input states it. Conservative because inventing a fifth
  value with no extractor behind it would leave it always empty.
- **2026-09-25, w2 parts-record: parts the inputs do not extract.** The card lists cooler, case
  and extras among the parts; no input names them (parts-rules' eight part types are GPU, CPU,
  RAM size and generation, storage size and type, PSU wattage and chipset). Option taken: the
  record's part types are the rules' (`PartsRecordPartType` is `PartsRulesPartType`); extras
  that "come with" the PC and accessories "not included" leave no row (the `inclusion-cases`
  fixture shows it). Conservative because a row for a part nobody extracted would be a guess.
- **2026-09-25, w2 parts-record: `v_items` is read for families only.** The card lists `v_items`
  as an input without saying what for. Option taken: the family of each resolved catalogue ID,
  used to tell "RTX 3080" (unresolved, family only) from "RTX 3080 10GB" (resolved) as one card
  and "RTX 3080 Ti" as another; nothing else is read from it, and with product-catalogue off no
  conflict is flagged. Conservative because the record never drops or alters a catalogue ID on
  the catalogue's account.
- **2026-09-25, w2 parts-record: what conflicts.** The card records a conflict "when rules and AI
  disagree". Option taken: among offered parts of one type, different catalogue families or IDs,
  or different RAM, PSU or chipset values, from any pair of extractors (the rules against
  themselves too); storage never conflicts, since a PC holds several drives; mentions,
  not-included and brand-only rows never conflict. The recorded run has 0 conflicts. Conservative
  because a flag is a fact for readers, never a decision.
- **2026-09-25, w2 parts-record: no deduplication.** A part named twice (by the rules in title
  and description, or by the rules and the model) is two rows. Option taken: keep every row with
  its own quote and position; readers group by part type and catalogue ID. Conservative because
  the record is the evidence; merging rows would hide which extractor said what.
