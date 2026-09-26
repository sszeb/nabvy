# watch-unchanged-reword-no-alert (synthetic)

The card's fixture requirement: "an unchanged price across repeated sightings ... gives no alert"
(the brief's Romford listing, 11 captures over two days at one price). Reworded here as listing
1756692548940192, re-collected twice with only its title changed. Each re-collection still fires
`card-changed` (the card hash covers the title too), so the handler genuinely runs both times —
but `listing_ingest.v_price_changes` never has a row for this listing (its view excludes
`previous_minor = price_minor`), so there is no drop candidate to check, and nothing is written or
announced. The guard lives in listing-ingest's own view; this case proves this module's handler
does nothing with a real event that carries no real price change.
