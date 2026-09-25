Facebook's reported search centre for this run's "gaming pc" search is
`fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json:15-20`
(`searchControls.latitude`/`longitude`, Chichester, `radiusKm: 65`). The 20 points are each
listing's `locationCoordinates` field from `dataset.json` (one entry per listing in the run,
`provenance.locationCoordinates: "seo"`). `distancesKm` is `distanceKm(centre, point,
'coordinates').km` for each, in dataset order. `countOver65Raw` is the count with the
*unrounded* haversine distance over 65 km, matching the module card
(`docs/design/modules/location.md`, "Tests and fixtures"): "14 of 20 listings sit more than 65 km
from Facebook's reported centre (11.6-109.0 km)". location does not parse `dataset.json` itself
(that is listing-ingest's job); the coordinates are copied here as the fixture's input.
