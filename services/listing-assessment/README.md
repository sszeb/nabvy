# @nabvy/listing-assessment

Decides what each listing version is and what its parts let us conclude: container or not, form,
GPU state, confirmed parts, exclusions, bundle extras, cautions and coverage, and stamps T3
(`docs/design/modules/listing-assessment.md`). A module session edits only this folder,
`packages/contracts/src/modules/listing-assessment.ts`,
`packages/config/src/modules/listing-assessment.ts`, `packages/db/src/schema/listing-assessment.ts`,
`packages/db/tests/listing-assessment.test.sql` and `packages/db/migrations/listing-assessment/`.

## Switch and priority

Off by default (rule 11 of `_rules.md`; no seed row, so `switches.state('listing-assessment')`
reads `off`). While it is off, `assess` acknowledges and writes nothing and both views return no
rows; the same while the global `pipeline` switch is off. Readers carry on: container, form and
GPU state read as unknown, `spec-match` shows "not stated", and `noise-filter` has only the parts
record's kind to act on. Shadow behaves like on: the module has no user-facing output.
`applyCorrection` and `erase` run whatever the switch says. Priority: first (the card);
critical-path priority [cp 9].

## Inputs

- Event `parts-record.recorded` v1 `{ listingIds }` (parts-record), handled by
  `partsRecordRecordedHandler`.
- Views: `parts_record.v_records` (the kind and the extractor versions of the latest record of
  each version) and `v_parts` (its parts, the decided inclusion, `rejected`, quote and offsets,
  `conflict`); `detail_evidence.v_current` (the current version: description status, attributes,
  detail sections, stale fallback) and `v_text` (title and description, for the verbatim check);
  `listing_ingest.v_listings` (the card hash and the displayed previous price).
- Switches `listing-assessment` and `pipeline`, through `@nabvy/switches` (fail closed).

## Outputs

- Event `listing-assessment.assessed` v1 `{ listingIds }` (at most 500): every listing among the
  batch whose current version has an assessment, written now or before. Key: sha256 of the
  sorted `listing@hash@card@record@rule` lines of the stored rows plus the batch index, so a
  replay yields the same key and any new input a new one.
- Internal views (`nabvy_pipeline`; `security_invoker`; explicit columns; no seller field; empty
  while off):
  - `listing_assessment.v_assessments`: listing_id, evidence_hash, card_hash, kind (parts-record's,
    left-joined from `v_records`; null when open or off), form, container, container_reason,
    gpu_state, cautions, coverage, confirmed_parts, exclusions, extras, rule_version, assessed_at
    (T3), correction. Form, container and GPU state apply a reviewer's correction. Row type
    `ListingAssessment`.
  - `listing_assessment.v_unknowns`: listing_id, evidence_hash, part_type: each core part a
    container does not state, for "ask the seller" (`prepared-message`). Row type
    `ListingAssessmentUnknown`.
- User-facing views: none.
- Functions: `assess(q, { listingIds, now })`; `applyCorrection(q, correction)` for
  `review-console` (form, container or GPU state beside the latest assessment of a version);
  `erase(q, listingIds)` for `seller-rights`; the pure `assessOne`, `containerOf`, `extrasOf`,
  `confirmedOf`, `exclusionsOf`, `gpuStateOf`, `recordHash`, `ruleVersion`.

## Tables

Postgres schema `listing_assessment`. No user rows, so no RLS; the pipeline role inserts, reads
and deletes, and may update only `correction`.

| Table | Key columns | Unique keys |
| --- | --- | --- |
| `assessments` | `listing_id`, `evidence_hash`, `card_hash` (null while listing-ingest shows no card), `record_hash`, `rule_version`, `form`, `container`, `container_reason`, `gpu_state`, `cautions`, `coverage`, `confirmed_parts`, `exclusions`, `extras`, `unknowns`, `assessed_at` (T3), `correction` | `(listing_id, evidence_hash, card_hash, record_hash, rule_version)`, nulls not distinct |

No `kind` column: parts-record owns the kind. Checks pin the forms, reasons and GPU states,
`placed` or `box_only` exactly when not a container, the hash and version formats, and the JSON
shapes.

## Rules and thresholds

All in `packages/config/src/modules/listing-assessment.ts`; every one a starting value until more
recorded runs calibrate it.

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Container (R1) | at least 2 of CPU, RAM (size or generation) and storage (size or type) offered in the description, attributes or detail sections | `CONTAINER_LISTINGS.md:150-154` | the brief's starting value |
| Container (R1b) | seller attributes ("Processor type", "Form factor" and the like; "Is for gaming: Yes"); title words package, bundle, setup, job lot | `CONTAINER_LISTINGS.md:155-159` | starting value |
| Container, also | the record's kind is `pc`; the kind is open (`unplaced`: the rules cannot place it); never when the title says box only | `CONTAINER_LISTINGS.md:150-154` ("or when the rules cannot place it") | starting value |
| Bundle extras (R1c) | monitor, keyboard, mouse, mouse pad, headset, speakers, desk, chair, webcam, microphone; left out when their sentence, within 80 characters, says optional, extra, if needed, not included, or "no"/"without" comes just before; a score like "Desk 119%" is not a desk | `CONTAINER_LISTINGS.md:160-163`; the recorded run | starting value; 7 recorded bundles, 4 recorded non-extras |
| GPU state | conflicting, named, none (positive evidence only), integrated (stated), in photos, not stated | `CONTAINER_LISTINGS.md:143-144,183-185,43-45` | starting value |
| Confirmed (R5) | offered, not rejected, verbatim at its offsets, fresh (not stale; `full_verified` for a description quote), and no demoting or box-only word within 80 characters, clipped to the quote's sentence or line | `CONTAINER_LISTINGS.md:177-180` | starting value |
| Exclusions (R6) | a part the record reads as not included; a "no GPU" phrase (never followed by "issues") | `CONTAINER_LISTINGS.md:183-185` | starting value |
| Cautions | box only, previous price (a fact only), photo only, stale text, bundle price | the card | fixed by the card |
| Unknowns | GPU (while not stated), CPU, RAM size, storage size, for containers only | the card; `HANDOFF.md:168-170` | starting value |
| Batch size | 500 listing IDs per handled batch and per event | rule 7 | fixed by the rule |

