# checkout-needs-start-now

Without the "Start my plan now" tick no Checkout opens: the procedure's `startCheckout` refuses
a missing or false tick, and the Stripe plugin's own Checkout endpoint (reached directly, skipping
the procedure) refuses a request without the tick time in its metadata. With the tick both pass.
When a completed Checkout arrives without consent (Stripe's required tick not accepted, no tick
time), the payment is still recorded with `consent_start_now = false` and ops gets
`subscriptions.webhook-failed` (`consent_missing`); a normal completion stores the tick and the
time the user ticked, matching the session.
