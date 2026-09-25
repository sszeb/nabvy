# not-included-gpu

The card's test: "RTX 4090 not included" is demoted (`fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:179-180`).
Synthetic, built from recorded row `28242423458759790` (a short spec list) with its description
rewritten to add the line "RTX 4090 not included, it goes in my new build.". parts-rules reads
the card as `not_included`, so the assessment lists it as an exclusion (positive evidence, R6),
the GPU state is `none`, the card is never confirmed, and GPU is not an unknown. The spec lines
around it are confirmed: the clean context is clipped to each line.
