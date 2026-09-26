# Questions — asking-price-position

- **Task:** asking-price-position, the worked example's "9800X3D + RTX 5080 PCs of any condition,
  n=12" (PARTS_INTELLIGENCE.md:74-79). **Ambiguity:** asking-price-index keys each group by one
  catalogue item and one condition, so there is no "any condition" group and no group for a PC's
  whole spec. **Option taken:** position each listing in every index group it belongs to (for a PC,
  one per offered part), within one condition; the fixture reproduces the example's figures (n = 12,
  29th percentile, shown; like-new n = 6, hidden) inside that grouping. **Why conservative:** it
  adds no grouping the index does not publish, and a narrower group only hides more positions.
- **Task:** asking-price-position, "with context where a new build asks the same"
  (HANDOFF.md:189-190). **Ambiguity:** the card's user-facing column list has no column for it, and
  wording shown to users is a product decision. **Option taken:** the same item's `new` group
  median and n are kept in `v_positions` (`new_median`, `new_n`) when that group has n ≥ 10; the
  user-facing view keeps exactly the card's columns. **Why conservative:** nothing new is shown to
  users until the owner words it.
- **Task:** asking-price-position, when positions are refreshed. **Ambiguity:** the card consumes
  only `asking-price-index.updated`, which fires when a group's figures change; an ask that changes
  without changing the figures (for example an outlier's) does not trigger a re-position.
  **Option taken:** as the card says; the stored position keeps the old ask until the group's
  figures next change. **Why conservative:** it reads no event the card does not name; a sweep or
  a `listing-ingest.card-changed` consumer can be added if the owner wants it.
