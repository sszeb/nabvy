# unsettled-at-reservation

Synthetic, built from the seeded budgets (packages/db/migrations/spend-governor) and the throttle steps of actor-integration.md 2.12.

- The recorded run's reservation, $0.3363, with its reading at finish, $0.0003, as the provisional cost (fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run.json): counts 336 300.
- An unsettled call whose provisional cost ($1.50) passed its reservation ($1.00): counts 1 500 000.
- An unsettled call made last month (21:00 BST on 31 August, before the London month began at 23:00 UTC): still unsettled, counts 200 000.
- A settled call from last month (22:30 UTC, 23:30 BST on 31 August): not this month, counts 0.
- A model call: not an Apify budget, counts 0.
- Gateway runs not yet in the ledger: queued $0.50 counts 500 000, refused counts 0, running at $0.45 against a $0.30 reservation counts 450 000.

Total 336 300 + 1 500 000 + 200 000 + 500 000 + 450 000 = 2 986 300.
