# webhook-replay

Each event is delivered twice, as Stripe does on a timeout. The second delivery of an event ID
writes nothing (docs/billing.md, "Tests": "same event twice → one change"): one billing event per
ID (3 rows for 3 IDs), one allowance grant for the renewal invoice, one top-up grant for the
payment, one `entitlement-changed` event.
