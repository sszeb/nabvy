# @nabvy/details-queue

Keeps one shared, deduplicated queue of listings that need a paid detail fetch, and sends them to
the actor in batches through `apify-gateway` (`docs/design/modules/details-queue.md`).

A module session edits only this folder, `packages/contracts/src/modules/details-queue.ts`,
`packages/config/src/modules/details-queue.ts`, `packages/db/src/schema/details-queue.ts`,
`packages/db/migrations/details-queue/` and `packages/db/tests/details-queue.test.sql`.

## Switch and priority

Off by default (rule 11). While off, or while the global `pipeline` switch is off, `submitNext`
sends nothing and `v_queue` returns no rows; `enqueue()` and the `first-seen` handler still record,
and queued work waits, visible again once the switch is on, never dropped (rule 11's exception for
`enqueue`). Closing a batch already in flight and `erase` run whatever the switch says. Shadow
behaves like on: the module has no user-facing output. Users lose new descriptions (and so parts,
prices and alerts built on them) while it is off. P1, step 3 (`fb-scrap-engine/docs/HANDOFF.md:148-150`).

Every paid submit reads `spend-governor`'s throttle first (rule 13); `apify-gateway` also refuses
while `cost-meter` is off and holds the $150 monthly cap.

## Inputs

- `enqueue(q, DetailsQueueEnqueueInput)` from `details-selector`, `listing-lifecycle`,
  `copy-advert`, `photo-review`, `parts-ai` and `pasted-link-lookup` (none built yet).
- Event `listing-ingest.first-seen` (`listing-ingest`), handled by `firstSeenHandler`: bookkeeping
  only, it enqueues nothing (task 1.4h; see "Decisions"). Reads `listing_ingest.v_listings` and
  `v_sightings`, and the first sighting's job in `apify_gateway.v_jobs` (region, shape) and
  `v_rows`, to record listings that run already described as done.
- `details-selector`'s selections arrive through its `enqueue()` call (its README's published
  interface: `new-listing`, `text`, `first-seen`, `requestedBy: 'details-selector'`, no region).
  For `reason: 'first-seen'` with no `regionId`, `enqueue` places each ID by the search job that
  first found it: `listing_ingest.v_listings` and `v_sightings`, `apify_gateway.v_jobs` (region,
  shape).
- Event `apify-gateway.run-collected` (`apify-gateway`), kind `details`, handled by
  `runCollectedHandler`: reads the job's listing rows from `apify_gateway.v_rows`.
- `readJobs` (`apify-gateway`) for batches whose lease ran out; `recommendRoute` (`route-health`)
  before each text batch; `readThrottle` (`spend-governor`) before each submit.
- Switches `details-queue` and `pipeline`, through `@nabvy/switches` (fail closed).

## Outputs

- **Runs** through `apify-gateway.submitRun()`: shape `details-text` (photo lane: `details-photo`,
  closed for now), tags `{ module: 'details-queue', region, purpose: <lead priority> }`.
- **Event** `details-queue.deferred` v1 `{ source, sourceListingIds (1–500), day }`, key
  `details-queue.deferred:<London day>:<hash of the ID set>`, for IDs newly deferred by the daily
  cap. Returned by `submitNext` in `report.events`; the caller publishes after commit.
- **Internal view** `details_queue.v_queue` (`nabvy_pipeline`, security_invoker; empty while off):
  source, source_listing_id, lane, priority, status, reason, requested_by, region_id, attempts,
  requeues, last_outcome, job_id, lease_expires_at, deferred_on, done_at, created_at, updated_at
  (`DetailsQueueItem`). No restricted or user-facing views.
- **Functions** (`@nabvy/details-queue`): `enqueue`, `submitNext(q, { ports, now? })` (one
  scheduler tick), `closeBatch(q, jobId)`, `readQueue`, `erase(q, sourceListingIds)`,
  `handleFirstSeen`, `firstSeenHandler`, `runCollectedHandler`, `defaultPorts`.

## Tables

Schema `details_queue`:

- `items`: one per `(source, source_listing_id, lane)` (unique): priority, status
  `queued | leased | done | deferred | failed`, reason, requested_by, region_id, attempts (failed
  fetches), requeues (description refreshes), last_outcome, job_id (latest batch), deferred_on,
  done_at.
