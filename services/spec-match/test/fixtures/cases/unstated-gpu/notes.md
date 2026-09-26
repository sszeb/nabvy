# unstated-gpu

"An unstated GPU is never `no_match`" (card, "Tests and fixtures"). A want for 16GB RAM and an
RTX 5060 against three synthetic edits of recorded rows:

- `2264485254402498`: title "Pc", description with CPU, RAM and SSD and no GPU at all. The GPU is
  `not_stated` (`not_named`): silence, never a "no".
- `1072745435569624`: its RTX 2070 Super is in the title, but the description is marked `partial`.
  Another card is named, yet partial text can never give `no_match`: `not_stated`
  (`partial_text`) (`fb-scrap-engine/README.md:223-241`).
- `1123980543398026`: a full description that says "no graphics card included". Positive
  evidence over `full_verified` text: `no_match` (`excluded`), quoted from listing-assessment's
  GPU state.
