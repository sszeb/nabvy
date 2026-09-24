# fixtures

Real listings with hand-labelled facts and values, laid out as in `docs/fixtures.md`. Every
extraction, valuation or risk change runs against them and must keep each stage's pass rate at or
above the previous recorded run (`CLAUDE.md`, "Fixture-first").

## Layout

```
fixtures/
  contracts/                     sample objects for every schema in docs/contracts.md (task 0.2)
  listings/<source>/<id>/        one listing: stub.json, detail.json, expected.json; raw.json and photos/ optional
  listings/<source>/runs/<run>/  one whole recorded provider run (below)
  scans/<id>/                    photo.jpg, expected.json, barcode.txt optional
  series/<productKey>.json       a price series for Price Book tests
```

`runs` is reserved: it is never a listing ID. `expected.json` is checked against
`listingExpectedSchema` in `@nabvy/fixtures` (fields in `docs/fixtures.md`; `facts` stays an open
object until the pack's facts type lands in `packages/contracts`).

`listings/placeholder/example-gpu/` is a synthetic listing, not a real one. It exists to prove the
layout and the runner, and can go once real labelled listings are cut from recorded runs.

## Runner

```
pnpm test:fixtures                          run every suite, print the report, fail on a drop
pnpm test:fixtures --module services/<m>    only that module (repeatable)
pnpm test:fixtures --record                 write the current rates as the recorded run
pnpm test:fixtures --record --accept-drop   also record a lower rate (say why in the pull request)
```

The report prints the pass rate per module and stage (against the recorded run), per stage across
modules, and per module, then the failing cases by name. CI runs `pnpm test:fixtures` after
`pnpm test` in the "Typecheck, lint and test" job. The run fails when a stage:

- falls below the module's recorded rate (compared as exact fractions, so adding fixtures that
  pass never counts as a drop);
- fails to load, or has no cases;
- has no recorded rate yet, or was recorded but no longer runs.

A pass rate is passed cases over passed plus failed; skipped cases do not count. One Vitest test
is one case, so write one `it` per fixture (`it.each` or `describe.each`) to get a real rate.

### How a module registers a stage

No shared file is edited. Put a Vitest file in the module's own package:

```
services/<module>/test/fixtures/<stage>[.<suite>].fixtures.ts
```

- The file name registers it: the first part is the stage (lower-case, hyphens: `gate`,
  `extraction`, `risk`, `valuation`, `identification`, `adapter`, or a new one the module needs);
  the optional second part names the suite when a module has several files for one stage.
- The runner finds suites in every workspace package (`services/*`, `packages/*`, `apps/*`).
- `*.fixtures.ts` files do not match Vitest's default pattern, so `pnpm test` skips them and a
  stage below 100% does not break the unit tests; only `pnpm test:fixtures` runs them. They are
  still typechecked with the package's `test` folder.
- Read fixtures through `@nabvy/fixtures` (`fixturePath`, `readFixtureJson`,
  `listListingFixtures`, `listRecordedRuns`) or relative paths.
- Run `pnpm test:fixtures --module services/<module> --record` and commit the module's
  `test/fixtures/pass-rates.json` with the suite.

### Where the previous pass rates are stored

Each module's recorded run is `<package>/test/fixtures/pass-rates.json`, owned by that module:

```json
{ "stages": { "adapter": { "passed": 7, "total": 7 } } }
```

Stored per module so parallel module branches never conflict over one file. The last committed
version on the branch is the "previous recorded run"; CI never writes it. Record again when a rate
rises, so the new floor holds; recording refuses a lower rate unless `--accept-drop` is given, and
never records a stage that errored.

## Recorded provider runs

`listings/facebook/runs/<date>-<apifyRunId>/` holds one whole recorded actor run (`input.json`,
`dataset.json`, `run-summary.json`, `run.json`, `README.md`). A Facebook "raw response" is a run, so it
is kept whole. The per-listing folders in `docs/fixtures.md` (`stub.json`, `detail.json`, `raw.json`,
`expected.json`) are cut from these runs once the adapter (1.1) and labels exist.

Recorded runs are exported only through `apify_gateway.redacted_items` in Supabase, and only after
`apify_gateway.redaction_leaks` returns nothing (`supabase/README.md`). Seller identity, Facebook
media links and contact details never enter this folder;
`services/source-adapters/test/fixtures/adapter.facebook-run.fixtures.ts` (stage `adapter`) fails if
they do.
