# chargeback-reverses

A dispute claws back the tracked commission once; the same dispute event replayed (Stripe's
retries) reverses nothing a second time. `partnerEventsCount` is 3: lead, sale, reversal.
