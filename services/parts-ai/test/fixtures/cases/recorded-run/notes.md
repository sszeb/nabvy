# recorded-run

All 20 listings of `fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/`, through
parts-rules (rule version of this branch) and then this module with the recorded responses in
`test/fixtures/recordings/current.json` (written for this prompt version; no Anthropic key exists
yet, so the responses are what a careful model states from each text, and nothing more).

- 12 versions have gaps, 8 are settled by the rules and never reach the model.
- `1073353648648306`: RAM is stated only as a Corsair part code; the quote is stored, no size is
  invented from the code.
- `1083674317719227`: "Geforce RTX graphics card" and "AMD64 processor" name no model, so no
  catalogue ID; the 300GB drive costs "an extra £20", so it is `not_included`.
- `1154042653756525`, `2126837844711748`: headsets; the model settles the kind the rules left
  in conflict as `not_a_pc`, quoting the title.
- `1397200465308431`: "Amd Ryzen 7700x" resolves to the Ryzen 7 7000 series (the quote bears
  out 7700).
- `1775698700306989`, `1816901372840238`: GTX 970 and i7-4790 are not in the catalogue: stored
  with their quotes and no ID, never another item.
- The rest state nothing more ("specs in video", "specs shown in picture", services advert).