- `leases`: one per `(source, source_listing_id)` (primary key, whatever the lane): job_id,
  expires_at. Held from submit to close.
- `batches`: one per gateway job (`job_id` primary key): lane, region_id, route, size (1–200),
  source_listing_ids, day (London), submitted_at, closed_at (set once; a trigger refuses to change
  it), outcome counts.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Deduplication | One item per source, listing ID and lane; a fetched listing is re-sent only on `refresh` | Card; `EVIDENCE_LEDGER.md:250-253` | Fixed |
| Priority | new-listing, shortlisted, photo-capture, sweep; a repeat enqueue only raises it | `CONTAINER_LISTINGS.md:194-196` | Fixed |
| One run at a time | No submit while a batch is open | Card; question 5 | Starting value |
| Batch | ≤ 200 IDs, one lane, one region | `CONTAINER_LISTINGS.md:68,108-109`; 2.8 item 4 | Starting value |
| Daily cap | 1,000 IDs per London day, then `deferred` + event | ≈ $28/month graphql, $50 page (actor guide, "Costs") | Starting value (question) |
| Throttle | `hold-new`: nothing; `slow-paid`/`slow-sweeps`: sweeps wait | Rule 13; spend-governor levels | Starting value (question) |
| Route | Text: `recommendRoute(region)`; photo: `page` | `EVIDENCE_LEDGER.md:217-219` | Fixed |
| Requeue table | 2.10: full → done; partial/missing → requeue once; not attempted → requeue, no failure; removed → done; no row, error or unknown outcome → failure, `failed` after 2 | `actor-integration.md` 2.10; actor guide item 5 | Starting values |
| Lease | 30 minutes, then the job decides: pending/running holds; refused requeues; failed counts a failure; succeeded + announced closes from rows | Timeout 960 s plus collection | Starting value |
| Run input | v3, `listingIds` only, `maxDetails` = IDs, `maxRequests` = 2 × IDs + 20 (≤ 1,000), `maxRunSeconds` 900, timeout 960 s, 1,024 MB, GB residential, cache and browser fallback off | Recorded run: 22 requests for 20 details; gateway input rules | Starting value |
| Default region | `uk` for items no caller placed | National grid | Starting value (question) |

## Fixtures and pass rate

- Stage `close` (`test/fixtures/close.fixtures.ts`), 6 cases: the recorded run
  `VkryjpwS6U2GBDh3k`'s 20 listing rows as a details batch (all done), and synthetic rows built from
  the actor's outcome vocabulary for each 2.10 row (not attempted, partial/missing once, no row
  twice, removed, error and unknown outcomes). Pass rate 6/6.
- Stage `first-seen` (`test/fixtures/first-seen.fixtures.ts`), 5 cases, each a sequence of
  `first-seen` deliveries (this module's handler), `selected` batches (details-selector's
  `enqueue()` call, exactly as its README documents it), ticks and closes: an out-of-area,
  unshipped listing (details-selector's `out-of-area-not-shipped` case) is never enqueued while the
  selected one is, however often `first-seen` is replayed around it; the recorded run's 20
  first-seen listings, already described by that run, in both handler orders (nothing sent, the
  selection skipped or marked done); an out-of-order replay of `first-seen` and of the selection
  before submit, during the lease and after the close (each ID sent once — the risk from PR #35's
  review); newest-check follow-ups before sweep follow-ups although the selector asks `new-listing`
  for all. Pass rate 5/5.

Other tests: `domain.test.ts` (verdicts, counter boundaries, throttle mapping, London days across
BST, run input), `queue.test.ts` (deduplication, priority, batch size and region, one run at a
time, leases, throttle read before submit, refused submits, photo lane, daily cap and deferral,
lease expiry per job state, the tick lock), `idempotency.test.ts` (enqueue, close, both handlers twice),
`switch.test.ts`, `contracts.test.ts`, and `packages/db/tests/details-queue.test.sql` (grants,
keys, checks, close-once trigger, `v_queue` columns and switch filter, the view check). Other
modules' views are stand-in tables in PGlite, and the gateway, route-health and spend-governor
calls are injected ports. No module reads the queue yet, so "a reader passes with this module off"
waits for `details-selector`.

## Decisions

- **2026-09-24: `excludeListingIds` is not sent.** It is a public-edition input that skips search
  rows only, never `listingIds`, and the private build's contract refuses unknown keys with a
  charged failed run. The queue's own deduplication is the saving for detail fetches
  (`docs/questions/details-queue.md`).
- **2026-09-25 (task 1.4h): the queue no longer enqueues first-seen listings itself; it enqueues
  only what `details-selector` selects.** The selector's gate (every new ID in area or shipped, in
  an allowed category; `docs/decisions.md`, "Precedence", "Detail selection") never bound while this
  module's own handler enqueued every search listing (docs/questions/details-selector.md). The
  selector's README publishes no event: its interface is its direct `enqueue()` call, so nothing
  reads `v_selections` here. `firstSeenHandler` keeps only its bookkeeping: a listing whose first
  run already returned a verified description is recorded as done (a queued one is marked done),
  so the selector's `enqueue()` for it skips a paid fetch whichever handler runs first (two fixture
  cases, one per order). It runs on `first-seen` for every source, not only search sightings, so a
  pasted link's listing is covered too. Placement stays the queue's: `details-selector` asks
  `new-listing` for everything and names no region, so for `reason: 'first-seen'` with no
  `regionId` `enqueue` takes each ID's region and priority from the search that first found it
  (`newest-check`/`catch-up` → `new-listing`, sweeps → `sweep`), keeping the card's priority order
  and one region per batch. An ID with no search sighting keeps the caller's priority and the
  default region; a caller that names a region is placed as it asks (docs/questions/details-queue.md).
  Pasted links and rechecks are unchanged. Contracts, schema and migrations are unchanged.
