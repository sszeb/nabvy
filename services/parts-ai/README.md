# @nabvy/parts-ai

Fills the gaps the rules leave with at most one model call per listing version, shared by every
user (`docs/design/modules/parts-ai.md`). The model names facts and quotes only; every quote is
checked against the stored text and every product is resolved through `product-catalogue`.

A module session edits only this folder, `packages/contracts/src/modules/parts-ai.ts`,
`packages/config/src/modules/parts-ai.ts`, `packages/db/src/schema/parts-ai.ts`,
`packages/db/tests/parts-ai.test.sql` and `packages/db/migrations/parts-ai/`.

## Switch and priority

Off by default (rule 11), and ships off until an AI processor agreement is recorded (question 11,
backlog 1.5e). While it is off, `run` and `sweep` acknowledge and do nothing, and every view
returns no rows; the same while the global `pipeline` switch is off. Users lose nothing directly:
`parts-record` uses rule rows only and the gaps show as not stated. Shadow behaves like on: the
module has no user-facing output. `erase` and `applyCorrection` run whatever the switch says.

Paid work fails closed (rules 11 and 13): no call is made unless `quote-redaction` is `on` (no
listing text reaches a model unmasked), `cost-meter` is not off, the `anthropic` provider switch
is on, the model is in cost-meter's price table, spend-governor's throttle reads `none` or
`slow-free`, and the call's worst-case price keeps the rolling 24 hours under the cap. Otherwise
the listings are deferred to the sweep, never dropped.

Priority: first; gated (`fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:357-358`).

## Inputs

- Event `parts-rules.ran` v1 `{ listingIds }` (`parts-rules`), handled by `partsRulesRanHandler`,
  up to 500 listing IDs per batch; `sweep()` on a schedule for deferred and failed versions.
- Views of `detail-evidence`: `v_current` (the current version, its `descriptionStatus`, source
  and source listing ID), `v_text` (its title and description).
- View of `parts-rules`: `v_gaps` at parts-rules' `RULE_VERSION` (the open kind and parts).
- `product-catalogue`: `resolve()` for every GPU and CPU the model names.
- `quote-redaction`: `redact()` on the copy of the text sent to the model.
- `cost-meter`: `contextFor()`, `recordModelCall()` and the price table; `spend-governor`:
  `readThrottle()`; `details-queue`: `enqueue()` for partial text.
- Switches `parts-ai`, `pipeline`, `quote-redaction`, `anthropic` through `@nabvy/switches`.
- A `PartsAiClient` passed in (the model). The only implementation today replays recordings.

## Outputs

- **Event** `parts-ai.extracted` v1, payload `{ listingIds }` (1–500): the listings whose current
  version has an extracted result (a new call or a stored one). Key
  `parts-ai.extracted:<promptVersion>:<sha256 of the sorted listing@hash pairs>:<batch>`, derived
  from stored rows, so a replay publishes nothing new. Quarantined versions are not announced.
- **Internal views** (`nabvy_pipeline`; security_invoker; empty while off; no cost, model or
  seller column):
  - `parts_ai.v_ai_parts`: listing_id, evidence_hash, prompt_version, seq, part_type,
    catalogue_id, family, inclusion, source, quote, start, end, correction (`PartsAiPart`).
  - `parts_ai.v_runs`: listing_id, evidence_hash, prompt_version, status, kind, kind_source,
    kind_quote, kind_start, kind_end, done_at (`PartsAiRun`).
  - `parts_ai.v_quarantine`: listing_id, evidence_hash, prompt_version, problem, detail, at
    (`PartsAiQuarantined`).
- **Restricted and user-facing views:** none (rule 5).
- **Calls:** `detailsQueue.enqueue()` (reason `partial-text`) for partial or missing text;
  `recordModelCall()` for every call.
- **Functions** (`@nabvy/parts-ai`): `run(q, { listingIds }, deps, ctx)`, `sweep(q, deps, ctx)`,
  `applyCorrection(q, correction)` for `review-console`, `erase(q, listingIds)`,
  `partsRulesRanHandler(deps)`, `createRecordedPartsClient`, `PARTS_AI_SYSTEM_PROMPT`,
  `PARTS_AI_OUTPUT_SCHEMA`, `PARTS_AI_PROMPT_VERSION`, `promptVersion`.

## Tables

Schema `parts_ai`:

