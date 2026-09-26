// Event handlers. Thin: parse, call the module's functions, return (rule 2). details-queue sits
// outside the T0–T7 chain as a queue (T2 belongs to details-selector, rule 10), so it stamps
// nothing; `items.created_at` and `done_at` record its own times.

import { err, ok, type Result } from '@nabvy/contracts'
import { events as apifyGatewayEvents } from '@nabvy/contracts/modules/apify-gateway'
import type {
  DetailsQueueEnqueued,
  DetailsQueueErrorCode,
} from '@nabvy/contracts/modules/details-queue'
import { events as listingIngestEvents } from '@nabvy/contracts/modules/listing-ingest'
import type { Queryable } from '@nabvy/db'
import { defineHandler, type EventHandler } from '@nabvy/transport'
import { priorityOfSearchShape } from '../domain'
import { closeBatch } from '../index'
import { insertItems, markDescribed, selectFirstSeen } from '../repo'

export interface FirstSeenDeps {
  /** Runs `fn` in one pipeline transaction: `withPipeline` in the task file. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
}

/**
 * `listing-ingest.first-seen` → bookkeeping only; it enqueues nothing. Which new listings get a
 * paid detail fetch is `details-selector`'s decision (its area and category gate); it calls
 * `enqueue()` for its selections (task 1.4h). What this handler does: a listing whose first run
 * already returned a verified full description (a newest check with `includeDetails`, or a details
 * run) is recorded as done, so a later `enqueue()` for it, whichever handler runs first, skips it
 * instead of paying for a fetch it does not need. One a replay finds already waiting is marked
 * done too (review of PR #46).
 */
export async function handleFirstSeen(
  q: Queryable,
  listingIds: string[],
): Promise<Result<DetailsQueueEnqueued, { code: DetailsQueueErrorCode; message: string }>> {
  const found = await selectFirstSeen(q, listingIds)
  if (found.length < new Set(listingIds).size) {
    // listing-ingest does not show them (off, or not yet visible): retry, never drop silently.
    return err({
      code: 'details-queue.listings_not_found',
      message: `${new Set(listingIds).size - found.length} first-seen listings are not in listing_ingest.v_listings`,
    })
  }
  const total: DetailsQueueEnqueued = { queued: 0, alreadyQueued: 0, skipped: 0 }
  const described = found.filter((l) => l.source === 'facebook' && l.described)
  const now = new Date()
  total.skipped += await insertItems(
    q,
    described.map((l) => ({
      source: 'facebook' as const,
      sourceListingId: l.sourceListingId,
      lane: 'text' as const,
      priority: priorityOfSearchShape(l.shape),
      reason: 'first-seen' as const,
      requestedBy: 'details-queue',
      regionId: l.regionId ?? null,
      status: 'done' as const,
      lastOutcome: 'full_verified',
      doneAt: now,
    })),
  )
  total.skipped += await markDescribed(
    q,
    'facebook',
    described.map((l) => l.sourceListingId),
    now,
  )
  return ok(total)
}

export function firstSeenHandler(deps: FirstSeenDeps): EventHandler {
  return defineHandler({
    consumer: 'details-queue',
    registry: listingIngestEvents,
    type: 'listing-ingest.first-seen',
    async handle(event) {
      const result = await deps.transaction((q) => handleFirstSeen(q, event.payload.listingIds))
      return result.ok ? ok(undefined) : result
    },
  })
}

export type RunCollectedDeps = FirstSeenDeps

/**
 * `apify-gateway.run-collected` for a details run → `closeBatch`. Search runs, and details runs
 * this queue did not submit, are acknowledged and ignored; a second delivery finds the batch
 * closed and changes nothing. Closing is bookkeeping for work already paid for, so it runs
 * whatever the switch says: a batch in flight when the module is switched off still closes.
 */
export function runCollectedHandler(deps: RunCollectedDeps): EventHandler {
  return defineHandler({
    consumer: 'details-queue',
    registry: apifyGatewayEvents,
    type: 'apify-gateway.run-collected',
    async handle(event, ctx) {
      if (event.payload.kind !== 'details') return ok(undefined)
      await deps.transaction((q) => closeBatch(q, event.payload.jobId, { now: new Date(ctx.at) }))
      return ok(undefined)
    },
  })
}
