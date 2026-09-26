# sale-once-per-invoice

A replayed `invoice.paid` webhook for the same invoice tracks the Dub sale once: the second call
still reports `trackedSale: true` (this user carries an attribution) but writes no second
`partner_events` row. `partnerEventsCount` is 2: one lead (from capture) and one sale.
