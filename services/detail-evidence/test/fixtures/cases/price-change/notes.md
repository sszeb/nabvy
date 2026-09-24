# price-change

The card's test: a price change leaves the evidence hash unchanged
(fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:130-131; rule 8). The recorded rows are
collected again a day later (synthetic), with row 0's price cut from £200 to £150 and its status
set to pending. Price, availability and listing status are outside the allowlist: no new version,
no `changed`; 20 more fetches. The version's `last_seen_at` moves to the second run, and so does
its gallery link expiry (the second fetch carries a gallery: 104 hours after it).
