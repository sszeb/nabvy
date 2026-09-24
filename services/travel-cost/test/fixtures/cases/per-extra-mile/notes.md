# per-extra-mile

The card's own worked number: "Per extra straight-line mile: 2.6 road miles there and back, 4.5
minutes, 36p of fuel, £1.31 in total" (`docs/design/drafts/search-map-routes.md` §4.2).

Leg: `roadMiles = 2 × 1.3 × 1 = 2.6`, `minutes = (2.6 ÷ 35) × 60 ≈ 4.4571` (the config defaults,
`c = 1.3`, `v = 35 mph`).

Default settings (no `user_travel_settings` row): preset `fuel-only`, fuel `petrol`, engine band
`1401-2000`, no value-of-time override — so `tripCost` prices the leg at the seeded advisory fuel
rate (14p/mile, from 1 Mar 2026) plus the seeded value-of-time rate (£12.71/hour, from 1 Apr 2026).

`fuelPence = 2.6 × 14 = 36.4`; `timePence = (4.4571 ÷ 60) × 1271 ≈ 94.43`; unrounded total
`≈ 130.83`, which rounds once to **131p = £1.31**.