- **2026-09-24: the queue consumes `listing-ingest.first-seen`** (the build brief) and queues
  listings first seen on a hunt's search card only. *(Superseded on 2026-09-25 by task 1.4h,
  above.)* A replayed `first-seen` (out-of-order jobs,
  review of PR #35) is deduplicated on the listing ID before anything is paid for: waiting and
  leased items are kept once, fetched ones are skipped. Listings the same run already described are
  recorded as done.
- **2026-09-24: submit and lease in one transaction.** `submitNext` calls `submitRun` inside the
  tick's transaction and leases the batch there, so a refused submit leases nothing and a lost
  reply leaves the batch visible as in flight. This stands in for the gateway's missing request key.
- **2026-09-24: ticks are serialised** (review of PR #46). `submitNext` first takes the
  transaction-scoped advisory lock `hashtext('details_queue.tick')`, the pattern of
  `apify_gateway.claim_next_job`, so two overlapping ticks can never submit two runs or both pass
  the daily cap. The tick must run in one transaction (`withPipeline`).
- **2026-09-24: a replayed `first-seen` that shows a waiting listing already described marks it
  done** (review of PR #46), so it never gets a paid fetch it does not need.
- **2026-09-24: known gaps, left visible** (review of PR #46). An ID the actor keeps reporting as not
  attempted is requeued with no failure counted, so it can cycle; its `last_outcome` shows it. A
  batch whose job the gateway never shows (the gateway off) stays open and every tick reports
  `busy`; `v_queue` shows its leases. Neither alerts yet: `ops-metrics` reads `v_queue`.
- **2026-09-24: a lease never expires under a live job.** When a lease runs out the queue asks the
  gateway: only a refused, failed, or succeeded-and-announced job frees its IDs.
- **2026-09-24: keys by source listing ID.** Callers such as pasted links have no listing-ingest
  UUID, and the actor takes Facebook IDs, so items are keyed by `source + sourceListingId`.
  `DetailsQueueDeferredEvent` carries those IDs (rule 7's "identifiers only").
- **2026-09-24: photo lane closed** until the actor can capture photos.
- **2026-09-24: view rows are Zod in contracts** (`DetailsQueueItem`), as the other acquisition
  modules do; `contracts.test.ts` checks the Drizzle view's columns equal it.

## Open questions

`docs/questions/details-queue.md` (folded into `docs/questions.md` by the coordinator):
`excludeListingIds`; the daily cap; throttle levels; the photo lane; `submitRun`'s request key; the
default region; whether `enqueue` should place `first-seen` work by the search shape rather than
the selector's asked priority (task 1.4h). Catalogue questions 5 and 6.

## Incidents

None.
