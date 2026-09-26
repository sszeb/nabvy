# Questions — asking-price-index

- **Task:** asking-price-index, condition when the attribute and the text disagree. **Ambiguity:**
  the card says "the lower condition" but the text only says "used", not which used grade.
  **Option taken:** a "new" or "used, like new" attribute whose title or description says used
  (not "never used" or "unused") is grouped as `used_good`, Facebook's generic used grade; text
  never raises a condition. **Why conservative:** it keeps a used item out of the new group, where
  it would pull the new median down, and the lowest grade (`used_fair`) would overstate the damage.
- **Task:** asking-price-index, seller-key and seller-boosts (soft edges). **Ambiguity:** neither
  module exists, so there are no seller keys and no "Promoted" marks. **Option taken:** injected
  `IndexEvidence` with defaults that return none: every listing counts on its own account, no group
  is marked thin, nothing is left out as promoted. The thin share is set to one third as a starting
  value, since the brief says the share is not measured yet (SELLER_DATA.md:163-165).
  **Why conservative:** a missing key never hides an ask; the seam is ready for the modules.
- **Task:** asking-price-index, the worked example (PARTS_INTELLIGENCE.md:74-79). **Ambiguity:**
  the actor repository is not in this session, so the case could not copy the brief's figures.
  **Option taken:** a synthetic case with the example's shape (one card standalone, in PCs and in a
  bundle) that checks grouping and `v_implied`. **Why conservative:** it tests the rule without
  inventing the brief's numbers; the owner can swap in the real figures.
- **Task:** asking-price-index, the band label shown to users ("RTX 3090, on its own, used, good").
  **Ambiguity:** wording shown to users is a product decision. **Option taken:** item name, context
  and condition only, with no "worth", "fair" or position. **Why conservative:** it states facts of
  the group and nothing else (nabvy/docs/decisions.md:15).
- **Task:** asking-price-index, the country of a listing. **Ambiguity:** the card names `v_centres`
  but a listing's city page is not always a centre. **Option taken:** the country of the centre
  whose city page the listing is on, else of the centre whose search last found it; a listing with
  neither joins no group. **Why conservative:** no country is guessed from the currency.
- **Task:** asking-price-index, split-half stability tolerance. **Ambiguity:** the brief asks for
  the check (PARTS_INTELLIGENCE.md:386-388) but states no tolerance. **Option taken:** halves'
  medians within 25% of the group median, a starting value in the config. **Why conservative:** it
  is a test-time check only; nothing shown to users depends on it yet.
