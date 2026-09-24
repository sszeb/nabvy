# fixtures

Real listings with hand-labelled facts and values, laid out as in `docs/fixtures.md`. The layout and
runner arrive in task 0.6.

## Contract samples

`contracts/core/` holds samples for the shared contracts and `contracts/<module>/` for each
module's. Files are named `<Export>.<case>.json`, and rejected samples go in `invalid/`.
`packages/contracts/test/fixtures.test.ts` round-trips them all (`packages/contracts/README.md`,
"Fixtures").

## Recorded provider runs

`listings/facebook/runs/<date>-<apifyRunId>/` holds one whole recorded actor run (`input.json`,
`dataset.json`, `run-summary.json`, `run.json`, `README.md`). A Facebook "raw response" is a run, so it
is kept whole. The per-listing folders in `docs/fixtures.md` (`stub.json`, `detail.json`, `raw.json`,
`expected.json`) are cut from these runs once the adapter (1.1) and labels exist.

Recorded runs are exported only through `apify_gateway.redacted_items` in Supabase, and only after
`apify_gateway.redaction_leaks` returns nothing (`supabase/README.md`). Seller identity, Facebook
media links and contact details never enter this folder;
`services/source-adapters/test/facebook-run-fixture.test.ts` fails if they do.
