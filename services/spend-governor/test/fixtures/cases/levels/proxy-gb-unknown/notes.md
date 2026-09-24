# proxy-gb-unknown

Synthetic, built from the seeded budgets (packages/db/migrations/spend-governor) and the throttle steps of actor-integration.md 2.12.

A settled run whose proxy traffic cannot be read makes the proxy budget unmeasured (committed null, level none); the money budgets still bind. Today every run reads this way, because apify_gateway.v_jobs does not publish the run's proxy GB (docs/questions/spend-governor.md).
