# inclusion-cases

The three recorded-run inclusion cases the card names (`…/dataset.json:2244,5464,5779`):

- `1783301919382894` "Gaming PC": a full spec list, then "Comes with; -Logitech mouse -Corsair
  k70 keyboard -LG 34inch curved ultra wide monitor". The extras that come with the PC are not
  part types any input extracts (question in `docs/questions/parts-record.md`), so they leave no
  row; every core part is `offered`, and the rules leave no gap, so parts-ai is not called
  (`ai: null`).
- `1083674317719227` "HP Omen gaming pc": "I can include 300GB extended storage for an extra
  £20" is an optional paid extra, recorded by the model as `not_included`; the record keeps it
  so, beside the offered RAM (rules), CPU and GPU (AI, brand only: "Geforce RTX graphics card"
  names no model, so no catalogue ID).
- `1380502417485603`: "This dose not include HDMi lead or keyboard or mouse": none is a part
  type, and the text names no part, so the record has a kind (`pc`, from the title), both
  versions and no parts. Nothing is invented.

The AI responses are parts-ai's own recordings for these listings (synthetic).
