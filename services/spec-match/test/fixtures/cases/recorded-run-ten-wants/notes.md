# recorded-run-ten-wants

Ten real wants over the stored data: every listing of the recorded run
`2026-09-24-VkryjpwS6U2GBDh3k` (20 listings, "3090" and "gaming pc" searches around Chichester),
counting what descriptions add (`fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:167-168`). No
edits: the recorded rows as collected, parts-ai with no responses (no model call succeeds), every
point at Chichester.

The wants are eight GPU families (RTX 3090, RTX 3090 Ti, RTX 5060, RTX 5070, RTX 3070, RTX 2070
Super, GTX 1660, GTX 970), 32GB DDR5 RAM and 1TB storage. Counts at the first run: 19 matches, 8 of
them (RTX 5070 1, RTX 3070 1, 32GB DDR5 1, 1TB 5) quoted only from the description, so a
title-only matcher would miss 42% of them. The RTX 3090 want matches nothing: the run's only 3090
is a 3090 Ti, a different card. The GTX 970 want matches nothing: the catalogue does not name that
card, so parts-record carries no catalogue ID and the rules cannot tell (never a "no").
