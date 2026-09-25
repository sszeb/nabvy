# Recorded Stripe webhook events (synthetic)

The owner has not supplied Stripe test-mode keys yet (docs/questions/subscriptions.md), so no
event here was captured from a live `stripe listen`. Each file is a synthetic event built from
Stripe's documented object shapes for API version `2026-08-26.dahlia` (the version the pinned
`stripe` SDK 22.6.2 sends), trimmed to realistic fields, with placeholder IDs (`evt_Test…`,
`cus_TestC1`, `price_Test…`) and one test user. Replace them with captures from Stripe test mode
once the keys exist; the tests read only the fields in `SubscriptionsStripe*` contracts.

Prices map to the test ladder in `test/support/ladder.ts`: `price_TestStarter`, `price_TestPro`,
`price_TestProAnnual`; `price_TestExtraArea` is the extra-area price; `price_TestNotOnLadder`
is on no plan.
