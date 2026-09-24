# @nabvy/run-coverage

Judges every search of every run as complete, capped or degraded, so "nothing new" is never read
from a bad search, and records each scope's first complete (or bounded) read
(`docs/design/modules/run-coverage.md`).

A module session edits only this folder, `packages/contracts/src/modules/run-coverage.ts`,
`packages/config/src/modules/run-coverage.ts`, `packages/db/src/schema/run-coverage.ts`,
`packages/db/tests/run-coverage.test.sql` and `packages/db/migrations/run-coverage/`.

## Switch and priority

Off by default (rule 11). While it is off, `assess` acknowledges and writes nothing, and every
view returns no rows; the same while the global `pipeline` switch is off. Readers then treat
coverage as unknown, nothing is rerun on its word, and `alert-router` falls back to each want's
creation time as its baseline. Shadow behaves like on: the module has no user-facing output. P1
(`fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:189-193`).

## Inputs

- Event `apify-gateway.run-collected` v1 `{ jobId, apifyRunId, kind }` (`apify-gateway`), handled
  by `runCollectedHandler`. Details runs are acknowledged and skipped.
- Views of `apify-gateway`: `v_jobs` (status, actor input), `v_run_summaries` (`RUN_SUMMARY`:
  `searches[]`, `searchSort`, `collectedAt`), `v_rows` (`sourceOutcome` rows only).
- View of `listing-ingest`: `v_sightings`, kind `search` only, for the page-1 gap check.
- Switches `run-coverage`, `pipeline` and `listing-ingest`, through `@nabvy/switches` (fail
  closed).

## Outputs

- **Event** `run-coverage.search-degraded` v1 `{ jobId, searchIds }` (1–500 `v_search_coverage`
  IDs), key `run-coverage.search-degraded:<jobId>:<batch>`, built by `assess` and published by
  the handler after the transaction commits.
- **Internal views** (`nabvy_pipeline`; security_invoker; empty while off):
  - `run_coverage.v_search_coverage`: id, job_id, search_index, centre_id, term, kind, route,
    stop_reason, reported_route, reported_stop_reason, pages, listings, feed_type, binding,
    page_one_overlap, previous_job_id, status, reasons, collected_at (T1 of the input), done_at
    (`RunCoverageSearch`).
  - `run_coverage.v_scope_baselines`: centre_id, term, kind, basis (`complete | bounded`),
    first_complete_at, job_id, search_index (`RunCoverageScopeBaseline`).
  - `run_coverage.v_search_controls`: job_id, search_index, latitude, longitude, radius_km, sort:
    what Facebook reported it used (`RunCoverageSearchControls`).
- **Restricted and user-facing views:** none (rule 5).
- **Functions** (`@nabvy/run-coverage`): `assess(q, { jobId, kind })`, `runCollectedHandler`,
  and the pure helpers `searchesOf`, `judge`, `kindOf`, `centreOf`, `feedTypeOf`.

## Tables

Schema `run_coverage`:

- `search_outcomes`: `id` (UUID v7), unique `(job_id, search_index)`; the columns of
  `v_search_coverage` plus Facebook's reported controls (`control_latitude`, `control_longitude`,
  `control_radius_km`, `control_sort`), `created_at`, `updated_at`.
- `scope_baselines`: primary key `(centre_id, term, kind)`; basis, first_complete_at (the
  collection time of the read that set it), job_id, search_index.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Complete | Route `http`, stop `source-no-new-listings` | `fb-scrap-engine/README.md:101-102`; actor-integration.md 2.9 | Fixed |
| Capped | Route `http`, stop `page-cap`, `results-limit` or `time-limit` | README.md:101,106-108; recorded run `run-summary.json:9-14` | Fixed |
| Degraded | Failed run; route `browser-fallback`, `failed` or unknown; stop reason unknown; no listings; no page-1 overlap with the previous check | CONTAINER_LISTINGS.md:189-192; README.md:103-105; the card | Fixed |
| Unknown vocabulary | Any other route or stop reason reads `unknown` (the reported value is kept) and counts as degraded | `docs/questions.md:20` | Fixed |
| Page 1 | Sightings ranked 1–24 | About 90 listings over 4 pages; the recorded run read 20 on its one page (`RUN_COVERAGE_PAGE_ONE_RANKS`) | Starting value |
| Gap check | Page 1 of this read against every listing of the previous healthy read of the scope (route `http`, run not failed, listings > 0, earlier by collection time then job) | CONTAINER_LISTINGS.md:66,190-191 | Starting value |
| Short feed | Complete default-order read of ≤ 6 pages or < 150 listings | EVIDENCE_LEDGER.md:112,131-134 as cited by the card; README.md:125-128 | Starting value |
| Baseline | First complete scan of a scope; else its first healthy capped read (`bounded`), replaced once by the first complete scan. Never from a degraded read, an unverified binding, or a search without centre, term or known kind | actor-integration.md 2.9 | Starting value |
| Check kind | Facebook's reported sort, then the URL's `sortBy`, then the run's `searchSort`; contradictions read `unknown` | README.md:117-122 | Fixed |
| Event batch | 500 search IDs | Rule 7 (`RUN_COVERAGE_EVENT_BATCH_SIZE`) | Fixed |

