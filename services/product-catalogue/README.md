# @nabvy/product-catalogue

Holds the canonical parts and products (catalogue IDs) with their aliases, negative contexts and
codes, and resolves listing text to a catalogue ID (`docs/design/modules/product-catalogue.md`).

## Switch and priority

Default `off`. Modules and admin edits keep working, but every internal view is empty and
`resolve()` returns no matches, so callers treat every part as not stated (rule 11 of
`docs/design/modules/_rules.md`; the same behaviour as an empty match). Priority: first among the
atomic modules — the parts record needs it (card).

## Inputs

- Pack data in `@nabvy/packs` (`gpu-pc`'s dictionary and its copy of `part-patterns.json`), read
  once by the pack seed migration (below), never at request time.
- Admin edits: `addItem`, `addAlias`, `addNegativeContext`, `addCode`, each audited through
  `@nabvy/audit-log`'s `record()` in the caller's transaction. No admin procedure calls these yet
  (`docs/questions.md`); until one exists they run as the pipeline, the same interim choice as
  `services/switches`.
- Consumes no events. Depends on `switches` (its own switch) and `audit-log` (every edit's audit
  row); `@nabvy/packs` is a shared package, not a module dependency (rule 1 of `_rules.md`).

## Outputs

- **Event** `product-catalogue.updated` v1, `{ catalogueIds }`, keyed
  `product-catalogue.updated:<ids>@<write time>`.
- **Internal views** (`product_catalogue` schema, granted to `nabvy_pipeline` only; names reach
  users only through other modules' views, per the card):
  - `v_items` — `catalogue_id, kind, family, variant, is_mobile, pack_id, name`
  - `v_aliases` — `id, catalogue_id, alias, source`
  - `v_negative_contexts` — `id, pattern, blocked_catalogue_id, source`
- **Functions** from `@nabvy/product-catalogue`: `resolve(q, text)`, `lookupByCode(q, kind, code)`,
  `addItem`, `addAlias`, `addNegativeContext`, `addCode` (each `{ changed, event? }`),
  `ProductCatalogueRefused`.

## Tables

Postgres schema `product_catalogue`.

- `items` — one canonical part or product per row: `catalogue_id` (primary key, e.g.
  `gpu:nvidia:rtx-5080:16gb` or `gpu:nvidia:rtx-5080:mobile`), `kind` (`gpu | cpu`), `family`,
  `variant`, `is_mobile`, `pack_id`, `name`.
- `aliases` — text that resolves to a catalogue ID: `id`, `catalogue_id` (→ `items`), `alias`,
  `source`. Unique on `(catalogue_id, alias)`.
- `negative_contexts` — a pattern that must never resolve to one catalogue ID: `id`, `pattern`,
  `blocked_catalogue_id` (→ `items`), `source`. Unique on `(pattern, blocked_catalogue_id)`.
- `codes` — an EAN or CeX box ID for one item: `id`, `catalogue_id` (→ `items`), `kind`
  (`ean | cex_box`), `code`. Unique on `(kind, code)`.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Catalogue ID format | `<kind>:<vendor>:<model>[:<variant>...]`, kebab-case segments | Shared with `@nabvy/packs`' `DictionaryEntry.productKey` (`docs/packs/gpu-pc.md`) | Fixed |
| Fuzzy-match threshold | 0.4 (pg_trgm `similarity`) | No fixtures yet exercise this tier | Starting value (`@nabvy/config/modules/product-catalogue`) |
| Mobile indicator | `\b(laptop\|notebook\|macbook\|chromebook\|mobile)\b` | A narrowed version of the actor's `laptopTitle` pattern; not yet fixture-measured here | Starting value |
| Negative-context blanking | Global (every pattern is blanked everywhere, not only near the blocked ID) | Matches `@nabvy/packs`' own `blankOptiplex`; a blocked pattern is written only because it never appears in a genuine mention | Fixed (see Decisions) |

## Fixtures and pass rate

Stage `dictionary` (`test/fixtures/dictionary.fixtures.ts`): the gpu-pc pack's own 43 alias
fixtures (`packages/packs/test/fixtures/aliases.json`), run through this module's own
`resolveDictionary()` over the pack's dictionary (desktop items and CPUs; this module's own mobile
items and admin rows are outside the pack's fixtures). Pass rate 43/43. `test/domain.test.ts`
additionally proves: every `part-patterns.json` regex compiles with the `i` flag; "OptiPlex 3090"
never resolves to the RTX 3090; desktop and mobile RTX 5080 resolve to different catalogue IDs.

## Decisions

- 2026-09-24: **Catalogue ID scheme.** Desktop GPUs and CPUs keep the gpu-pc pack's own
  `productKey` verbatim as their `catalogue_id` (so this module's seed is traceable to the pack
  1:1). The pack carries no laptop GPU data, so a mobile counterpart is seeded per canonical model
  in `part-patterns.json`'s `gpuModels` (19 models) as `<kind>:<vendor>:<model-slug>:mobile`, with
  `variant = 'mobile'` and no VRAM stated (never a guess). `family` is the pack's display name
  (e.g. `RTX 5080`) for both the desktop and mobile rows, but `resolve()` never lets them compete
  (next point).
- 2026-09-24: **`resolve()`'s dictionary tier reuses `@nabvy/packs`' `createResolver`.** Items are
  partitioned into desktop GPUs, mobile GPUs and everything else (today: CPUs) and each partition
  gets its own resolver instance, so a desktop and mobile item of the same family never appear as
  candidates of one ambiguous match. `PRODUCT_CATALOGUE_MOBILE_INDICATOR_PATTERN`
  (`@nabvy/config/modules/product-catalogue`) picks the GPU partition to search; CPUs are searched
  regardless of it. Resolvers are rebuilt (all rows re-read, every regex recompiled) on every call;
  no caching yet — acceptable for now since this is a request-scoped utility, not a batch handler.
- 2026-09-24: **Aliases and patterns share one table.** The card's `aliases` table is
  `(catalogue_id, alias, source)`, with no separate column for a regex pattern (needed for the
  pack's CPU generation-range patterns, e.g. `i5 8th gen` SKUs). A pattern row's `source` ends
  with `:pattern` (`isPatternSource()`, `packages/contracts/src/modules/product-catalogue.ts`)
  instead of adding a column; `resolveDictionary()` splits on it before building each
  `DictionaryEntry`.
- 2026-09-24: **Negative contexts are blanked globally**, not only for their own
  `blocked_catalogue_id` (`blankNegativeContexts()`, `src/domain/resolve.ts`). This matches
  `@nabvy/packs`' own `blankOptiplex` and is simpler and correct as long as a negative context is
  only ever written because the pattern never appears inside a genuine mention of anything this
  module resolves — true of "OptiPlex 3080/3090" (a Dell desktop model number). An admin adding a
  broader pattern should confirm this still holds before saving it.
- 2026-09-24: **The pack seed is a migration, not a runtime function**, matching
  `services/switches`' own seed rows. `packages/db/migrations/product-catalogue/generate-seed.mjs`
  (a dev tool, no runtime dependency on this module) regenerates the seed SQL from
  `packages/packs/gpu-pc/data`; re-run it and commit the output as a new migration whenever that
  pack's data changes (migrations are forward-only — never edit the merged file). The pack seeded
  no EANs or CeX box IDs (`codes` is empty on this run); the script already handles them
  generically for when the pack gains some. Two negative-context rows are seeded (RTX 3080, RTX
  3090) for the documented "OptiPlex 3080/3090" collision.
- 2026-09-24: **Writes run as `nabvy_pipeline`**, the same interim choice `services/switches` made:
  no per-module database role exists yet (`docs/questions.md`, "w1 switches: who may write a
  switch"), and no admin procedure calls `addItem`/`addAlias`/`addNegativeContext`/`addCode` yet.
- 2026-09-24: **No delete function.** An item, alias, negative context or code is never removed by
  this build; `nabvy_pipeline` has no delete grant on any of these tables either. Add one when a
  task needs it.
- 2026-09-24: **The pg_trgm tier is untested by this module's own suite.** PGlite (used by
  `test/support/database.ts`) has no `pg_trgm`; `resolve()`'s fuzzy tier is exercised only by
  `packages/db/tests/product-catalogue.test.sql` under `pnpm db:dry-run`, on real Postgres.
- 2026-09-24: **No `idempotency.test.ts` in the handler sense** — this module consumes no events,
  so there is no batch to replay twice (the same reasoning `services/switches` and
  `services/audit-log` recorded). `test/idempotency.test.ts` instead proves the two things this
  module does repeat: re-running the seed migration's SQL a second time adds no rows, and a
  repeated `addAlias` call writes no new row or audit entry.
- 2026-09-24: `ProductCatalogueItem`/`Alias`/`NegativeContext` are written by hand in Zod, the same
  reason `audit-log`'s and `switches`' view-row types are: `drizzle-zod` is not in this repo yet.
  `test/contracts.test.ts` compares their keys against the Drizzle view declarations, so drift
  fails the build.

## Open questions

- `docs/questions.md`, "w1 product-catalogue: who may write the catalogue".

## Incidents

None.
