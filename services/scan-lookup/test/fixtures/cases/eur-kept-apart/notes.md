# eur-kept-apart

A qualifying group exists (n=15) but in Ireland/EUR, and the beta is UK-only, GBP-only
(docs/decisions.md, Precedence, "Region and currency"). scan-lookup filters to
`SCAN_LOOKUP_COUNTRY`/`SCAN_LOOKUP_CURRENCY` (GB/GBP), so this group is never surfaced and the scan
reads "not enough asks" rather than converting or mixing currencies (asking-price-index itself
never mixes GBP and EUR asks into one group; this module never mixes them into one answer either).
