The recorded run's 20 listing rows carry 18 distinct Facebook city pages
(`sourceFields.search.location.reverse_geocode.city_page.id`, as listing-ingest's `v_listings`
reads it). 16 of the 18 are in `services/city-pages/city-pages.seed.json`; two are not:

- `103764492995711`, reverse-geocoded `city: "Chessington"`, `city_page.display_name:
  "Chessington"` (`dataset.json`, the Chessington row).
- `104111572957977`, reverse-geocoded `city: "Poole"`, `city_page.display_name: "Upton, Dorset"`
  (`dataset.json`, the row at index holding the Poole/Upton pair).

`newCityPagesFrom` never parses names or town slugs (rule: `fb-scrap-engine/docs/EVIDENCE_LEDGER.md:32-38`):
it only ever sees listing-ingest's `town_label`, which is the raw `reverse_geocode.city` string,
not the city page's `display_name`. So the added row for `104111572957977` is named "Poole", not
"Upton, Dorset" — the card's own example: "a card labelled 'Poole' belongs to the city page
'Upton, Dorset'" (`docs/design/modules/city-pages.md`). This module has no independent source for
the canonical name and does not guess one.
