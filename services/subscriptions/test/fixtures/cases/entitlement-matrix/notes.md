# entitlement-matrix

One user through a subscription's life, one Stripe event at a time (docs/billing.md, "Flows"):
the Pro trial grants Pro (3 areas); converting to active with two extra-area items adds them
(3 + 2 = 5, docs/billing.md "plus extra-area quantity"); past due keeps Pro while Smart Retries
run; cancelling keeps Pro to the period end (docs/decisions.md, "No refunds": "access continues
until then"); deletion at the period end drops to Free (the test ladder's `free` row: 1 area).
The customer and Checkout events change no entitlement. Five changes, five
`subscriptions.entitlement-changed` events.
