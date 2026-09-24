# price-change (synthetic)

Built from the recorded run: the second run is the same rows with listing 1816901372840238 at
`money.amountMinor` 18000 instead of 20000 (a £20 cut). Expected: one `card-changed` for that
listing, the listing now at 18000, and one row in `v_price_changes` (20000 → 18000).
