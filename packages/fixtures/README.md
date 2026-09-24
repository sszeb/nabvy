# @nabvy/fixtures

The fixtures harness (task 0.6): helpers for reading `fixtures/` and the runner behind
`pnpm test:fixtures`. How to use it, how a module registers a stage and where pass rates are
recorded: `fixtures/README.md`.

- `src/domain/` is pure: suite-name parsing, tallies, the comparison with the recorded run, the
  report. `src/repo/` reads the disk: suite discovery, `pass-rates.json`, the `fixtures/` tree.
  `src/cli.ts` runs the discovered suites through Vitest's Node API and prints the report.
- `test/` holds unit tests of the runner; `test/fixtures/layout.fixtures.ts` is stage `layout`,
  which checks the `fixtures/` tree against `docs/fixtures.md` (it runs on the placeholder
  listing and the recorded Facebook run).

## Decisions

- **Discovery by file name, no registry.** A stage is registered by a file
  `<package>/test/fixtures/<stage>[.<suite>].fixtures.ts`. Atomic modules are built on parallel
  branches (`docs/decisions.md`, "Atomic modules"), so a shared list would conflict on every merge.
- **Baselines per module.** The previous recorded run is `<package>/test/fixtures/pass-rates.json`,
  for the same reason. The committed file is the baseline; CI only reads it.
- **Compared per module and stage.** An aggregate per stage could hide one module's regression
  behind another's new fixtures, so the check is per module and stage; the per-stage and
  per-module totals are printed for reading only.
- **Strict on missing baselines.** A stage without a recorded rate fails, and so does a recorded
  stage that stops running, so deleting or never recording a suite cannot hide a drop. Recording
  never lowers a rate unless `--accept-drop` is given, so a lower floor shows up in the diff.
- **Outside `pnpm test`.** `*.fixtures.ts` does not match Vitest's default pattern, so fixture
  suites below 100% do not fail unit tests; CI runs `pnpm test:fixtures` as its own step.
- **Plain Node, no new dependency.** The CLI runs under Node's type stripping
  (`--experimental-strip-types`, Node 22.6+) and calls Vitest's Node API, already a root
  dependency. Imports carry `.ts` extensions, so `tsconfig.base.json` sets
  `allowImportingTsExtensions` (allowed because nothing is emitted).
- **`expected.json` schema lives here for now.** It is a fixture-file format, not a boundary
  contract; `facts` becomes the pack's facts type from `packages/contracts` once it exists.