## Fixtures and pass rate

Stage `assess` (`test/fixtures/assess.fixtures.ts`), 7 of 7 at the last recorded run
(`test/fixtures/pass-rates.json`). Every case runs the rows through listing-ingest,
detail-evidence, parts-rules, parts-record, parts-ai (a recorded model, parts-ai's own client) and
parts-record again, then this module, on the real migrations in PGlite.

- `recorded-run`: the whole recorded run (`fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k`)
  with parts-ai's recorded responses: 18 containers (13 by parts, 5 by kind), 2 placed headsets,
  7 bundles, 3 PCs with the GPU not stated, one previous price.
- `not-included-gpu`: "RTX 4090 not included" is demoted and read as an exclusion; GPU `none`.
- `offers-title`: a complete system titled "OFFERS" is a container.
- `gpu-not-stated`: a container with no GPU anywhere is `not_stated`, and GPU is an unknown.
- `photo-only-gpu`: a brand-only photo verdict through parts-record's seam: `in_photos`, caution
  `photo_only`.
- `gpu-none-and-integrated`: "no GPU" gives `none`; "integrated graphics" gives `integrated`.
- `cautions`: stale-cache text (`stale_text`, nothing confirmed) and a box-only listing.

The synthetic cases are built from recorded rows (`notes.md` in each case gives the evidence).
Other tests: `domain.test.ts` (every rule and the boundary of each threshold),
`idempotency.test.ts` (a replay writes nothing and keeps T3; a parts-record correction gives a
new row; a reviewer's correction is carried forward; the handler publishes once),
`switch.test.ts` (off, paused pipeline, shadow, parts-record, detail-evidence and listing-ingest
off, corrections and erasure while off), `contracts.test.ts` and
`packages/db/tests/listing-assessment.test.sql` (grants, key, checks, latest rows, the kind beside
them, corrections, unknowns, views empty while off, the foundation's view check).

## Decisions

- **2026-09-25: the kind is read, never stored.** `v_assessments` left-joins
  `parts_record.v_records` for the kind of the same version; with parts-record off it reads null
  (unknown). A kind change reaches this module as a new record, so as a new `record_hash`.
- **2026-09-25: an assessment is append-only; the views show the latest.** The key is the
  version plus the card hash, the record hash and the rule version. `record_hash` is the SHA-256
  of what this module reads from parts-record (kind, versions, each part's decision), so a new AI
  or photo result, or a reviewer's correction in parts-record, re-assesses; a replay does not.
  The card hash is in the key because the previous-price caution reads the card.
- **2026-09-25: T3 is `assessed_at`**, the handler's hop time (`stamp: 't3Extracted'`), written
  once: a replayed event inserts nothing, so T3 never moves.
- **2026-09-25: form values.** The card names a form without values; this module uses `system`,
  `bundle`, `part`, `box_only` and `unknown`, and leaves laptop, wanted and not-a-PC to the kind
  beside it (`docs/questions/listing-assessment.md`).
- **2026-09-25: a PC kind is a container, and so is an open kind.** R1 counts parts; a listing the
  record calls a PC with fewer than two parts named (for example "Gaming pc and curved Samsung
  monitor", specs "in video") is still a container, and one the rules cannot place is treated as
  one, as R1 says. `container_reason` records which rule held.
- **2026-09-25: columns beyond the card.** `container_reason`, `exclusions`, `extras` (R1c),
  `unknowns` (for `v_unknowns`), `record_hash` (idempotency) and `correction`
  (`applyCorrection`): each is something the card's rules or outputs need.
- **2026-09-25: the clean context is clipped to the quote's sentence or line.** A spec line next
  to "RTX 4090 not included" is confirmed; the same demoter in the quote's own line stops it.
- **2026-09-25: confirmed parts are not deduplicated**, as parts-record keeps every row: each
  confirmed entry names the record's part by `seq` with its quote.
- **2026-09-25: box only comes first.** A title with box-only wording is never a container, has
  form `box_only`, confirms nothing, and its GPU is `none` when the record reads the card as not
  included, else not stated.
- **2026-09-25: detail-evidence's `v_text` is read** for the verbatim check (R5) and the extras,
  box-only and GPU phrases; the card lists `v_current`, and both are detail-evidence's.
- **2026-09-25: view rows are Zod in contracts**, as parts-record's are; `contracts.test.ts`
  compares the keys with the Drizzle view declarations.
- **2026-09-25: the gateway's conventions test lists this module's test support**, which seeds
  collected jobs into the gateway's tables in PGlite (one line in
  `services/apify-gateway/test/conventions.test.ts`).
- **2026-09-25: no RLS.** No user rows; the pipeline role alone has grants.

## Open questions

`docs/questions/listing-assessment.md` (never `docs/questions.md` itself: `docs/session-conventions.md`).

## Incidents

None.
