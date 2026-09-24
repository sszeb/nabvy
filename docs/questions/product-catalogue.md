# Open questions — product-catalogue

Per-module questions file (`docs/session-conventions.md`): a build session writes its owner
questions here, never to `docs/questions.md`, so parallel module pull requests never conflict over
one shared file. Format: date, task, question, option taken and why. A human reviews at each
check-in and moves answers into `docs/decisions.md`.

- **2026-09-24, w1 product-catalogue: who may write the catalogue.** The card's `Inputs` line says admin edits are audited, but as with `switches` and `audit-log`'s `v_entries`, the database has no admin check for `nabvy_app` yet, and no admin procedure calling `addItem`/`addAlias`/`addNegativeContext`/`addCode` exists. Option taken: only `nabvy_pipeline` may write `product_catalogue`'s tables or read its views (the same interim choice `services/switches` made); the future admin procedure checks the session and calls these functions inside `withPipeline`, and every write is still audited as the real admin through `@nabvy/audit-log`. Conservative because no signed-in session can change the catalogue through the database.
