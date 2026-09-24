# @nabvy/listing-lifecycle

Keeps each listing's availability, from its latest card and detail, and schedules rechecks, without
ever calling a disappearance a sale (`docs/design/modules/listing-lifecycle.md`).

A module session edits only this folder, `packages/contracts/src/modules/listing-lifecycle.ts`,
`packages/config/src/modules/listing-lifecycle.ts`, `packages/db/src/schema/listing-lifecycle.ts`,
`packages/db/migrations/listing-lifecycle/` and `packages/db/tests/listing-lifecycle.test.sql`.

## Switch and priority

Off by default (rule 11). While off, or while the global `pipeline` switch is off, the handlers
acknowledge and write nothing, the tick sends no recheck, and `v_status` returns no rows: every
listing's status reads as unknown and cards show no availability. `requestRecheck()` keeps
recording while off (rule 11's exception), and the steps wait, never dropped. `erase` runs whatever
the switch says. Shadow behaves like on: the module has no user-facing output. P1 (the card).

## Inputs

- Event `listing-ingest.card-changed` (`listing-ingest`), handled by `cardChangedHandler`.
- Event `detail-evidence.unresolved` (`detail-evidence`), handled by `unresolvedHandler`.
- Views of `listing-ingest`: `v_listings` (listing IDs, `last_seen_at`) and `v_sightings` (every
  search and detail observation: availability, time, terms, centres).
- View of `detail-evidence`: `v_outcomes` (unresolved fetches and their times).
- `requestRecheck(q, { listingIds, reason, requestedBy })` from `notifier` (alerted), the watch
  feature (watched) and `details-selector` (candidate); none is built yet.
- `enqueue` (`details-queue`) to hand rechecks on.
- Switches `listing-lifecycle` and `pipeline`, through `@nabvy/switches` (fail closed).

## Outputs

- **Event** `listing-lifecycle.status-changed` v1 `{ listingIds }` (1–500 listing UUIDs): listings
  whose status value changed (or got a first status). Key
  `listing-lifecycle.status-changed:<trigger>:<batch>`, where the trigger is the incoming event's
  key or `tick@<time>`. Returned by `applyEvent` and `tick` in `events`; the handler publishes after
  commit, the tick's task likewise.
- **Internal view** `listing_lifecycle.v_status` (`nabvy_pipeline`; security_invoker; empty while
  off): listing_id, source, source_listing_id, status, basis, last_seen_at, observed_at,
  missed_sweeps, changed_at (`ListingLifecycleStatus`). No restricted or user-facing views.
- **Rechecks** through `details-queue.enqueue`: lane `text`, reason `recheck`, `refresh: true`,
  priority `shortlisted` (alerted, candidate, watched) or `sweep` (not-seen).
- **Functions** (`@nabvy/listing-lifecycle`): `applyEvent(q, { listingIds, key })`,
  `tick(q, { now? })` (one scheduler pass), `requestRecheck(q, request)`, `erase(q, listingIds)`,
  `cardChangedHandler`, `unresolvedHandler`, and the pure `deriveStatus`, `flagStatus`,
  `isNotSeenRecently`.

## Tables

Schema `listing_lifecycle`:

- `status`: one row per listing (`listing_id` primary key; unique `(source, source_listing_id)`):
  status, basis, last_seen_at, observed_at, missed_sweeps, input_hash (SHA-256 of the stored
  fields; the idempotency key with source and source listing ID), changed_by (the trigger that last
  changed the status), changed_at, evaluated_at (the tick's round-robin cursor).
- `rechecks`: one row per scheduled step: listing_id, source, source_listing_id, reason, step
  (0 for watched and not-seen, 1–3 for alerted and candidate), requested_by, due_at (server time),
  sent_at and outcome (`queued` or `skipped-unresolved`, set once; a trigger refuses a change).
  Unique `(listing_id, reason, step)` while pending.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Statuses | live, pending, marked-sold, unresolved, not-seen-recently, unknown | The card | Fixed |
| Seller flags | `sold` → marked-sold, `pending` → pending, `live` → live; `hidden` and `unknown` → unknown | listing-ingest's availability fold; `docs/decisions.md` "Sale signals" | Fixed (hidden: question) |
| Latest observation | Latest `v_sightings` row by time, then job, then search before detail | The card ("latest card and detail") | Fixed |
| Unresolved | An unresolved fetch at or after the latest observation; a later sighting wins | `EVIDENCE_LEDGER.md`, "A removed ID returns a `directItemUnresolved` row" (v2 only) | Fixed |
| Missed sweep | A later search job sharing a term and a centre with the listing's last search, returning other listings but not it, after its latest observation | The card | Starting value |
| Not seen recently | ≥ 2 missed sweeps and ≥ 24 h since last observed; live or pending only | 87–95% overlap of two repeats (`PARTS_INTELLIGENCE.md:278-280`); +24 h (`docs/modules.md:31`) | Starting value |
| Marked sold | The seller's flag stays; absence never replaces it; no price or date is derived | `docs/decisions.md:16` | Fixed |
| Alerted and candidate rechecks | +6 h, +24 h, +72 h | `docs/modules.md:31` | Starting value |
| Watched rechecks | Daily batches of ≥ 20; a batch that never fills goes 24 h after due | `PARTS_INTELLIGENCE.md:190-191` | Starting value (question) |
| Not-seen recheck | One step at once, `sweep` priority | `docs/modules.md:31` (gone only by a recheck) | Starting value |
| Unresolved rechecks | Skipped (`skipped-unresolved`) | Refetching a removed ID answers the same | Starting value |
| Batch | 500 listings per status pass, recheck batch and event | Rule 7; `CLAUDE.md` "Batches, not items" | Fixed |

## Fixtures and pass rate

On the real migrations in PGlite, from the recorded run
`fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/` stored as collected gateway jobs,
ingested by `listing-ingest` and recorded by `detail-evidence`:

- Stage `status` (`test/fixtures/status.fixtures.ts`), 7 cases: `status-recorded-run` (20 live);
  synthetic `missed-one-sweep` (still live), `missed-two-sweeps` (not-seen-recently, recheck
  sent), `two-quick-misses` (still live inside 24 h), `seen-again` (back to live),
  `unresolved-stays` (removed-ID row; sweeps leave it unresolved; no recheck),
  `marked-sold-stays` (the seller's flag stays). Pass rate 7/7 (2026-09-24).
- Stage `recheck` (`test/fixtures/recheck.fixtures.ts`), 4 synthetic cases: `watched-batch` (19
  wait, the 20th releases all), `watched-lone` (sent after the wait), `alerted-schedule` (+6 h,
  +24 h, +72 h; a repeat writes nothing; unknown IDs counted), `unresolved-skipped`. Pass rate 4/4
  (2026-09-24).

Other tests: `domain.test.ts` (each rule at its thresholds), `idempotency.test.ts` (an event twice,
an out-of-order older event, a tick twice, repeated requests, both handlers redelivered, unknown
listings refused before writing), `switch.test.ts` (off, paused pipeline, shadow, erase while off,
listing-ingest carrying on with this module off), `contracts.test.ts` (view rows parse; the
Drizzle view matches the contract; bounded inputs) and `packages/db/tests/listing-lifecycle.test.sql`
(grants, keys, checks, the sent-once trigger, `v_status` columns and switch filter, the view
check). No module reads `v_status` yet, so "a reader passes with this module off" waits for the
first reader.

## Decisions

- **2026-09-24: a disappearance is never a sale.** No status says "sold" or "gone": `marked-sold`
  is only the seller's own flag, `unresolved` is a fetch that could not identify the item, and
  `not-seen-recently` is repeated absence. Nothing here feeds sell-through or days-to-sell
  (`docs/decisions.md`, "Precedence", "Sale signals").
- **2026-09-24: status is derived from every stored observation, not from event order.** Handlers
  recompute from listing-ingest's and detail-evidence's views, so a late or replayed event cannot
  move a status backwards. A row is written only when its content hash changes, and the announced
  IDs are read back by `changed_by`, so a replay after a lost publish announces the same keys.
- **2026-09-24: a tick, not `first-seen`, gives new listings their first status.** The card lists
  `card-changed` and `unresolved` only; absence has no event. The tick looks at listings without a
  status or observed since, lost unresolved fetches, and long-unseen live or pending listings
  (least recently evaluated first, at most once an hour each).
- **2026-09-24: missed sweeps are counted from listing-ingest's sightings.** A sweep is a later
  search job sharing a term and a centre with the listing's last search; no other module records
  which searches ran, and a job that returned nothing is not visible (question).
- **2026-09-24: the tick's `now` is for tests.** The task calls `tick` without it and the database
  clock is used; `requestRecheck` takes no time and due times are `now()` in SQL.
- **2026-09-24: rechecks key by listing UUID** (listing-ingest's) and are handed to details-queue by
  source listing ID, Facebook only (the queue's only source).
- **2026-09-24: view rows are Zod in contracts** (`ListingLifecycleStatus`), as the other
  acquisition modules do; `contracts.test.ts` checks the Drizzle view's columns equal it.
- **2026-09-24: the gateway's conventions test lists this module's test support** beside
  listing-ingest's and detail-evidence's: it seeds collected jobs into the gateway's tables in
  PGlite (never a live database). One line in `services/apify-gateway/test/conventions.test.ts`.
- **2026-09-24: no RLS.** No user rows (a recheck names the asking module, never a user); the
  pipeline role alone has grants, `delete` only for `erase` (rule 12). The module is outside the
  T-stamp chain: `observed_at` is the evidence time and `changed_at` its own `doneAt` (rule 10).

## Open questions

`docs/questions/listing-lifecycle.md`: `hidden` availability; watched rechecks that never fill a
batch; sweeps that return nothing; recurring watched rechecks; the missed-sweeps query cost.

## Incidents

None.
