# @nabvy/detail-evidence

Keeps every detail version of a listing, keyed by its evidence hash, with how complete it is
(`docs/design/modules/detail-evidence.md`).

A module session edits only this folder, `packages/contracts/src/modules/detail-evidence.ts`,
`packages/config/src/modules/detail-evidence.ts`, `packages/db/src/schema/detail-evidence.ts`,
`packages/db/tests/detail-evidence.test.sql` and `packages/db/migrations/detail-evidence/`.

## Switch and priority

Off by default (rule 11). While it is off, `record` acknowledges and writes nothing, and every
view returns no rows; the same while the global `pipeline` switch is off. Users lose new detail
versions: interpretation keeps its last results, and new listings wait with every part not
stated. Shadow behaves like on: the module has no user-facing output. `erase` runs whatever the
switch says. P1 (the card).

## Inputs

- Event `apify-gateway.run-collected` v1 `{ jobId, apifyRunId, kind }` (`apify-gateway`), handled
  by `runCollectedHandler`. Search runs with details and details runs are read the same way.
- Views of `apify-gateway`: `v_jobs` (the job is collected), `v_run_summaries`
  (`RUN_SUMMARY.collectedAt`, the fallback time), `v_rows` (the rows, seller objects removed).
  Only `listing` rows that carry a detail fetch are read (`detailAttempted`, `descriptionStatus`
  or `directItemUnresolved`); search cards without details are skipped.
- View of `listing-ingest`: `v_listings` (the listing ID of each source listing ID).
- Switches `detail-evidence` and `pipeline`, through `@nabvy/switches` (fail closed).

## Outputs

- **Events**, payload `{ listingIds }` (1–500 listing UUIDs), built by `record` and published by
  the handler after the transaction commits:
  - `detail-evidence.changed` v1: listings whose current version this job changed (a first
    version, or a fresh fetch of another text). Key `detail-evidence.changed:<jobId>:<batch>`.
  - `detail-evidence.unresolved` v1: known listings whose fetch in this job could not identify the
    item. Key `detail-evidence.unresolved:<jobId>:<batch>`.
- **Internal views** (`nabvy_pipeline`; security_invoker; empty while off):
  - `detail_evidence.v_current`: listing_id, source, source_listing_id, evidence_hash,
    first_seen_at, last_seen_at, item_job_id, item_seq, description_status, has_description,
    attributes, detail_sections, custom_title, custom_subtitles, condition, category_id,
    category_path, inventory_type, lat, lng, gallery_total, gallery_complete, photo_ids,
    links_expire_at, detail_outcome, stale_fallback (`DetailEvidenceVersion`). No text.
  - `detail_evidence.v_text`: listing_id, evidence_hash, description_status, description, title,
    for every version (`DetailEvidenceText`).
  - `detail_evidence.v_outcomes`: listing_id (null for an ID listing-ingest never stored), source,
    source_listing_id, job_id, seq, fetched_at, detail_outcome, detail_attempts,
    description_status, cache_status, stale_fallback, unresolved, evidence_hash
    (`DetailEvidenceOutcome`).
  - `detail_evidence.v_fingerprints`: listing_id, evidence_hash, fingerprint (SHA-256 of the
    current description, lower case, whitespace collapsed), for `copy-advert`
    (`DetailEvidenceFingerprint`).
- **Restricted and user-facing views:** none (rule 5).
- **Functions** (`@nabvy/detail-evidence`): `record(q, { jobId })`, `erase(q, listingIds)`,
  `runCollectedHandler({ transaction })`, and the pure helpers `evidenceHash`, `normaliseText`.

## Tables

Schema `detail_evidence`:

