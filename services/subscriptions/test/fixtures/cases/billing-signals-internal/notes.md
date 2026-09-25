# billing-signals-internal

A card fingerprint and a chargeback are recorded for the user. The pipeline (account-integrity's
role until per-module roles exist) reads one row in `v_billing_signals`; the web app's role
(`nabvy_app`, inside withUser for that very user) is refused on the view and on
`billing_events`, and may read only its own `entitlements` row (none yet: Free). The user's plan
(`getPlan`, the only user-facing output) carries exactly the plan fields: no signal, fingerprint,
Stripe ID or policy version.
