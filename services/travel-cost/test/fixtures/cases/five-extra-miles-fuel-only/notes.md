# five-extra-miles-fuel-only

Same leg as `five-extra-miles`, but `valueOfTimePenceHour = 0` — the card's own "value of time
£0 handled" case ("the user can set £0, 'don't count my time'",
`docs/design/drafts/search-map-routes.md` §4.3). `resolveValueOfTime` returns `null`, so
`calculateTripCost` prices fuel only: `13 × 14 = 182` → **182p = £1.82**, matching the "fuel only
£1.82" reading of the card's 5-extra-miles worked number.
