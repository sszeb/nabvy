// Public API of the listing-lifecycle module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/listing-lifecycle' only, never from its internals. It keeps
// each listing's availability from its latest card and detail, and schedules rechecks through
// details-queue, without ever calling a disappearance a sale (README.md).

import {
  LISTING_LIFECYCLE_BATCH_SIZE,
  LISTING_LIFECYCLE_NOT_SEEN_MIN_HOURS,
  LISTING_LIFECYCLE_NOT_SEEN_MIN_MISSED_SWEEPS,
  LISTING_LIFECYCLE_RECHECK_STEPS_HOURS,
  LISTING_LIFECYCLE_WATCHED_BATCH_MIN,
  LISTING_LIFECYCLE_WATCHED_MAX_WAIT_HOURS,
} from '@nabvy/config/modules/listing-lifecycle'
import {
  type AppError,
  createEvent,
  type EventEnvelope,
  err,
  ok,
  type Result,
} from '@nabvy/contracts'
import {
  events,
  type ListingLifecycleRecheckReason,
  ListingLifecycleRecheckRequest,
  type ListingLifecycleRecheckRequested,
} from '@nabvy/contracts/modules/listing-lifecycle'
import type { Queryable } from '@nabvy/db'
import { enqueue } from '@nabvy/details-queue'
import { isOn, state } from '@nabvy/switches'
import {
  chunk,
  deriveStatus,
  eventKey,
  priorityFor,
  releasable,
  scheduleFor,
  statusHash,
  triggerId,
} from './domain'
import {
  dbNow,
  deleteListings,
  insertSchedules,
  markSent,
  selectChangedBy,
  selectDue,
  selectEvidence,
  selectListings,
  selectTickCandidates,
  upsertStatuses,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/listing-lifecycle'
export { deriveStatus, flagStatus, isNotSeenRecently } from './domain'
export { cardChangedHandler, unresolvedHandler } from './handlers'

const MODULE = 'listing-lifecycle'

const THRESHOLDS = {
  notSeenMinMissedSweeps: LISTING_LIFECYCLE_NOT_SEEN_MIN_MISSED_SWEEPS,
  notSeenMinHours: LISTING_LIFECYCLE_NOT_SEEN_MIN_HOURS,
}

/** Whether the module runs: its switch not off and the global pipeline on (fail closed). */
async function open(q: Queryable): Promise<boolean> {
  return (await state(q, MODULE)) !== 'off' && (await isOn(q, 'pipeline'))
}

/** What one status pass did. */
export interface ReconcileReport {
  /** False while the module or the pipeline is off: nothing was read, written or announced. */
  open: boolean
  /** Listings evaluated (those listing-ingest shows). */
  evaluated: number
  /** Status rows written (new, or evidence changed). */
  written: number
  /** Listings whose status this trigger changed. */
  changed: string[]
  /** Listings that became `not-seen-recently` and got a recheck. */
  recheckedNotSeen: number
  /** `status-changed` envelopes for the caller to publish after commit. */
  events: EventEnvelope[]
}

const emptyReconcile = (): ReconcileReport => ({
  open: false,
  evaluated: 0,
  written: 0,
  changed: [],
  recheckedNotSeen: 0,
  events: [],
})

/**
 * Recomputes the status of a batch of listings (1–500 listing-ingest UUIDs) from listing-ingest's
 * sightings and detail-evidence's fetches, writes the rows whose evidence changed, schedules a
 * detail recheck for listings that became `not-seen-recently`, and returns `status-changed` events
 * keyed on `trigger` (the incoming event's key, or the tick's). Safe to run twice: the second run
 * writes nothing and returns the same keys, read back from the stored rows.
 */
async function reconcile(
  q: Queryable,
  listingIds: string[],
  trigger: string,
  opts: { now: Date; tick: boolean },
): Promise<Omit<ReconcileReport, 'open'> & { missing: string[] }> {
  const unique = [...new Set(listingIds)]
  const located = await selectListings(q, unique)
  const known = new Set(located.map((l) => l.listingId))
  const evidence = await selectEvidence(q, [...known])
  const id = triggerId(trigger)
  const writes = located.map((l) => {
    const derived = deriveStatus(
      evidence.get(l.listingId) ?? { last: null, lastUnresolvedAt: null, missedSweeps: 0 },
      opts.now,
      THRESHOLDS,
    )
    return { ...l, derived, hash: statusHash(l.listingId, derived) }
  })
  const written = await upsertStatuses(q, writes, id, opts.tick ? opts.now : null)
  const changedRows = await selectChangedBy(q, [...known], id)
  const notSeen = located.filter((l) =>
    changedRows.some((c) => c.listingId === l.listingId && c.status === 'not-seen-recently'),
  )
  const scheduled = await insertSchedules(
    q,
    notSeen,
    'not-seen',
    scheduleFor('not-seen', LISTING_LIFECYCLE_RECHECK_STEPS_HOURS),
    MODULE,
    opts.now,
  )
  const changed = changedRows.map((c) => c.listingId)
  return {
    evaluated: located.length,
    written,
    changed,
    recheckedNotSeen: scheduled.size,
    missing: unique.filter((x) => !known.has(x)),
    events: chunk(changed, LISTING_LIFECYCLE_BATCH_SIZE).map((batch, i) =>
      createEvent(
        events,
        'listing-lifecycle.status-changed',
        1,
        { listingIds: batch },
        { key: eventKey(trigger, i) },
      ),
    ) as EventEnvelope[],
  }
}

/**
 * The status pass of an event (`listing-ingest.card-changed` or `detail-evidence.unresolved`):
 * its listing IDs, keyed on the event's key. While the module or the pipeline is off it
 * acknowledges and writes nothing. Listings listing-ingest does not show yet fail the call before
 * anything is written, so the transport retries (`listing-lifecycle.listings_not_found`).
 */
export async function applyEvent(
  q: Queryable,
  input: { listingIds: string[]; key: string },
): Promise<Result<ReconcileReport, AppError>> {
  if (!(await open(q))) return ok(emptyReconcile())
  const located = await selectListings(q, [...new Set(input.listingIds)])
  if (located.length < new Set(input.listingIds).size) {
    return err({
      code: 'listing-lifecycle.listings_not_found',
      message: `${new Set(input.listingIds).size - located.length} listings are not in listing_ingest.v_listings yet.`,
    })
  }
  const { missing: _, ...report } = await reconcile(q, input.listingIds, input.key, {
    now: await dbNow(q),
    tick: false,
  })
  return ok({ open: true, ...report })
}

/** What one scheduler tick did. */
export interface TickReport extends ReconcileReport {
  /** Recheck steps handed to details-queue. */
  rechecksQueued: number
  /** Recheck steps skipped because the listing is unresolved (a removed ID). */
  rechecksSkipped: number
  /** Due watched steps left waiting for their batch. */
  rechecksWaiting: number
}

/**
 * One scheduler tick (the Trigger.dev task calls it without `now`; the database's clock is used,
 * so every window is server time — `now` exists for tests). It re-evaluates up to 500 listings
 * (new or newly observed ones, lost unresolved events, and live or pending listings long unseen,
 * least recently evaluated first) and then hands due rechecks to details-queue in batches of up to
 * 500: alerted and candidate listings when due, watched ones in batches of 20 or more (or after a
 * day's wait), and `not-seen` ones behind users' listings. Nothing runs while the module or the
 * pipeline is off; `requestRecheck` still records.
 */
export async function tick(q: Queryable, input: { now?: Date } = {}): Promise<TickReport> {
  const report: TickReport = {
    ...emptyReconcile(),
    rechecksQueued: 0,
    rechecksSkipped: 0,
    rechecksWaiting: 0,
  }
  if (!(await open(q))) return report
  report.open = true
  const now = input.now ?? (await dbNow(q))

  const candidates = await selectTickCandidates(
    q,
    now,
    LISTING_LIFECYCLE_NOT_SEEN_MIN_HOURS,
    LISTING_LIFECYCLE_BATCH_SIZE,
  )
  const { missing: _, ...pass } = await reconcile(q, candidates, `tick@${now.toISOString()}`, {
    now,
    tick: true,
  })
  Object.assign(report, pass)

  const due = await selectDue(q, now, LISTING_LIFECYCLE_BATCH_SIZE)
  const skipped = due.filter((d) => d.status === 'unresolved')
  await markSent(
    q,
    skipped.map((d) => d.id),
    'skipped-unresolved',
    now,
  )
  report.rechecksSkipped = skipped.length
  const live = due.filter((d) => d.status !== 'unresolved' && d.source === 'facebook')
  const go = releasable(live, now, {
    watchedBatchMin: LISTING_LIFECYCLE_WATCHED_BATCH_MIN,
    watchedMaxWaitHours: LISTING_LIFECYCLE_WATCHED_MAX_WAIT_HOURS,
  })
  report.rechecksWaiting = live.length - go.length
  for (const priority of ['shortlisted', 'sweep'] as const) {
    const group = go.filter((d) => priorityFor(d.reason) === priority)
    const sourceListingIds = [...new Set(group.map((d) => d.sourceListingId))]
    for (const batch of chunk(sourceListingIds, LISTING_LIFECYCLE_BATCH_SIZE)) {
      await enqueue(q, {
        source: 'facebook',
        sourceListingIds: batch,
        priority,
        lane: 'text',
        reason: 'recheck',
        requestedBy: MODULE,
        refresh: true,
      })
    }
    await markSent(
      q,
      group.map((d) => d.id),
      'queued',
      now,
    )
    report.rechecksQueued += group.length
  }
  return report
}

/**
 * Asks for rechecks of listings another module cares about (alerted, candidate, watched). Records
 * whatever the switch says (rule 11), so no request is lost while the module is off; only the
 * tick's submission stops. A listing whose schedule for that reason is still pending gets nothing
 * new. Due times are server time.
 */
export async function requestRecheck(
  q: Queryable,
  request: ListingLifecycleRecheckRequest,
): Promise<ListingLifecycleRecheckRequested> {
  const input = ListingLifecycleRecheckRequest.parse(request)
  const unique = [...new Set(input.listingIds)]
  const located = await selectListings(q, unique)
  const scheduled = await insertSchedules(
    q,
    located,
    input.reason as ListingLifecycleRecheckReason,
    scheduleFor(input.reason, LISTING_LIFECYCLE_RECHECK_STEPS_HOURS),
    input.requestedBy,
  )
  return {
    scheduled: scheduled.size,
    alreadyScheduled: located.length - scheduled.size,
    unknown: unique.length - located.length,
  }
}

/**
 * Removes the status and rechecks of these listings (rule 12: `seller-rights` erasure). Runs
 * whatever the switch says. Returns how many statuses were removed.
 */
export async function erase(q: Queryable, listingIds: string[]): Promise<number> {
  let removed = 0
  for (const batch of chunk([...new Set(listingIds)], LISTING_LIFECYCLE_BATCH_SIZE)) {
    removed += await deleteListings(q, batch)
  }
  return removed
}