- `calls`: one row per model call. `id`, unique `(listing_id, evidence_hash, prompt_version)` (the
  idempotency key and the cache); `model`, `trace_id` (the provider's response ID, cost-meter's
  `ref_id`), `cost_gbp_micros` (as cost-meter counted it), `status` (`extracted | quarantined`),
  `kind`, `kind_source`, `kind_quote`, `kind_start`, `kind_end` (all or none, extracted only),
  `done_at` (server time; the cap's window), `created_at`, `updated_at`.
- `ai_parts`: one row per checked part. `id`, unique `(listing_id, evidence_hash, prompt_version,
  seq)`; `part_type`, `catalogue_id`, `family`, `inclusion`, `source` (`title | description`),
  `quote`, `quote_start`, `quote_end`, `correction`.
- `quarantine`: one row per rejected output. Unique `(listing_id, evidence_hash, prompt_version)`;
  `problem` (`invalid_output | quote_not_found`), `detail` (this module's text, ≤ 500), `at`.
- `refreshes`: one row per partial version sent to details-queue. Unique `(listing_id,
  evidence_hash)`; `source`, `source_listing_id`, `requested_at`.

The pipeline inserts, selects and deletes (erase); the only update it may make is
`ai_parts.correction` (a column grant).

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| What is asked | The open parts of `v_gaps` (not stated, mention only, unresolved, conflict) and the kind when `kind_gap` is set; nothing when the rules settled all | "AI only on gaps, conflicts and the listing-kind decision" (`PARTS_INTELLIGENCE.md:245`) | Fixed |
| Full text only | `descriptionStatus` `full_verified`; otherwise `enqueue` a refresh once per version, priority `sweep` | `CONTAINER_LISTINGS.md:167-168` | Starting value (question) |
| One listing per request | Strict schema, no tools, temperature 0, system prompt cached | `CONTAINER_LISTINGS.md:70`; `docs/contracts.md`, "Model call rules" | Fixed |
| Output | `PartsAiOutput`: strict; kind and parts with verbatim quotes (≤ 300 characters, ≤ 30 parts); a name with a currency or amount of money is refused | "Returns only catalogue IDs plus quotes" (`PARTS_INTELLIGENCE.md:246`) | Fixed |
| Quote check | Every quote found in the stored title or description, verbatim or with whitespace runs folded, or the whole output is quarantined | `PARTS_INTELLIGENCE.md:246-247,374-376` | Fixed |
| No retry | A rejected output is quarantined at its prompt version | The brief | Fixed (question) |
| Catalogue | `resolve()` on the model's name (or the quote); kept only if of the part's kind and its model numbers are in the quote; a laptop's GPU as a mobile part | "Never a guess" (`product-catalogue`); parts-rules' guard | Starting value |
| Masking | The model gets `redact()`'s copy; description capped at 6,000 characters (`PARTS_AI_MAX_DESCRIPTION_CHARS`); listing text fenced so it cannot close its tags | `PARTS_INTELLIGENCE.md:357-360` (strip contact details before AI); rule 13 | Starting value |
| Prompt version | `p1.<first 8 hex of sha256(system prompt, output schema)>`, now `p1.63b00ddb` | Idempotency key (brief) | Fixed |
| Throttle | Calls only at `none` or `slow-free` (`PARTS_AI_ALLOWED_THROTTLE_LEVELS`) | Rule 13 | Starting value (question) |
| Daily cap | £5 in any 24 hours (`PARTS_AI_DAILY_SPEND_CAP_GBP_MICROS`), checked against each call's worst case (2,500 in, 1,200 out) | ~$0.001–0.003 a listing (`CONTAINER_LISTINGS.md:70`) | Starting value (question) |
| Calls per batch | 100 (`PARTS_AI_MAX_CALLS_PER_BATCH`); the rest wait for the sweep | One transaction holds the batch lock across its calls | Starting value |
| Batch | 500 listing IDs (`PARTS_AI_EVENT_BATCH_SIZE`) | Rule 7 | Fixed |

## Fixtures and pass rate

Stage `extract` (`test/fixtures/extract.fixtures.ts`), on the real migrations in PGlite with
product-catalogue's seeded catalogue, from the recorded run
`fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/` collected, ingested, recorded by
`detail-evidence` and run through `parts-rules`. The model is replayed from
`test/fixtures/recordings/current.json` (per source listing ID, pinned to the prompt version: a
prompt change fails the stage until it is re-recorded). Each case's `notes.md` holds the evidence:

- `recorded-run`: all 20 listings; 12 with gaps are called, 8 settled by the rules are not.
- Synthetic, built from recorded rows: `quote-not-found` (a GTX 1070 the text does not hold:
  quarantined), `invalid-output` (a `price` key: quarantined, and the replay calls nothing),
  `prompt-injection` (instructions and fake tags in the description), `mention-only` ("Upgraded to
  an RTX 4070": stored as `mention`), `partial-text` (sent to details-queue once, never to the
  model), `price-change-cache` (a price change keeps the hash: a cache hit).

Pass rate 8/8 (2026-09-24). `test/evaluation.test.ts` is the evaluation run (backlog 1.5a): the
current prompt passes `recorded-run`, `mention-only` and `prompt-injection`; a deliberately
weakened prompt (three lines removed), replayed from `recordings/weakened.json`, fails all three.
Other tests: `domain.test.ts` (asks, quote location and folding, rejection, the schema's refusals,
the catalogue guard, the prompt, its version and the fence, the recorded client, the cap
boundary, keys), `idempotency.test.ts` (a replay calls and writes nothing and returns the same
keys; out-of-order batches; a new version called alone; the handler publishes once; over 500
refused), `switch.test.ts` (off, paused pipeline, shadow, upstream modules off, every fail-closed
check, the cap, the sweep, a throwing call, metering, the masked copy, corrections, erase),
`contracts.test.ts` and `packages/db/tests/parts-ai.test.sql` (grants and column grants, keys,
checks, views empty while off, the view check). No module reads this one yet, so "a reader passes
with this module off" waits for `parts-record`.

## Decisions

- **2026-09-24: the model names, the catalogue decides.** The model returns a part type, the
  product as the text names it, a quote and an inclusion; it never sees or returns catalogue IDs.
  The name is resolved through `resolve()` and kept only when the quote bears out its model
  numbers, so neither a fuzzy match nor the model can turn "GTX 970" into another card. The name
  itself is not stored.
- **2026-09-24: one bad quote rejects the output.** A quote not in the stored text means the
  output cannot be trusted, so nothing of it is kept (`quarantine`, `quote_not_found`), even
  parts that were not asked for. Parts and a kind that were not asked for are dropped.
- **2026-09-24: no retry** (the brief, over the card's "one retry"): see
  `docs/questions/parts-ai.md`. A call that throws writes nothing; the sweep calls it again.
- **2026-09-24: the kind is on the call row.** The model settles the kind only where the rules
  left it open; `v_runs` shows it with its quote.
- **2026-09-24: recorded model client.** No Anthropic key exists yet (as in `scan-recognition`),
  so `createRecordedPartsClient` replays responses written per listing for one prompt version.
  The recordings are what a careful model states from each text; they are not live output. A
  live client implements `PartsAiClient` (temperature 0, cached system prompt, structured output,
  no tools) and needs no other change.
- **2026-09-24: the prompt version is derived**, from the system prompt and the output schema's
  JSON Schema, so any edit is a new version, a cache miss and a failed fixture stage until the
  recordings are re-made.
- **2026-09-24: the batch lock.** `run` takes the transaction-scoped advisory lock
  `hashtext('parts_ai.batch')` (details-queue's pattern) before reading what is done, so two
  batches never call the model for the same version or both pass the cap. The lock is held across
  the calls, which is why a batch makes at most 100.
- **2026-09-24: cost is server-timed.** `done_at` defaults to the database's `now()` and the cap
  sums the calls of the database's last 24 hours; the metered call's time is the database's too.
- **2026-09-24: view rows are Zod in contracts**, as parts-rules' are; `contracts.test.ts`
  compares the keys with the Drizzle view declarations.
- **2026-09-24: the gateway's conventions test lists this module's test support**, which seeds
  collected jobs into the gateway's tables in PGlite like parts-rules' (a one-line change in
  `services/apify-gateway/test/conventions.test.ts`, merged with main's run-coverage line).
- **2026-09-24: no RLS.** No user rows; the pipeline role alone has grants. The module is outside
  the T-stamp chain: `done_at` is its `doneAt` (rule 10).

## Open questions

`docs/questions/parts-ai.md` (folded into `docs/questions.md` by the coordinator): no retry; the
tables beyond the card; the refresh priority; real-time and batch lanes; the spend limits; quotes
of masked text; the cache key and the model; the sweep's schedule. Card: questions 11 and 12.

## Incidents

None.
