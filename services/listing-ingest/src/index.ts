// Public API of the listing-ingest module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/listing-ingest' only, never from its internals. It turns every
// collected card row into one listing identity and one observation per run, and announces new
// and changed listings (README.md).

import { LISTING_INGEST_EVENT_BATCH_SIZE } from '@nabvy/config/modules/listing-ingest'
import {
  type AppError,
  createEvent,
  type EventEnvelope,
  err,
  ok,
  type Result,
} from '@nabvy/contracts'
import type { ApifyGatewayRunKind } from '@nabvy/contracts/modules/apify-gateway'
import { events } from '@nabvy/contracts/modules/listing-ingest'
import type { Queryable } from '@nabvy/db'
import { isOn, state } from '@nabvy/switches'
import {
  type Card,
  chunk,
  detailUpdate,
  eventKey,
  isChange,
  observationsOf,
  readCard,
} from './domain'
import {
  deleteListings,
  insertListings,
  insertSightings,
  selectCardChanged,
  selectFirstSeen,
  selectJob,
  selectListingRows,
  selectListings,
  updateFromDetail,
  updateFromSearch,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/listing-ingest'
export { cardHash, normaliseTitle } from './domain'
export { runCollectedHandler } from './handlers'

const MODULE = 'listing-ingest'

/** What one `ingest` call did. */
export interface IngestReport {
  /** False while the module or the pipeline is off: nothing was read, written or announced. */
  open: boolean
  jobId: number
  cards: number
  sightingsWritten: number
  firstSeen: string[]
  cardChanged: string[]
  /** `first-seen` and `card-changed` envelopes for the caller to publish after commit. */
  events: EventEnvelope[]
}

/**
 * Ingests one collected job (the `apify-gateway.run-collected` payload): reads its `listing` rows
 * from `apify_gateway.v_rows`, upserts one listing per `(source, source_listing_id)`, writes one
 * observation per listing (kind `search` for a search run, `detail` for a details run) and returns
 * the `first-seen` and `card-changed` events. Safe to run twice: the second run writes nothing
 * and returns the same event keys, which the transport drops.
 */
export async function ingest(
  q: Queryable,
  input: { jobId: number; kind?: ApifyGatewayRunKind },
): Promise<Result<IngestReport, AppError>> {
  const report: IngestReport = {
    open: false,
    jobId: input.jobId,
    cards: 0,
    sightingsWritten: 0,
    firstSeen: [],
    cardChanged: [],
    events: [],
  }
  if ((await state(q, MODULE)) === 'off' || !(await isOn(q, 'pipeline'))) return ok(report)
  report.open = true

  const job = await selectJob(q, input.jobId)
  if (job?.status !== 'succeeded') {
    return err({
      code: 'listing-ingest.job_not_found',
      message: `Job ${input.jobId} is not a collected job in apify_gateway.v_jobs (or the gateway is off).`,
    })
  }
  const runKind = input.kind ?? job.runKind ?? 'search'
  const fallbackSeenAt = job.collectedAt ?? job.finishedAt ?? new Date().toISOString()

  // One card per listing ID: the first row wins (one observation per card per run).
  const cards = new Map<string, Card>()
  for (const row of await selectListingRows(q, input.jobId)) {
    const card = readCard(row.item, row.seq, fallbackSeenAt)
    if (card && !cards.has(card.sourceListingId)) cards.set(card.sourceListingId, card)
  }
  report.cards = cards.size
  const ids = [...cards.keys()]

  const before = new Map(
    (await selectListings(q, 'facebook', ids)).map((row) => [row.sourceListingId, row]),
  )
  await insertListings(
    q,
    input.jobId,
    [...cards.values()].filter((card) => !before.has(card.sourceListingId)),
  )

  // Existing listings: a newer card replaces the stored values; a detail only its price and state.
  const observed = new Map<string, Card>()
  for (const [id, card] of cards) {
    const stored = before.get(id)
    if (!stored) {
      observed.set(id, card)
      continue
    }
    const next = runKind === 'details' ? detailUpdate(card, stored) : card
    observed.set(id, next)
    const newer = new Date(next.seenAt).getTime() > new Date(stored.lastSeenAt).getTime()
    if (!newer && !isChange(next, stored)) continue
    if (runKind === 'details') await updateFromDetail(q, stored.id, next)
    else await updateFromSearch(q, stored.id, input.jobId, next)
  }

  const listingIdOf = new Map(
    (await selectListings(q, 'facebook', ids)).map((row) => [row.sourceListingId, row.id]),
  )
  const rows = observationsOf([...observed.values()], runKind).flatMap((observation) => {
    const listingId = listingIdOf.get(observation.sourceListingId)
    const card = observed.get(observation.sourceListingId)
    return listingId && card ? [{ listingId, observation, card }] : []
  })
  report.sightingsWritten = await insertSightings(q, input.jobId, rows)

  report.firstSeen = await selectFirstSeen(q, input.jobId)
  report.cardChanged = await selectCardChanged(q, input.jobId)
  report.events = [
    ...chunk(report.firstSeen, LISTING_INGEST_EVENT_BATCH_SIZE).map((listingIds, i) =>
      createEvent(
        events,
        'listing-ingest.first-seen',
        1,
        { listingIds },
        {
          key: eventKey('listing-ingest.first-seen', input.jobId, i),
        },
      ),
    ),
    ...chunk(report.cardChanged, LISTING_INGEST_EVENT_BATCH_SIZE).map((listingIds, i) =>
      createEvent(
        events,
        'listing-ingest.card-changed',
        1,
        { listingIds },
        {
          key: eventKey('listing-ingest.card-changed', input.jobId, i),
        },
      ),
    ),
  ] as EventEnvelope[]
  return ok(report)
}

/**
 * Removes listings and their observations (rule 12: `seller-rights` erasure). Runs whatever the
 * switch says, so erasure always reaches the rows. Returns how many listings were removed.
 */
export async function erase(q: Queryable, listingIds: string[]): Promise<number> {
  let removed = 0
  for (const batch of chunk(listingIds, LISTING_INGEST_EVENT_BATCH_SIZE)) {
    removed += await deleteListings(q, batch)
  }
  return removed
}
