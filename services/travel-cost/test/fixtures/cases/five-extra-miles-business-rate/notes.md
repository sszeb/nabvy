# five-extra-miles-business-rate

Same leg as `five-extra-miles`, with the `hmrc-business` preset: the mile rate resolves to the
seeded `approved-mileage-rate` standard-tier row (55p/mile, from 6 Apr 2026) instead of the
advisory fuel rate; time is still included at the default value of time (£12.71/hour).
`fuelPence = 13 × 55 = 715`, `timePence ≈ 472.06`, total `≈ 1187.06` → **1187p = £11.87**, matching
the "HMRC rate plus time £11.87" reading of the card's 5-extra-miles worked number.
