# recorded-run

All 20 listing rows of the recorded run `VkryjpwS6U2GBDh3k` (`fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/`), every one
`full_verified`. Expected output was read against each description by hand:

- Every GPU and CPU quote is the model the seller names; catalogue IDs come from
  product-catalogue's seeded dictionary (`resolve()`), AMD CPUs as their series.
- `1397200465308431`: "ram Msi gaming trio 12gb 5070" is the card's memory, so the only RAM
  sizes are "32gb ddr5" and "2x16gb"; "7700x" is not in the catalogue (`cpu:unresolved`).
- `1816901372840238` and `1775698700306989`: the GTX 970 and i7-4790 are older than the
  catalogue (`unresolved`), not guessed.
- `2264485254402498`: "8GB GDDR7" is graphics memory, never system RAM.
- `1154042653756525` and `2126837844711748` (headsets "for PC"): the title has both a PC word
  and a not-a-PC word, so the kind is left open (`gap:conflict`).
- `1403975981250476`: "Lenovo Legion Gaming PC" is a desktop (`fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:4734`).
- `1073353648648306`: the RAM line names a part number only, so RAM size is `not_stated`.
