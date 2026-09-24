# five-extra-miles

The card's worked number: "5 extra miles: 13 road miles and 22 minutes, £6.54 (fuel only £1.82;
HMRC rate plus time £11.87)" (`docs/design/drafts/search-map-routes.md` §4.2). This case is the
default (fuel-only preset, time included): `fuelPence = 13 × 14 = 182`,
`timePence = (22.2857 ÷ 60) × 1271 ≈ 472.06`, total `≈ 654.06` → **654p = £6.54**. The other two
readings in the same worked line are `five-extra-miles-fuel-only` and
`five-extra-miles-business-rate`.