## Fixtures and pass rate

Stage `assess` (`test/fixtures/assess.fixtures.ts`), on the real migrations in PGlite, from the
recorded run `fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/` stored as collected
gateway jobs and ingested by `listing-ingest`. Synthetic cases edit that run's
`RUN_SUMMARY.searches[0]` or its rows:

- `recorded-run-capped`: the recorded search is `capped` (stop `results-limit`), not degraded; a
  bounded baseline.
- `second-check-overlap`: the same page twice; overlap 20, still capped.
- `no-page-one-overlap` (synthetic, listing IDs changed): degraded, one event.
- `browser-fallback`, `route-failed`, `run-failed` (synthetic): degraded.
- `short-feed` (synthetic sweep, 4 pages, 90 listings): complete, feed `short`, complete baseline.
- `bounded-then-complete` (synthetic sweep at the 100-page cap, then a long complete read): the
  bounded baseline is replaced by the complete scan.
- `empty-search`, `unknown-stop-reason`, `unknown-route` (synthetic): degraded, `unknown` stored.

Pass rate 11/11 (2026-09-24). Other tests: `domain.test.ts` (every threshold's boundary, reading
searches from the summary, `sourceOutcome` rows and the actor input), `idempotency.test.ts` (a
replayed job writes nothing and returns the same key; an earlier read judged late takes the
baseline back; a run listing-ingest has not stored yet is retried; the handler publishes once),
`switch.test.ts` (off, paused pipeline, shadow, listing-ingest off, and listing-ingest's
ingest unaffected with this module off), `contracts.test.ts`, and
`packages/db/tests/run-coverage.test.sql` (grants, keys, checks, views empty while off, the
foundation's view check).

## Decisions

- **2026-09-24: status is judged per search, from route and stop reason, never binding alone.** A
  browser fallback still reports `sourceBinding: verified` (EVIDENCE_LEDGER.md:98-106 as cited by
  actor-integration.md 2.9). An unverified binding is kept as a reason and blocks a baseline, but
  does not degrade the search.
- **2026-09-24: a short feed is `complete` with `feed_type` `short`.** Whether it is degraded
  depends on the want (nationwide coverage or not), so the reader decides; this module publishes
  the fact.
- **2026-09-24: the gap check waits for listing-ingest.** Both modules consume `run-collected`
  with no order between them. While listing-ingest is on and has stored no sightings of a
  succeeded run that returned listings, `assess` returns `run-coverage.not_ingested` and the
  handler retries. While listing-ingest is off, the check is skipped and noted
  (`overlap-unchecked`), not degraded (`docs/questions/run-coverage.md`).
- **2026-09-24: a gap check with nothing to compare is skipped, not failed.** No previous healthy
  read, or a previous read with no stored sightings, leaves `page_one_overlap` null.
- **2026-09-24: searches come from `RUN_SUMMARY.searches[]`, then `sourceOutcome` rows, then the
  actor input.** The actor reports URL-sourced searches only through `sourceOutcomes`
  (EVIDENCE_LEDGER at `main`, pasted links); those rows use another route vocabulary (`search`),
  so they read `unknown` and degraded. A run that failed before reporting is recorded per term of
  its actor input (a `run` job's `input`), empty and degraded.
- **2026-09-24: events are read back from stored rows,** so a replay publishes the same key, which
  the transport drops (as listing-ingest does).
- **2026-09-24: view rows are Zod in contracts,** as listing-ingest's are: `drizzle-zod` is not a
  dependency yet.
- **2026-09-24: no delete grant, no `erase`.** The module holds job and search IDs, centres and
  terms, no listing rows (rule 12 asks `erase` of modules that hold listing rows).
- **2026-09-24: test support seeds gateway tables.** Like listing-ingest's, this module's
  `test/support/` writes collected jobs into `apify_gateway.jobs` and `items` in PGlite, so
  `services/apify-gateway/test/conventions.test.ts` lists it next to listing-ingest's.
- **2026-09-24: `listing-ingest` is a dev dependency.** The module reads its view through
  `@nabvy/db/schema/listing-ingest`; the tests call `ingest` to produce real sightings.

## Open questions

`docs/questions/run-coverage.md` (folded into `docs/questions.md` by the coordinator): coverage
while listing-ingest is off; jobs judged out of order; the page-1 size.

## Incidents

None.
