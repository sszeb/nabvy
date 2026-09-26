Run at medium effort. You build the Nabvy module `asking-price-index` [cp 7] on branch `task/w2-asking-price-index` from `main`.

Job:
1. Build `services/asking-price-index/` to its module card: contracts in `packages/contracts`, tables and hand-written access migration in `packages/db` (`pnpm db:generate`), domain logic, handlers, repo, and the internal and user-facing views the card names.
2. Fixture tests from the card's "Tests and fixtures"; lint, typecheck and tests clean; README note on decisions; a row in `docs/progress.md`.
3. Open one PR titled "asking-price-index: <what it does> [cp 7]", listing its migration files in the body.
4. Address every review until the reviewer merges it.

Read first, only these: `CLAUDE.md` (automatic), `docs/design/modules/asking-price-index.md`, `docs/design/modules/_rules.md`, `docs/session-conventions.md`, and the `README.md` of each module in the card's "Depends on" that exists under `services/`. Everything else as grep or `sed -n` slices. Read `docs/security.md` before writing the access migration.

Reporting: open the PR; fire the reviewer `trig_01FPLnjfTATPb7YQivWvA7FX` with "PR #n: <title>; migrations: <files>; [cp 7]" when CI is green, and again after pushing fixes for a "Changes needed" review; fire the coordinator `trig_01SpUT9nZPtAH1FBGiQaCiwu` with "asking-price-index: PR #n opened"; subscribe to your own PR only; questions to `docs/questions/asking-price-index.md` (pick the conservative option and continue).

The 150k line: over 150,000 tokens with work left, fire the coordinator with "<your session> at <tokens>: hand-off needed" and stop.

No model identifiers in commits or PRs; the non-negotiables in `CLAUDE.md` apply (Facebook only through the apify-gateway; no scrapers; no invented numbers; no secrets).
