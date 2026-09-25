# @nabvy/parts-record

Keeps one versioned parts record per listing version: the listing kind and every part, with its
quote, source, extractor and inclusion status, merged from the rule rows (`parts-rules`), the AI
rows (`parts-ai`) and, later, the photo verdicts (`photo-review`). A module session edits only
this folder, `packages/contracts/src/modules/parts-record.ts`,
`packages/config/src/modules/parts-record.ts`, `packages/db/src/schema/parts-record.ts`,
`packages/db/tests/parts-record.test.sql` and `packages/db/migrations/parts-record/`.

## Switch and priority

Off by default (rule 11 of `_rules.md`; no seed row, so `switches.state('parts-record')` reads
`off`). While it is off no parts exist anywhere: `spec-match` shows parts as not stated, and
`listing-assessment` has no record to assess. Priority: first (`fb-scrap-engine/docs/HANDOFF.md:159-167`);
critical-path priority [cp 10], the highest of wave 2 (`docs/design/modules/parts-record.md`).

## Inputs

- Events: `parts-rules.ran` (parts-rules) and `parts-ai.extracted` (parts-ai), both batches of up
  to 500 listing IDs. Both run the same merge, `record()`. `photo-review.reviewed` is a soft edge
  (below): photo-review does not exist yet.
- Views: `detail_evidence.v_current` (the current evidence hash of each listing);
  `parts_rules.v_gaps` (the latest rules run over the version: rule version, kind, kind gap),
  `v_rule_parts` (its hits, with the reviewer's corrections) and `v_kind_signals` (the quote the
  kind rests on); `parts_ai.v_runs` (the latest extracted call: prompt version and the kind the
  model read) and `v_ai_parts` (its parts); `product_catalogue.v_items` (the family of each
  catalogue ID, for conflict detection only).
- Functions: none. The photo verdicts arrive through the injected `photoVerdicts` function
  (`PartsRecordDeps`); the default, `noPhotoVerdicts`, returns none.

## Outputs

- Event `parts-record.recorded` v1 `{ listingIds }` (at most 500): every listing among the batch
  whose current version has a record, written now or before. Key: sha256 of the sorted
  `listing@hash@ruleVersion@aiVersion@photoVersion` lines plus the batch index, derived from the
  stored rows, so a replay yields the same key and a new input version a new one.
- Internal views (`nabvy_pipeline`; `security_invoker`; explicit columns; no seller field; empty
  while off): `parts_record.v_records` (the latest record of each listing version: kind, who
  settled it and where, the three extractor versions, the part count, `conflict`,
  `recorded_at`) and `parts_record.v_parts` (every part of that latest record: type, catalogue
  ID, attrs, the decided `inclusion`, `rejected`, source, extractor and its version, quote and
  UTF-16 offsets, `conflict`, the correction). Row types: `PartsRecordRecord`, `PartsRecordPart`.
- User-facing views: none. Quotes reach users through `spec-match` after `quote-redaction`.
- Functions: `record(q, { listingIds }, deps?)`; `applyCorrection(q, correction)` for
  `review-console` (a correction beside one part of the latest record: inclusion or rejected);
  `erase(q, listingIds)` for `seller-rights`; the pure `merge`, `mergeKind` and `findConflicts`.

## Tables

Postgres schema `parts_record`. No user rows, so no RLS; the pipeline role inserts, reads and
deletes, and may update only `parts.correction`.

| Table | Key columns | Unique keys |
| --- | --- | --- |
| `records` | `listing_id`, `evidence_hash`, `rule_version`, `ai_version` (null until parts-ai has an extracted call), `photo_version` (null until photo-review ships), `kind`, `kind_gap`, `kind_by`, `kind_source`, `kind_quote`, `kind_start`, `kind_end`, `part_count`, `conflict`, `recorded_at` | `(listing_id, evidence_hash, rule_version, ai_version, photo_version)`, nulls not distinct |
| `parts` | `record_id` (cascades), `listing_id`, `evidence_hash`, `seq`, `part_type`, `catalogue_id`, `attrs`, `inclusion`, `source`, `extractor`, `extractor_version`, `quote`, `quote_start`, `quote_end`, `conflict`, `correction` | `(record_id, seq)` |

Checks pin every enum (kinds, gaps, part types, inclusions, sources, extractors), the version
formats, the positions, and that a kind is either settled (with who, and a complete position when
quoted) or open with its reason; a `photo` source comes only from the `photo` extractor.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Batch size | 500 listing IDs per handled batch and per event (`PARTS_RECORD_EVENT_BATCH_SIZE`) | rule 7; `CLAUDE.md`, "Batches, not items" | fixed by the rule |
| Kind | the rules' kind where they settled it, else the model's where it answered, else open with the rules' reason (`no_signal` when none) | the card: one owner of the kind; parts-ai asks only where the rules left it open | fixed by design |
| Inclusion | the source extractor's reading, a source module's correction over it, this module's correction over both; a source-rejected hit is left off | `parts-rules` and `parts-ai` contracts: "a candidate only: parts-record decides" | fixed by design |
| Conflict | among offered parts of one type: two catalogue families, two catalogue IDs, or two stated values (RAM size and generation, PSU watts, chipset); never storage (several drives), never a mention, a not-included or a photo brand-only row | the card: "the conflict is recorded, not settled by guessing"; the recorded run's two-drive listings | starting value; 0 conflicts in the recorded run |
| New information | a merge is written when it brings a rule version, an AI version or a photo version the stored latest record lacks or differs from; a merge that only lacks an input is not | rule 11: a missing input is "no data", never "no" | fixed by design |

