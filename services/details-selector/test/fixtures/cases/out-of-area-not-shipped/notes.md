The card: "selects every new listing ID that is in area, or offers shipping when an active want at
that centre accepts delivery ... out of area and not shipped is not [selected]". City page
`9999999999999999` is never in the seed, so city-pages adds it card-added with no coordinate of
its own; per city-pages' own decision, such a page's `v_area_membership` row always has
`centreId`/`distanceKm` null and `inArea` false, never guessed. The row keeps its recorded delivery
types (`IN_PERSON` only — no recorded run shows a shipping-offering listing;
`DETAILS_SELECTOR_SHIPPING_DELIVERY_TYPES` starts empty, docs/questions/details-selector.md), so it
is not selected as `shipped` either.
