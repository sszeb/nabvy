// Event handlers. Thin: parse, call the module's functions, return (rule 2). details-queue sits
// outside the T0–T7 chain as a queue (T2 belongs to details-selector, rule 10), so it stamps
// nothing; `items.created_at` and `done_at` record its own times.

import { err, ok, type Result } from '@nabvy/contracts'
import { events as apifyGatewayEvents } from '@nabvy/contracts/modules/apify-gateway'
import type {
  DetailsQueueEnqueued,
  DetailsQueueErrorCode,
  DetailsQueuePriority,
} from '@nabvy/contracts/modules/details-queue'
import { events as listingIngestEvents } from '@nabvy/contracts/modules/listing-ingest'
import type { Queryable } from '@nabvy/db'
import { defineHandler, type EventHandler } from '@nabvy/transport'
import { priorityOfSearchShape } from '../domain'
import { closeBatch, enqueue } from '../index'
import { insertItems, selectFirstSeen } from '../repo'

export interface FirstSeenDeps {
  /** Runs `fn` in one pipeline transaction: `withPipeline` in the task file. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
}

/**
 * `listing-ingest.first-seen` → the new listings a hunt's search found, queued for a detail fetch.
 * Only listings first seen on a search card are queued: search runs exist only for users' active
 * hunts (and the owner's rtx3090 test hunt), so nothing is fetched that no hunt asked for. A
 * listing first seen through a details run was fetched by it; one whose own search run already
 * returned a verified description is recorded as done, not fetched again.
 *
 * Out-of-order job replay can announce `first-seen` again for listings already queued or fetched
 * (review of PR #35): `enqueue` deduplicates on the listing ID and never re-sends a fetched listing
 * without a refresh, so a replay queues nothing and pays for nothing.
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
  const facebook = found.filter((l) => l.source === 'facebook' && l.fromSearch)

  // Already described by its own run: recorded as done, so later callers need a refresh to pay.
  const described = facebook.filter((l) => l.described)
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
      doneAt: new Date(),
    })),
  )

  const groups = new Map<
    string,
    { priority: DetailsQueuePriority; regionId?: string; ids: string[] }
  >()
  for (const l of facebook.filter((l) => !l.described)) {
    const priority = priorityOfSearchShape(l.shape)
    const key = `${priority}\n${l.regionId ?? ''}`
    const group = groups.get(key) ?? { priority, regionId: l.regionId, ids: [] }
    group.ids.push(l.sourceListingId)
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    const done = await enqueue(q, {
      sourceListingIds: group.ids,
      priority: group.priority,
      lane: 'text',
      reason: 'first-seen',
      requestedBy: 'details-queue',
      regionId: group.regionId,
    })
    total.queued += done.queued
    total.alreadyQueued += done.alreadyQueued
    total.skipped += done.skipped
  }
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
