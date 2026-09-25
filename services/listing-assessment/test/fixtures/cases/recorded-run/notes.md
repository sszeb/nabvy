# recorded-run

The whole recorded run (`fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k`), with
parts-ai's recorded responses (copied from `services/parts-record/test/fixtures/cases/recorded-run/input.json`,
themselves parts-ai's `test/fixtures/recordings/current.json`; none is live output).

- 18 of 20 listings are containers: 13 by parts (two of CPU, RAM and storage in the description
  or attributes, R1), 5 by the record's `pc` kind with fewer parts named. The two headsets
  (`2126837844711748`, `1154042653756525`, kind `not_a_pc` from the model) are placed, not
  containers, form `unknown` (no offered part).
- Bundles (R1c): `1775698700306989` (title: monitor, KBM), `1639721697586478` ("comes with
  everything pictured desk, gaming chair, … mouse, … mouse pad, … monitor"), `1352645884594841`
  and `1083674317719227` (keyboard and mouse "included" / "comes with"), `1783301919382894`
  ("Comes with; -Logitech mouse -Corsair k70 keyboard -LG 34inch … monitor"), `1380502417485603`
  (monitor in the title; "This dose not include HDMi lead or keyboard or mouse" leaves those
  out). Left out as not in the sale: `1756692548940192`'s "monitor to sell with it if needed",
  `2005582460147017`'s "headset and … keyboard and mouse for extra", and `1716871313386322`'s
  "Desk 119%" (a benchmark score).
- GPU: `named` wherever an offered GPU is quoted; `not_stated` for the three PCs with no GPU in
  text (`1639721697586478`, `1380502417485603`, `2537899006714740`): silence is never "none".
- `1072745435569624` displays a previous price: `previous_price`, a fact only.
- `1083674317719227`'s "I can include 300GB extended storage for an extra £20" is the record's
  `not_included` storage row: an exclusion, and storage stays an unknown.
- Every quote in `confirmed` is verbatim at its offsets in a fresh, `full_verified` text, with a
  clean sentence-clipped context of 80 characters.
