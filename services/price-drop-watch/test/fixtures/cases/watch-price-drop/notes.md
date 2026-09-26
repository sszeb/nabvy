# watch-price-drop (synthetic)

Listing 1816901372840238 is £200 in the recorded run. A user watches it, then a later sweep
re-collects it at £150 (a real observed price, not invented). listing-ingest's `card-changed`
fires (the card hash changed), the price-drop-watch handler finds the active watch, reads
`listing_ingest.v_price_changes` and sees a real drop (20000 -> 15000), writes one `drops` row and
announces the watch once.
