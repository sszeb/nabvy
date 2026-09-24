# @nabvy/parts-rules

Runs the rule pass over each listing version and records what the rules find, where, and what
they leave open (`docs/design/modules/parts-rules.md`). No model call, no price, nothing hidden.

A module session edits only this folder, `packages/contracts/src/modules/parts-rules.ts`,
`packages/config/src/modules/parts-rules.ts`, `packages/db/src/schema/parts-rules.ts`,
`packages/db/tests/parts-rules.test.sql` and `packages/db/migrations/parts-rules/`.

## Switch and priority

Off by default (rule 11). While it is off, `run` acknowledges and writes nothing, and every view
returns no rows; the same while the global `pipeline` switch is off. Users lose the rule-found
parts: `parts-record` has no rule rows, `parts-ai` does not run, and parts show as not stated.
Shadow behaves like on: the module has no user-facing output. `erase` and `applyCorrection` run
whatever the switch says. Priority: first; rules run first (`fb-scrap-engine/docs/HANDOFF.md:166-167`).

## Inputs

- Event `detail-evidence.changed` v1 `{ listingIds }` (`detail-evidence`), handled by
  `detailEvidenceChangedHandler`, up to 500 listing IDs per batch.
- Views of `detail-evidence`: `v_current` (the current version's hash, `descriptionStatus`,
  attributes and detail sections), `v_text` (its title and description).
- View of `listing-ingest`: `v_listings` (the card title, used only when a version has none).
- `product-catalogue`: `resolve()` for GPU and CPU hits, and `v_negative_contexts` (patterns
  blanked before matching).