## Fixtures and pass rate

Stage `record` (`test/fixtures/record.fixtures.ts`), 6 of 6 at the last recorded run
(`test/fixtures/pass-rates.json`). Every case runs the recorded rows through ingest,
detail-evidence, parts-rules and parts-ai (a recorded model, parts-ai's own client) and then this
module on both events, on the real migrations in PGlite.

- `recorded-run`: the whole recorded run (`fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k`)
  with parts-ai's recorded responses: 20 records, 12 with an AI version, 2 kinds settled by the
  model (headsets), 0 conflicts.
- `inclusion-cases`: the three recorded listings the card names (`…/dataset.json:2244,5464,5779`):
  extras that "come with" the PC (no part type, no row), an optional paid extra (`not_included`),
  and accessories not included (no part type, no row).
- `worked-rtx-5080` and `worked-pc-5060`: the brief's two worked examples, synthetic over recorded
  rows (the recorded run holds neither, `_rules.md` rule 16), the first with a brand-only photo
  verdict through the seam.
- `not-included-gpu`: a card expressly not included, read the same way by both extractors.
- `gpu-conflict`: title and description name different cards; every GPU row is flagged, nothing
  is settled.

Each case's `notes.md` gives the evidence. The recorded model responses are parts-ai's
(`services/parts-ai/test/fixtures/recordings/current.json`, copied into
`test/fixtures/cases/recorded-run/input.json`) or written for the case; none is live output.

## Decisions

- **2026-09-25: a record is append-only; the views show the latest.** The idempotency key is
  the listing version plus the three extractor versions (`records_version_key`, nulls not
  distinct). A new AI or photo result for a version writes a new record row beside the old one;
  `v_records` and `v_parts` show the latest by `recorded_at` (then `id`). Nothing is rewritten,
  so a replay writes nothing and the audit trail keeps every merge.
- **2026-09-25: a record never loses an input.** A merge is written only when it adds a version
  (`addsInformation`). With parts-ai switched off later, the `ran` event re-merges rule rows only,
  and the stored record with the AI rows stays the latest.
- **2026-09-25: the record decides inclusion in the view.** `v_parts.inclusion` is the reviewer's
  correction when there is one, else the extractor's reading (with the source module's own
  correction already applied at the merge); `rejected` flags a row a reviewer struck, which stays
  for the audit trail. Readers take `inclusion = 'offered' and not rejected` as "in the sale".
- **2026-09-25: no deduplication.** A part named by two extractors, or twice by the rules, is two
  rows, each with its own quote and position: the record is the evidence, not a summary.
  Readers that need one answer per type group by `part_type` and `catalogue_id`.
- **2026-09-25: conflicts are recorded, not settled.** `findConflicts` flags offered parts of one
  type that name different catalogue families or IDs, or different RAM, PSU or chipset values,
  using `v_items` for the family of a resolved ID (with product-catalogue off there is no family to
  compare, so no conflict is invented). Storage never conflicts: two sizes are two drives.
- **2026-09-25: corrections follow the evidence.** `applyCorrection` writes beside a part of the
  latest record; a later re-merge carries the correction onto the new row where the same
  extractor found the same quote at the same position (`carryCorrections`). A correction on a
  part the new record no longer holds stays on the old row.
- **2026-09-25: the kind is derived, with its quote.** `PartsRecordKind` is `PartsRulesKind`
  (the model answers in the same set): a standalone part has no kind of its own yet
  (`docs/questions/parts-record.md`). A rules-settled kind is quoted from the first kind signal
  that bears it out (`pc` from `pc` or `cpu_or_pc`, `laptop` from `laptop` or `laptop_family`,
  `not_a_pc` from `not_a_pc` or `box_only`); a model-settled kind from `v_runs`.
- **2026-09-25: the photo-review seam.** `photo-review` is a soft edge
  (`docs/design/modules/soft-edges.json`). `record()` takes `photoVerdicts`, a function over the
  batch's listing versions returning `PartsRecordPhotoVerdict` rows (part type, catalogue ID or
  brand-only, the photo ID as the quote); the default returns none and `photo_version` stays
  null, so a photo never read is "not stated", never "no". When photo-review ships it provides
  that function over its `v_verdicts`, and its `reviewed` event calls `record()` like the other
  two.
- **2026-09-25: detail-evidence is read for the current version.** The card's inputs are the
  rules', AI's and catalogue's views; the current evidence hash comes from `v_current`, as
  parts-ai reads it, so `module.json` lists detail-evidence for apply order and the package lists
  it as a test dependency.
- **2026-09-25: view rows are Zod in contracts**, as parts-rules' and parts-ai's are;
  `contracts.test.ts` compares the keys with the Drizzle view declarations.
- **2026-09-25: the gateway's conventions test lists this module's test support**, which seeds
  collected jobs into the gateway's tables in PGlite like parts-ai's (one line in
  `services/apify-gateway/test/conventions.test.ts`).
- **2026-09-25: no RLS.** No user rows; the pipeline role alone has grants. The module is outside
  the T-stamp chain: `recorded_at` is its `doneAt` (rule 10).

## Open questions

`docs/questions/parts-record.md` (never `docs/questions.md` itself: `docs/session-conventions.md`).

## Incidents

None.
