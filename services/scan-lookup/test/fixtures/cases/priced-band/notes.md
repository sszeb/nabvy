# priced-band

A group with n=12 (>= the band minimum of 10, docs/decisions.md:15) at the beta's country and
currency (GB, GBP) prices the scan: one band, `facebook` as the only source queried (the MVP;
ebay-adapter, ebay-sold, cex-adapter and sold-price-book are off), and the scan is charged
`SCAN_LOOKUP_CREDIT_COST` (1) credit.