- The patterns: `@nabvy/packs`' `gpu-pc` copy of `fb-scrap-engine/docs/data/part-patterns.json`
  (checked byte for byte against its source by the pack's test), never retyped here.
- Switches `parts-rules` and `pipeline`, through `@nabvy/switches` (fail closed).

## Outputs

- **Event** `parts-rules.ran` v1, payload `{ listingIds }` (1–500): the listings whose current
  version has a run at this rule version (new or already stored). Key
  `parts-rules.ran:<ruleVersion>:<sha256 of the sorted listing@hash pairs>:<batch>`, so a replay
  publishes nothing new and a new version publishes again.
- **Internal views** (`nabvy_pipeline`; security_invoker; empty while off):
  - `parts_rules.v_rule_parts`: listing_id, evidence_hash, rule_version, seq, part_type,
    catalogue_id, attrs, inclusion_candidate, source, quote, start, end, rule_id, correction
    (`PartsRulesPart`).
  - `parts_rules.v_gaps`: listing_id, evidence_hash, rule_version, kind, kind_gap, parts,
    full_verified, done_at (`PartsRulesGap`).
  - `parts_rules.v_tag_blocks`: listing_id, evidence_hash, rule_version, source, start, end,
    rule_id (`PartsRulesTagBlock`).
  - `parts_rules.v_kind_signals`: listing_id, evidence_hash, rule_version, signal, source, quote,
    start, end, rule_id (`PartsRulesKindSignal`).
- **Restricted and user-facing views:** none (rule 5). No seller field is read or stored.
- **Functions** (`@nabvy/parts-rules`): `run(q, { listingIds })`, `applyCorrection(q,
  correction)` for `review-console`, `erase(q, listingIds)`, `detailEvidenceChangedHandler(deps)`,
  `RULE_VERSION`, and the pure `analyse`, `compileRules`, `workingCopy`, `readsPlusAsSpace`.

## Tables

Schema `parts_rules`:

- `runs`: one row per run. `id` (UUID v7), unique `(listing_id, evidence_hash, rule_version)`;
  `kind` or `kind_gap` (exactly one), `kind_signals` and `tag_blocks` (jsonb arrays), `gaps`
  (jsonb: `[{ partType, reason }]`), `full_verified`, `done_at` (the module's `doneAt`),
  `created_at`, `updated_at`.
- `rule_parts`: one row per hit. `id`, unique `(listing_id, evidence_hash, rule_version, seq)`;
  `part_type`, `catalogue_id` (product-catalogue's, a plain value), `attrs`,
  `inclusion_candidate`, `source`, `quote`, `quote_start`, `quote_end` (shown as `start` and
  `end`), `rule_id`, `correction`, `created_at`, `updated_at`.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Working copy | NFKC, horizontal whitespace collapsed, line breaks unified; stored text never changed, each quote the stored slice | The card | Fixed |
| `+` as a space | Only when the text has `+` and no space | The card; `dataset.json:466` | Fixed |
| Negative contexts | `\boptiplex\s*(ultra\s*)?\d{4}\b` always, plus `v_negative_contexts`, blanked before matching | `PARTS_INTELLIGENCE.md:244`; `part-patterns.json:2` | Fixed |
| Tag blocks | ≥3 hashtags in a row (`PARTS_RULES_TAG_BLOCK_MIN_HASHTAGS`); a "Tags:"/"Keywords:"/"Search terms:" block to the next blank line; a line naming ≥4 GPU models (`PARTS_RULES_TAG_BLOCK_MIN_MODELS`) | `PARTS_INTELLIGENCE.md:242-243` | Starting value |
| Field patterns | `part-patterns.json` `fields`, per line; structured attributes first, then title, then description | The card; `part-patterns.json:12-21` | Starting value (precision and recall not measured, `PARTS_INTELLIGENCE.md:240-241`) |
| Spec-line labels | A hit in a line labelled for another part ("Graphics Card:", "Case:", "CPU Cooler:") is dropped; attribute names likewise ("Processor type" → CPU; "Condition", "Colour", "Brand" skipped) | "Parse the spec lines", `PARTS_INTELLIGENCE.md:242` | Starting value |
| GPU model | `gpuModels` matched only inside a GPU hit | The card; `part-patterns.json:22-99` | Fixed |
| Graphics memory | A RAM size reading "GDDR", or a "RAM … 12gb" reading running into a GPU model, is not system RAM | `part-patterns.json:16`; recorded row `1397200465308431` | Starting value |
| Catalogue | `resolve()` on the reading plus 24 characters of its line; kept only when the match starts inside the reading, is of the hit's kind, and its model numbers are quoted (a series number such as "2000" agrees with "2700X") | The card; "never a guess" (`product-catalogue` README) | Starting value |
| Inclusion candidate | 80 characters each side, same line (`PARTS_RULES_CONTEXT_CHARS`); mention and not-included phrases anchored at the quote, at most two words between | `CONTAINER_LISTINGS.md:177-180`; `EVIDENCE_LEDGER.md:556-559` | Starting value |
| Listing kind | `listingKind` title patterns; wanted-description pattern on the first 400 characters (`PARTS_RULES_WANTED_DESCRIPTION_CHARS`); box-only wording; settled only when the signals agree (Decisions) | `part-patterns.json:4-11` | Starting value |
| Gaps | Core parts GPU, CPU, RAM size, storage size of a PC, laptop or open kind: `not_stated`, `mention_only`, `unresolved`, `conflict` | The card ("parts or kind the rules could not settle") | Starting value |
| Rule version | `r<revision>.<first 8 hex of the patterns' sha256>`, now `r1.25d64b70` | Idempotency key (brief) | Fixed |
| Batch | 500 listing IDs (`PARTS_RULES_EVENT_BATCH_SIZE`) | Rule 7 | Fixed |

## Fixtures and pass rate

Stage `run` (`test/fixtures/run.fixtures.ts`), on the real migrations in PGlite with
product-catalogue's seeded catalogue, from the recorded run
`fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/` collected, ingested by
`listing-ingest` and recorded by `detail-evidence`; each case's `notes.md` holds the evidence:

- `recorded-run`: all 20 listings (153 hits): kinds, gaps, signals and every hit.
- `plus-as-space` (row `1756692548940192`), `gddr7-not-ram` (row `2264485254402498`),
  `legion-desktop` (row `1403975981250476`), `attributes-first` (row `1352645884594841`),
  `headset-kind` (two headsets "for PC": kind left open).
- Synthetic, built from recorded rows: `tag-blocks` (hashtags, a "Tags:" block, a model list),
  `optiplex-trap` (an OptiPlex 3090/3080 office PC: no GPU read), `mentions-5080` (the ledger's
  "upgraded to", "equivalent to", "waiting for", swap and "not included" phrasings).

Pass rate 9/9 (2026-09-24). Other tests: `domain.test.ts` (working copy and offsets, `+`, NFKC,
tag blocks, OptiPlex, GDDR, bare numbers, spec-line labels, attributes first, 12 inclusion
phrasings, kind decisions, gaps, the catalogue guard, keys), `idempotency.test.ts` (a replay
writes nothing and returns the same key; a new version runs alone; the handler publishes once;
over 500 refused; unknown listings skipped), `switch.test.ts` (off, paused pipeline, shadow,
product-catalogue off, detail-evidence off, corrections, erase), `contracts.test.ts` (every view
row and the event parse; Drizzle view columns equal the contracts' keys; no seller-like column)
and `packages/db/tests/parts-rules.test.sql` (grants, unique keys, checks, unnested views, views
empty while off, the foundation's view check).

## Decisions

- **2026-09-24: positions are UTF-16 offsets into the stored text.** The rules read a working
  copy but every working character keeps the offsets of the stored code point it came from, so
  `quote` is always `stored.slice(start, end)` (the `+` row quotes "GTX+1660") and a reader can
  check it against `v_text`. For an attribute hit the offsets are into the attribute's value and
  `attrs.attributeName` names it.
- **2026-09-24: spec lines, line by line.** Patterns run per line, so a match never spans a line
  break ("GTX 970 4GB⏎RAM" is not "4GB RAM"), and a labelled line keeps only its own part.
- **2026-09-24: the kind the rules settle.** Wanted or swap wins; an explicit laptop word is a
  laptop unless a PC or not-a-PC word disagrees; a laptop family name ("Legion") next to a PC
  word or a CPU or desktop model is a desktop, alone a laptop; a not-a-PC word with no PC word is
  not a PC; PC words alone are a PC; anything else is `conflict` or `no_signal`, for the model
  (`docs/questions/parts-rules.md`). Every signal is still recorded.
- **2026-09-24: catalogue IDs are only taken when the quote bears them out.** `resolve()` may
  fall back to a fuzzy match; a match whose model numbers are not in the quote is dropped, so the
  GTX 970 and i7-4790 stay `unresolved` instead of becoming another item. A family without a
  stated variant ("RTX 3080") keeps `attrs.family` and `attrs.candidates` and a null ID.
  `resolve()` is called once per distinct text per batch.
- **2026-09-24: idempotent at the run.** A run is inserted with `on conflict do nothing`, and hits
  are written only for runs that were inserted, in the same transaction; a replay or a
  concurrent duplicate writes nothing. `ran` names every listing with a current run, so a
  publish lost after commit is recovered by the replay.
- **2026-09-24: signals, tag blocks and gaps live in `runs`** (jsonb, unnested by the views),
  and a reviewer's correction sits beside the candidate in `rule_parts.correction`
  (`docs/questions/parts-rules.md`).
- **2026-09-24: `@nabvy/packs` is a dependency**, as in `product-catalogue`: it holds the checked
  copy of `part-patterns.json`, so the patterns are never typed twice. The OptiPlex pattern is
  the one exception, kept here so the trap holds while product-catalogue is off.
- **2026-09-24: the PGlite tests stub `extensions.similarity`** (never matching), because PGlite
  has no `pg_trgm`; product-catalogue's fuzzy tier runs on real Postgres in `pnpm db:dry-run`.
- **2026-09-24: view rows are Zod in contracts.** `drizzle-zod` is not a dependency yet, as in
  `detail-evidence`; `contracts.test.ts` compares the keys with the Drizzle view declarations.
- **2026-09-24: no RLS.** No user rows; the pipeline role alone has grants, `delete` only for
  `erase` (rule 12). The module is outside the T-stamp chain: `done_at` is its `doneAt` (rule 10).

## Open questions

`docs/questions/parts-rules.md` (folded into `docs/questions.md` by the coordinator): re-running
after a catalogue change; signals and tag blocks as columns; which kinds the rules settle; how a
correction is recorded. Card: open question 14.

## Incidents

None.
