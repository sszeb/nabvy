# @nabvy/listing-ingest

Turns every collected card row into one listing identity and one observation per run, and spots
new listing IDs (`docs/design/modules/listing-ingest.md`).

A module session edits only this folder, `packages/contracts/src/modules/listing-ingest.ts`,
`packages/config/src/modules/listing-ingest.ts`, `packages/db/src/schema/listing-ingest.ts`,
`packages/db/tests/listing-ingest.test.sql` and `packages/db/migrations/listing-ingest/`.

## Switch and priority

Off by default (rule 11). While it is off, `ingest` acknowledges and writes nothing, and every
view returns no rows; the same while the global `pipeline` switch is off. Users lose new listings;
everything downstream carries on with stored data. Shadow behaves like on: the module has no
user-facing output. `erase` runs whatever the switch says. P1, step 2
(`fb-scrap-engine/docs/HANDOFF.md:146-147`).

## Inputs

- Event `apify-gateway.run-collected` v1 `{ jobId, apifyRunId, kind }` (`apify-gateway`), handled
  by `runCollectedHandler`.
- Views of `apify-gateway`: `v_jobs` (the job is collected), `v_run_summaries`
  (`RUN_SUMMARY.collectedAt`, the fallback T1), `v_rows` (the rows, seller objects removed). Only
  rows with `recordType` "listing" are read.
- Switches `listing-ingest` and `pipeline`, through `@nabvy/switches` (fail closed).
- Later: `ebay-adapter.collected` and `gumtree-adapter.collected` (soft; neither module exists yet,
  and nothing here imports them).

## Outputs

- **Events**, payload `{ listingIds }` (1–500 listing UUIDs), built by `ingest` and published by
  the handler after the transaction commits:
  - `listing-ingest.first-seen` v1: listings whose earliest observation belongs to the job. Key
    `listing-ingest.first-seen:<jobId>:<batch>`.
  - `listing-ingest.card-changed` v1: listings whose observation in the job has a different card
    hash from the observation just before it (price, currency, title, availability or primary
    photo changed). Key `listing-ingest.card-changed:<jobId>:<batch>`.
- **Internal views** (`nabvy_pipeline`; security_invoker; empty while off):
  - `listing_ingest.v_listings`: id, source, source_listing_id, card_hash, price_minor, currency,
    money_kind, title, listed_at (T0), first_fetched_at (T1), last_seen_at, city_page_id,
    town_label, availability, category_id, delivery_types, primary_photo_id,
    displayed_previous_minor, binding, found_by_terms, item_job_id, item_seq
    (`ListingIngestListing`).
  - `listing_ingest.v_sightings`: id, listing_id, job_id, seq, kind (`search | detail`), term,
    centre_id, rank, card_hash, price_minor, currency, availability, seen_at
    (`ListingIngestSighting`). Coverage and page-1 overlap read kind `search` only.
  - `listing_ingest.v_price_changes`: listing_id, sighting_id, kind, previous_minor, price_minor,
    currency, previous_seen_at, seen_at (`ListingIngestPriceChange`), within one listing ID.
  - `listing_ingest.v_city_pages_seen`: city_page_id, town_label, listings, first_seen_at,
    last_seen_at.
  - `listing_ingest.v_fingerprints`: listing_id, fingerprint (SHA-256 of lower-cased,
    whitespace-collapsed title, price, currency and city page), for `listing-suppression` only.
- **Restricted and user-facing views:** none (rule 5).
- **Functions** (`@nabvy/listing-ingest`): `ingest(q, { jobId, kind })`, `erase(q, listingIds)`,
  `runCollectedHandler({ transaction })`, and the pure helpers `cardHash`, `normaliseTitle`.

## Tables

Schema `listing_ingest`:

- `listings`: `id` (UUID v7), unique `(source, source_listing_id)`; the card values listed under
  `v_listings`, plus `created_at`, `updated_at`. The raw row stays in `apify_gateway.items`,
  referenced by `(item_job_id, item_seq)`: the latest card that set the values.
- `sightings`: `id`, `listing_id` (→ `listings`), unique `(listing_id, job_id, kind)`; the columns
  listed under `v_sightings`, plus `created_at`, `updated_at`.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Identity | One listing per `(source, source_listing_id)`, ID as text | actor-integration.md 2.7; 17-digit ID in the recorded run | Fixed |