- `evidence`: one row per version. `id` (UUID v7), unique `(source, source_listing_id,
  evidence_hash)`; `listing_id` (listing-ingest's, a plain value), `first_seen_at`,
  `last_seen_at`, `item_job_id` and `item_seq` (the raw row in `apify_gateway.items`), `title`,
  `description`, `description_status`, `attributes`, `detail_sections`, `custom_title`,
  `custom_subtitles`, `condition`, `category_id`, `category_path`, `inventory_type`, `lat`, `lng`,
  `gallery_total`, `gallery_complete`, `photo_ids`, `links_expire_at`, `detail_outcome`,
  `stale_fallback`, `conflicts`, `provenance`, `created_at`, `updated_at`. No seller field.
- `fetches`: one row per listing per job. `id`, unique `(source, source_listing_id, job_id)`;
  `listing_id` (null when never ingested), `seq`, `fetched_at`, `detail_outcome`,
  `detail_attempts`, `description_status`, `cache_status`, `stale_fallback`, `unresolved`,
  `evidence_hash` (null when the fetch gave no evidence; a check refuses one on an unresolved
  fetch), `created_at` (the module's `doneAt`), `updated_at`.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Evidence hash | SHA-256 of title, description, attributes, detail sections, custom title and subtitles, condition, category ID and path; attribute order ignored | Rule 8; `docs/fb-actor-reference.md`, "Build the evidence hash from an allowlist" | Starting value (question 3) |
| Text normalisation | NFKC, line endings unified, trailing whitespace of each line and of the whole removed; case kept | The card's test (`dataset.json:3722,3745`) | Starting value |
| New version | Only when the hash is new for the listing | The card | Fixed |
| Complete | `descriptionStatus` `full_verified` only; `descriptionComplete` not read | The card; `docs/questions.md:10` | Fixed |
| Condition | The Condition attribute's machine value (`used_good`) | The card ("the machine value") | Fixed |
| Current version | The version of the latest fresh fetch; a `stale-fallback` fetch counts only while there is no fresh one | `docs/fb-actor-reference.md`, "Stale cached description" | Starting value |
| Unresolved | `directItemUnresolved: true`: a fetch with no version, never "sold" | The card; `fb-scrap-engine/docs/EVIDENCE_LEDGER.md:254-255` (v2 only, Q16) | Fixed |
| No evidence | `detailOutcome: "extraction-error"` gives a fetch and no version | `docs/fb-actor-reference.md`, `detailOutcome` | Starting value |
| Link expiry | Earliest `oe` in the gallery links; else 104 h after collection (`DETAIL_EVIDENCE_LINK_LIFETIME_HOURS`) | 104–108 h, `fb-scrap-engine/docs/EVIDENCE_LEDGER.md:288-289` | Starting value |
| One fetch per job | The first row of a listing ID wins | As `listing-ingest` (question 4) | Fixed |
| Seller data | `conflicts` entries and `provenance` keys naming a seller are dropped; `v_rows` already strips seller objects | Rule 6 | Fixed |
| Event batch | 500 listing IDs (`DETAIL_EVIDENCE_EVENT_BATCH_SIZE`) | Rule 7 | Fixed |

## Fixtures and pass rate

Stage `record` (`test/fixtures/record.fixtures.ts`), on the real migrations in PGlite, from the
recorded run `fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/` stored as collected
gateway jobs and ingested by `listing-ingest`:

- `recorded-run`: 20 versions, all `full_verified`; 20 fetches; 20 `changed`; row 0's gallery
  (4 photos, complete), condition `used_good`, coordinates and link expiry.
- `price-change` (synthetic, row 0 cheaper and pending a day later): no new version, nothing
  announced; `last_seen_at` and the link expiry move.
- `description-edit` (synthetic): one new version, one `changed`, the new text current.
- `trailing-whitespace`: the 5 recorded rows whose two description copies differ only in
  trailing whitespace hash the same.
- `unresolved` (synthetic, the documented removed-ID row): one known listing `unresolved`, its
  last version still current; an ID never ingested is recorded and not announced.
- `stale-fallback` (synthetic): a stale-cache fetch with other text is kept but not current.

Pass rate 6/6 (2026-09-24). Other tests: `domain.test.ts` (normalisation, each allowlisted field,
attribute order, the recorded whitespace pair, condition, link expiry, unresolved, stale, seller
conflicts), `idempotency.test.ts` (a replayed job writes nothing and returns the same keys; a late
older run announces nothing; the handler publishes once; a job whose listings are not ingested yet
fails before writing; a job the gateway does not show fails; a later `full_verified` fetch of the
same text marks a partial version complete), `switch.test.ts` (off, paused
pipeline, shadow, erase (including fetches recorded before ingestion), and `listing-ingest` carrying on with this module off),
`contracts.test.ts` (both events and every view row parse; no seller-like column; the text only in
`v_text`) and `packages/db/tests/detail-evidence.test.sql` (grants, unique keys, checks, the
current-version rule, views empty while off, the foundation's view check).

## Decisions

- **2026-09-24: a `fetches` table beside `evidence`.** The card lists one table, but outcomes,
  attempts, cache status and unresolved fetches belong to each fetch, not to a version (an
  unresolved fetch has no version). `v_outcomes` reads it, and the current version and the
  `changed` events are derived from it.
- **2026-09-24: `changed` means the current version changed.** The current version chosen over
  every stored fetch differs from the one chosen without this job's fetches. A first version, or a
  fresh fetch of another (possibly older) text, is a change; a stale-cache fetch never replaces a
  fresh version, and a late replay of an older run announces nothing. Derived from stored fetches,
  so a replay after a lost publish publishes the same keys.
- **2026-09-24: listing IDs come from `listing-ingest`.** The event payload carries listing UUIDs,
  and `evidence.listing_id` holds one as a plain value (rule 4). Both modules handle
  `run-collected`, so a detail row whose listing is not ingested yet fails the call before any
  write (`detail-evidence.listing_not_ingested`); the transport retries and, if listing-ingest
  stays off, dead-letters it (`docs/questions/detail-evidence.md`).
- **2026-09-24: a version seen again is touched, not rewritten.** A later fetch moves
  `last_seen_at`, and if it carries a gallery, replaces the gallery and link expiry (the graphql
  route returns none, which never erases one); an earlier one moves `first_seen_at` and the raw-row
  reference; a fresh one clears `stale_fallback`; a `full_verified` fetch of the same text marks a
  `partial` or `missing` version complete (review of PR #40: `descriptionStatus` is not in the
  hash, so identical text keeps one version). A row that would not change is not written.
- **2026-09-24: erase reaches every fetch of an erased listing** (review of PR #40), including
  fetches recorded before listing-ingest stored it (unresolved, no listing ID), matched by source
  listing ID.
- **2026-09-24: test timeout 30 s** (review of PR #40), as in `account`: the PGlite suites run
  past vitest's default 5 s on a busy CI runner. The same line was added to listing-ingest's
  config as a CI fix.
- **2026-09-24: text is stored as the actor gave it.** Only the hash normalises; the first text
  seen of a version is kept. The recorded row with `+` for spaces (`1756692548940192`) is stored
  as is: the module interprets nothing.
- **2026-09-24: view rows are Zod in contracts.** `drizzle-zod` is not a dependency yet, as in
  `listing-ingest`.
- **2026-09-24: the gateway's conventions test lists this module's test support** beside
  listing-ingest's, since it seeds collected jobs into the gateway's tables in PGlite (never a live
  database). A one-line change in `services/apify-gateway/test/conventions.test.ts`.
- **2026-09-24: no RLS.** No user rows; the pipeline role alone has grants, `delete` only for
  `erase` (rule 12). The module is outside the T-stamp chain: `fetched_at` is the input's
  collection time and `created_at` its own `doneAt` (rule 10).

## Open questions

`docs/questions/detail-evidence.md` (folded into `docs/questions.md` by the coordinator): the
listing-ingest ordering; the current version after a partial fetch; listing-ingest and unresolved
rows; the extra table. Catalogue question 3.

## Incidents

None.
