# worked-rtx-5080

The brief's first worked example, listing `2756686961383848` (`fb-scrap-engine/docs/design/
PARTS_INTELLIGENCE.md:59-70`): a "Gaming PC" whose RTX 5080, 32GB DDR5 and 2TB NVMe are named in
the description only (`docs/fb-actor-reference.md`, section 8.3), and whose photos show an MSI
"GeForce RTX" card with no model (the photo-review card). Synthetic: the recorded run holds
neither worked example (`_rules.md`, rule 16), so the description is written to the brief's
facts over the recorded row `1783301919382894`, with the brief's listing ID. The photo verdict
comes through the injected seam (`photoVerdicts`), brand only: no catalogue ID, family only,
quoted by its photo ID. Expected: kind `pc` from the title; every part `offered` from the
description; the brand-only photo row beside the rules' resolved card without a conflict (a
family that agrees); `photo` version stamped.

The brand-only verdict carries no family: a brand is not a catalogue family, so it states nothing
the rules' resolved card can disagree with.