| City page | `sourceFields.search.location.reverse_geocode.city_page.id`, then `locationDetails` | The card; dataset.json:369-378,433-436 | Fixed |
| Price | Only `money.kind` "fixed" in GBP or EUR, from `amountMinor`; else null, kind kept | actor-integration.md 2.7 | Fixed |
| Card hash | SHA-256 of NFKC-lower-cased, whitespace-collapsed title, `priceMinor`, currency, availability, primary photo ID | Rule 8 | Starting value (question 3) |
| Availability | `sold`, then `pending`, then `hidden`, then `live`, else `unknown`, from the actor's flags | This module | Starting value |
| Observations | One per listing per run; the first row of an ID wins | Question 4 | Starting value |
| Rank | 1-based row order within the card's search URL | The card ("row order") | Fixed |
| Newer wins | A card replaces stored values only if it is at least as recent as `last_seen_at` | This module | Fixed |
| Event batch | 500 listing IDs | Rule 7 (`LISTING_INGEST_EVENT_BATCH_SIZE`) | Fixed |

## Fixtures and pass rate

Stage `ingest` (`test/fixtures/ingest.fixtures.ts`), on the real migrations in PGlite, from the
recorded run `fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/` stored as collected
gateway jobs:

- `recorded-run-search`: 20 listings, 20 `search` sightings, the `sourceOutcome` row skipped, 20
  `first-seen`; city page from `sourceFields`, T0, T1, centre, rank, binding, terms.
- `second-run-same-page`: the same rows as a second job: 20 more sightings, zero `first-seen`.
- `price-change` (synthetic, one price edited): one `card-changed` and one price change.
- `detail-observation` (synthetic, the rows as a details run with reworded `rawAmount`): 20
  `detail` observations, no feed sighting, no change: compared on `amountMinor` and currency.
- `detail-price-drop` (synthetic): a details refresh at a lower price gives `card-changed` and a
  `detail` price change.
- `pasted-links` (synthetic): listings first known through a details run.

Pass rate 6/6 (2026-09-24). Other tests: `domain.test.ts`, `idempotency.test.ts` (a replayed job
writes nothing and returns the same keys; a late older run never overwrites a newer card; the
handler publishes once), `switch.test.ts` (off, paused pipeline, shadow, erase),
`contracts.test.ts` (events and every view row parse; no seller-like column), and
`packages/db/tests/listing-ingest.test.sql` (grants, unique keys, views empty while off, the
foundation's view check). With this module, `apify-gateway`'s reader check is covered: this
module's tests run with the gateway on, and `ingest` fails (and is retried) rather than
acknowledging a job the gateway does not show.

## Decisions

- **2026-09-24: events are derived from stored observations.** `first-seen` and `card-changed` are
  read back from `sightings` after the writes, not from what the call inserted, so a delivery that
  committed but lost its publish finds the same IDs on replay and publishes the same keys, which
  the transport drops.
- **2026-09-24: a details row updates price and availability only.** Title and primary photo stay
  the search card's (fresh card fields win), and the card hash is recomputed over them, so a
  details fetch that only rewords the price text changes nothing. Listed time, city page, town and
  category are filled from a details row only where still unknown.
- **2026-09-24: sightings carry price, currency and availability.** The card lists the sighting's
  columns without them, but `v_price_changes` and the details observation (section 8, change 5)
  need them. `listings.found_by_terms` holds the card's found-by terms, which the card names under
  "Does".
- **2026-09-24: view rows are Zod in contracts.** `drizzle-zod` is not a dependency yet, so the view
  row types are written in `@nabvy/contracts/modules/listing-ingest`, as `apify-gateway` did.
- **2026-09-24: a job the gateway does not show is an error.** `ingest` returns
  `listing-ingest.job_not_found` so the handler retries and dead-letters, instead of acknowledging a
  run it could not read (for example while `apify-gateway` is off).
- **2026-09-24: no RLS.** No user rows; the pipeline role alone has grants, `delete` only for
  `erase` (rule 12).
- **2026-09-24: T0 and T1 are columns.** `listed_at` and `first_fetched_at` in `listings`; the
  handler declares no envelope stamp.

## Open questions

`docs/questions/listing-ingest.md` (folded into `docs/questions.md` by the coordinator): first-seen
for listings first known through a details run; the card hash on photo ID. Catalogue questions 3
and 4.

## Incidents

None.
