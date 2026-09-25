# recorded-run

The whole recorded run `fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k` ("gaming pc",
Chichester), with parts-ai's recorded responses (copied from listing-assessment's case of the same
name). Every listing was found by "gaming pc", a generic term, so no term reason applies.

- Row 20, "Gaming pc / Builder and repair" (`dataset.json:6713`), a repair and build service at
  £25: `service` (title "Builder").
- Rows 11 and 12, priced headset sales (`dataset.json:3648,4003`): no reason. Row 11's description
  is trader boilerplate ("We buy and part-exchange consoles...", `dataset.json:3648`): the negative
  case of the buy-in rule; the actor's description pattern does not fire on it, and even if it did
  the phrase sits outside the first sentence. Their kind (`not_a_pc`) is spec-match's to apply, not
  a noise reason.
- Row 14, "Lenovo Legion Gaming PC" (`dataset.json:4734`): a desktop (parts-rules reads the family
  name beside "Gaming PC" and a desktop CPU as a PC), so not `laptop`.
- Every other row is a priced PC sale: no reason.
