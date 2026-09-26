// Public API of the price-drop-watch module: the functions other modules, procedures and tasks
// may call. Other modules import from '@nabvy/price-drop-watch' only, never from its internals.
// Lets a user watch a listing, keeps its price history within that one listing ID, and alerts
// when its observed price falls (README.md).

import { PRICE_DROP_WATCH_BATCH_SIZE } from '@nabvy/config/modules/price-drop-watch'
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
  PriceDropWatchUnwatchInput,
  PriceDropWatchWatchInput,
} from '@nabvy/contracts/modules/price-drop-watch'
import type { Queryable } from '@nabvy/db'
import { requestRecheck } from '@nabvy/listing-lifecycle'
import { isOn, state } from '@nabvy/switches'
import {
  chunk,
  type DropCandidate,
  dedupeAnnouncements,
  eventKey,
  isDrop,
  observedDuringWatch,
} from './domain'
import {
  deactivateWatch,
  deleteWatchesForListings,
  deleteWatchesForUsers,
  insertDrops,
  listingKnown,
  selectActiveWatches,
  selectAllActiveWatchedListings,
  selectLatestPriceChanges,
  selectRelistGroupIds,
  upsertWatch,
  type Watch,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/price-drop-watch'
export { dedupeAnnouncements, isDrop } from './domain'
export { accountDeletedHandler, cardChangedHandler, mergedHandler } from './handlers'

const MODULE = 'price-drop-watch'

/**
 * Whether this module's own feature runs: its switch not off (README.md, "no watches and no drop
 * alerts" while off). Unlike details-queue's `enqueue`, listing-lifecycle's `requestRecheck` and
 * listing-suppression's `add` (rule 11's named exceptions), watching is this module's own
 * user-facing feature, not another module's infrastructure, so it follows the plain default:
 * refused while off. The global `pipeline` pause is a separate concern (background processing),
 * so it does not gate a user's own write here.
 */
async function moduleOpen(q: Queryable): Promise<boolean> {
  return (await state(q, MODULE)) !== 'off'
}

/** Whether the pipeline check-and-alert pass runs: its switch not off and the global pipeline on
 * (fail closed), for `applyEvent` and `tick`. */
async function open(q: Queryable): Promise<boolean> {
  return (await moduleOpen(q)) && (await isOn(q, 'pipeline'))
}

/**
 * Watches a listing for the user. Idempotent: watching an already-watched listing, or a listing
 * the user unwatched before, just makes it active again. Refuses a listing listing-ingest does
 * not show (never ingested, erased, or listing-ingest off), or a request made while this module
 * is off.
 */
export async function watch(
  q: Queryable,
  input: { userId: string; listingId: string },
): Promise<Result<Watch, AppError>> {
  if (!(await moduleOpen(q))) {
    return err({ code: 'price-drop-watch.module_off', message: 'price-drop-watch is off.' })
  }
  const parsed = PriceDropWatchWatchInput.parse(input)
  if (!(await listingKnown(q, parsed.listingId))) {
    return err({
      code: 'price-drop-watch.listing_not_found',
      message: `Listing ${parsed.listingId} is not in listing_ingest.v_listings.`,
    })
  }
  return ok(await upsertWatch(q, parsed))
}

/**
 * Unwatches a listing. A no-op when the user never watched it, or while this module is off (the
 * card's "no watches ... while off" applies to both directions: no state changes at all).
 */
export async function unwatch(
  q: Queryable,
  input: { userId: string; listingId: string },
): Promise<Watch | null> {
  if (!(await moduleOpen(q))) return null
  const parsed = PriceDropWatchUnwatchInput.parse(input)
  return deactivateWatch(q, parsed)
}

/** What one drop-check pass did. */
export interface CheckReport {
  /** False while the module or the pipeline is off: nothing was read, written or announced. */
  open: boolean
  /** Active watches among the given listings. */
  evaluated: number
  /** Drop candidates found (real drops observed while the watch existed; a replay finds the same
   * ones and writes nothing new). */
  candidates: number
  /** `dropped` envelopes for the caller to publish after commit. */
  events: EventEnvelope[]
}

const emptyReport = (): CheckReport => ({ open: false, evaluated: 0, candidates: 0, events: [] })

/**
 * Checks a batch of listings (1–500 listing-ingest UUIDs) for a price drop on their active
 * watches, writes every candidate to `drops` (safe to run twice: the unique key on `(watch_id,
 * card_hash)` makes a replay a no-op) and returns `dropped` events keyed on `trigger` (the
 * incoming event's key) for the drops this pass actually wrote: a drop already written by an
 * earlier pass is never announced again, and a drop observed before the watch was created is
 * never a candidate. Shared by both input events: `listing-ingest.card-changed` fires for a
 * listing's own new sighting; `relist-merge.merged` re-checks a group's members, in case a
 * relist-merge group formed after their own price change was already read (README.md,
 * "Decisions"). A candidate is always the latest observed price change on the listing, checked
 * against the last one; never the seller's displayed "previous price", and never a number this
 * module invents.
 */
export async function applyEvent(
  q: Queryable,
  input: { listingIds: string[]; key: string },
): Promise<CheckReport> {
  if (!(await open(q))) return emptyReport()
  const unique = [...new Set(input.listingIds)]
  const watches = await selectActiveWatches(q, unique)
  if (watches.length === 0) return { open: true, evaluated: 0, candidates: 0, events: [] }
  const watchedListingIds = [...new Set(watches.map((w) => w.listingId))]
  const [changes, groupIds] = await Promise.all([
    selectLatestPriceChanges(q, watchedListingIds),
    selectRelistGroupIds(q, watchedListingIds),
  ])
  const drops = new Map(
    changes.filter((c) => isDrop(c.fromMinor, c.toMinor)).map((c) => [c.listingId, c]),
  )
  const candidates: DropCandidate[] = watches.flatMap((w) => {
    const change = drops.get(w.listingId)
    if (!change || !observedDuringWatch(change.observedAt, w.watchCreatedAt)) return []
    return [
      {
        watchId: w.watchId,
        listingId: w.listingId,
        watchCreatedAt: w.watchCreatedAt,
        fromMinor: change.fromMinor,
        toMinor: change.toMinor,
        currency: change.currency,
        observedAt: change.observedAt,
        cardHash: change.cardHash,
        relistGroupId: groupIds.get(w.listingId) ?? null,
      },
    ]
  })
  if (candidates.length === 0) {
    return { open: true, evaluated: watches.length, candidates: 0, events: [] }
  }
  // Dedupe only the newly inserted drops: within a relist group, each watch's own new drop is
  // announced unless the same (relistGroupId, toMinor) was already announced in this pass. A
  // watch whose drop was already on record (a replay or a later card change) has already notified
  // its user and is not announced again.
  const inserted = await insertDrops(q, candidates)
  const announced = dedupeAnnouncements(candidates.filter((c) => inserted.has(c.watchId)))
    .filter((d) => d.announce)
    .map((d) => d.watchId)
  return {
    open: true,
    evaluated: watches.length,
    candidates: candidates.length,
    events: chunk(announced, PRICE_DROP_WATCH_BATCH_SIZE).map(
      (batch, i) =>
        createEvent(
          events,
          'price-drop-watch.dropped',
          1,
          { watchIds: batch },
          { key: eventKey(input.key, i) },
        ) as EventEnvelope,
    ),
  }
}

/**
 * Asks listing-lifecycle to refresh every actively watched listing (reason `watched`; listing-
 * lifecycle itself decides when a batch is big enough to send, or waits at most a day). Called by
 * the module's own Trigger.dev task, at least daily (README.md). Nothing runs while the module or
 * the pipeline is off. Pages through the watched listings in batches of
 * `PRICE_DROP_WATCH_BATCH_SIZE`, keyed on `listing_id`, so every one is asked for.
 */
export async function tick(q: Queryable): Promise<{ requested: number }> {
  if (!(await open(q))) return { requested: 0 }
  let requested = 0
  let after: string | null = null
  for (;;) {
    const listingIds = await selectAllActiveWatchedListings(q, after, PRICE_DROP_WATCH_BATCH_SIZE)
    if (listingIds.length === 0) break
    const result = await requestRecheck(q, { listingIds, reason: 'watched', requestedBy: MODULE })
    requested += result.scheduled
    if (listingIds.length < PRICE_DROP_WATCH_BATCH_SIZE) break
    after = listingIds[listingIds.length - 1] as string
  }
  return { requested }
}

/** Removes the watches (and their drops) of a deleted account. Rule 12: `account.deleted`. */
export async function accountDeletedEvent(q: Queryable, userIds: string[]): Promise<number> {
  return deleteWatchesForUsers(q, userIds)
}

/**
 * Removes every watch on these listings (rule 12: `seller-rights` erasure). Runs whatever the
 * switch says.
 */
export async function erase(q: Queryable, listingIds: string[]): Promise<number> {
  let removed = 0
  for (const batch of chunk([...new Set(listingIds)], PRICE_DROP_WATCH_BATCH_SIZE)) {
    removed += await deleteWatchesForListings(q, batch)
  }
  return removed
}
