Consent gate, negative case: `analytics_consent = false` still writes the first-party
`product_events` row (`docs/analytics.md`, "None needed: service data, minimised, no third
party") but never calls the forwarder.
