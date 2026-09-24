// Database access. Own tables from '@nabvy/db/schema/details-queue'; other modules only through
// their v_ views (packages/db/README.md): apify-gateway's `v_jobs` and `v_rows`, listing-ingest's
// `v_listings` and `v_sightings`. The queue holds no user rows, so no withUser scoping.
import {
  DETAILS_QUEUE_PRIORITIES,
  type DetailsQueueLane,
  type DetailsQueuePriority,
  type DetailsQueueReason,
  type DetailsQueueSource,
} from '@nabvy/contracts/modules/details-queue'
import type { Queryable } from '@nabvy/db'
import { vJobs, vRows } from '@nabvy/db/schema/apify-gateway'
import { batches, items, leases, vQueue } from '@nabvy/db/schema/details-queue'
import { vListings, vSightings } from '@nabvy/db/schema/listing-ingest'
import { and, asc, eq, inArray, isNull, notExists, sql } from 'drizzle-orm'

export type ItemRow = typeof items.$inferSelect
export type BatchRow = typeof batches.$inferSelect

/** Existing items for these IDs in one lane. */
export async function selectItems(
  q: Queryable,
  source: DetailsQueueSource,
  lane: DetailsQueueLane,
  sourceListingIds: string[],
): Promise<ItemRow[]> {
  if (sourceListingIds.length === 0) return []
  return q
    .select()
    .from(items)
    .where(
      and(
        eq(items.source, source),
        eq(items.lane, lane),
        inArray(items.sourceListingId, sourceListingIds),
      ),
    )
}

export interface NewItem {
  source: DetailsQueueSource
  sourceListingId: string
  lane: DetailsQueueLane
  priority: DetailsQueuePriority
  reason: DetailsQueueReason
  requestedBy: string
  regionId: string | null
  status: 'queued' | 'done'
  lastOutcome?: string
  doneAt?: Date
}

/** Inserts new items; an ID another caller inserted meanwhile is kept as it is. */
export async function insertItems(q: Queryable, rows: NewItem[]): Promise<number> {
  if (rows.length === 0) return 0
  const inserted = await q
    .insert(items)
    .values(rows)
    .onConflictDoNothing({ target: [items.source, items.sourceListingId, items.lane] })
    .returning({ id: items.id })
  return inserted.length
}

/** Raises waiting items to a higher priority (never lowers one). */
export async function raisePriority(
  q: Queryable,
  ids: string[],
  priority: DetailsQueuePriority,
): Promise<void> {
  if (ids.length === 0) return
  await q.update(items).set({ priority }).where(inArray(items.id, ids))
}

/** Puts finished items back in the queue for a caller's refresh, with fresh counters. */
export async function requeueForRefresh(
  q: Queryable,
  ids: string[],
  set: {
    priority: DetailsQueuePriority
    reason: DetailsQueueReason
    requestedBy: string
    regionId: string | null
  },
): Promise<void> {
  if (ids.length === 0) return
  await q
    .update(items)
    .set({ ...set, status: 'queued', attempts: 0, requeues: 0, deferredOn: null, doneAt: null })
    .where(and(inArray(items.id, ids), inArray(items.status, ['done', 'failed'])))
}

/** Batches not yet closed (at most one while the queue runs one details run at a time). */
export async function selectOpenBatches(q: Queryable): Promise<BatchRow[]> {
  return q.select().from(batches).where(isNull(batches.closedAt)).orderBy(asc(batches.submittedAt))
}

export async function selectBatch(q: Queryable, jobId: number): Promise<BatchRow | undefined> {
  const [row] = await q.select().from(batches).where(eq(batches.jobId, jobId))
  return row
}

/** IDs submitted on a London day, for the daily cap. */
export async function countSubmitted(q: Queryable, day: string): Promise<number> {
  const [row] = await q
    .select({ n: sql<number>`coalesce(sum(${batches.size}), 0)::int` })
    .from(batches)
    .where(eq(batches.day, day))
  return Number(row?.n ?? 0)
}

const rank = sql`array_position(array[${sql.join(
  DETAILS_QUEUE_PRIORITIES.map((p) => sql`${p}`),
  sql`, `,
)}]::text[], ${items.priority})`

const unleased = notExists(
  sql`(select 1 from ${leases} where ${leases.source} = ${items.source} and ${leases.sourceListingId} = ${items.sourceListingId})`,
)

/**
 * The next batch: the most urgent waiting item, then up to `size` waiting items of its lane and
 * region, in priority order and then oldest first. Waiting means `queued` or `deferred`, in an
 * open lane, at a priority the throttle allows, with no lease on the listing.
 */
export async function selectNextBatch(
  q: Queryable,
  opts: {
    lanes: DetailsQueueLane[]
    priorities: DetailsQueuePriority[]
    size: number
    defaultRegion: string
  },
): Promise<ItemRow[]> {
  if (opts.lanes.length === 0 || opts.priorities.length === 0 || opts.size <= 0) return []
  const waiting = and(
    inArray(items.status, ['queued', 'deferred']),
    inArray(items.lane, opts.lanes),
    inArray(items.priority, opts.priorities),
    unleased,
  )
  const order = [rank, asc(items.createdAt), asc(items.sourceListingId)] as const
  const [lead] = await q
    .select()
    .from(items)
    .where(waiting)
    .orderBy(...order)
    .limit(1)
  if (!lead) return []
  const region = lead.regionId ?? opts.defaultRegion
  return q
    .select()
    .from(items)
    .where(
      and(
        waiting,
        eq(items.lane, lead.lane),
        sql`coalesce(${items.regionId}, ${opts.defaultRegion}) = ${region}`,
      ),
    )
    .orderBy(...order)
    .limit(opts.size)
}

/** Records a submitted batch and leases its items, in the submitting transaction. */
export async function leaseBatch(
  q: Queryable,
  batch: {
    jobId: number
    source: DetailsQueueSource
    lane: DetailsQueueLane
    regionId: string
    route: 'graphql' | 'page'
    day: string
    now: Date
    expiresAt: Date
  },
  batchItems: ItemRow[],
): Promise<void> {
  await q.insert(batches).values({
    jobId: batch.jobId,
    source: batch.source,
    lane: batch.lane,
    regionId: batch.regionId,
    route: batch.route,
    size: batchItems.length,
    sourceListingIds: batchItems.map((i) => i.sourceListingId),
    day: batch.day,
    submittedAt: batch.now,
  })
  await q.insert(leases).values(
    batchItems.map((i) => ({
      source: batch.source,
      sourceListingId: i.sourceListingId,
      jobId: batch.jobId,
      expiresAt: batch.expiresAt,
    })),
  )
  await q
    .update(items)
    .set({ status: 'leased', jobId: batch.jobId, deferredOn: null })
    .where(
      inArray(
        items.id,
        batchItems.map((i) => i.id),
      ),
    )
}

/** Marks every queued item of the open lanes deferred for the day; returns the IDs newly deferred. */
export async function deferWaiting(
  q: Queryable,
  lanes: DetailsQueueLane[],
  day: string,
): Promise<{ source: string; sourceListingId: string }[]> {
  if (lanes.length === 0) return []
  return q
    .update(items)
    .set({ status: 'deferred', deferredOn: day })
    .where(and(eq(items.status, 'queued'), inArray(items.lane, lanes)))
    .returning({ source: items.source, sourceListingId: items.sourceListingId })
}

/**
 * Closes a batch once: sets `closed_at` only where it is still null. Returns false when the batch
 * is unknown or already closed, so the caller changes nothing.
 */
export async function markClosed(
  q: Queryable,
  jobId: number,
  now: Date,
  outcome: Record<string, number>,
): Promise<boolean> {
  const closed = await q
    .update(batches)
    .set({ closedAt: now, outcome })
    .where(and(eq(batches.jobId, jobId), isNull(batches.closedAt)))
    .returning({ jobId: batches.jobId })
  return closed.length > 0
}

/** The items a batch leased. */
export async function selectLeasedItems(q: Queryable, jobId: number): Promise<ItemRow[]> {
  return q
    .select()
    .from(items)
    .where(and(eq(items.jobId, jobId), eq(items.status, 'leased')))
}

export async function updateItem(
  q: Queryable,
  id: string,
  set: {
    status: 'queued' | 'done' | 'failed'
    attempts: number
    requeues: number
    lastOutcome: string
    doneAt: Date | null
  },
): Promise<void> {
  await q.update(items).set(set).where(eq(items.id, id))
}

export async function releaseLeases(q: Queryable, jobId: number): Promise<void> {
  await q.delete(leases).where(eq(leases.jobId, jobId))
}

/** The listing rows of a collected job, by listing ID (the first row of an ID wins). */
export async function selectListingRows(
  q: Queryable,
  jobId: number,
): Promise<Map<string, Record<string, unknown>>> {
  const rows = await q
    .select({ listingId: vRows.listingId, item: vRows.item })
    .from(vRows)
    .where(and(eq(vRows.jobId, jobId), eq(vRows.recordType, 'listing')))
    .orderBy(asc(vRows.seq))
  const byId = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    if (row.listingId && !byId.has(row.listingId)) {
      byId.set(row.listingId, row.item as Record<string, unknown>)
    }
  }
  return byId
}

export interface FirstSeenListing {
  listingId: string
  source: string
  sourceListingId: string
  /** The run shape of the job that first found it (`newest-check`, `sweep-broad`, …). */
  shape: string | undefined
  regionId: string | undefined
  /** The first sighting was a search card (not a details run, which is already a detail fetch). */
  fromSearch: boolean
  /** That same run already returned a verified full description for it. */
  described: boolean
}

/**
 * Loads `first-seen` listings through listing-ingest's and apify-gateway's views: the listing's
 * source ID, and the job, shape and region of its earliest sighting.
 */
export async function selectFirstSeen(
  q: Queryable,
  listingIds: string[],
): Promise<FirstSeenListing[]> {
  if (listingIds.length === 0) return []
  const rows = await q
    .selectDistinctOn([vListings.id], {
      listingId: vListings.id,
      source: vListings.source,
      sourceListingId: vListings.sourceListingId,
      kind: vSightings.kind,
      tags: vJobs.tags,
      described: sql<boolean>`exists (select 1 from ${vRows} where ${vRows.jobId} = ${vSightings.jobId} and ${vRows.listingId} = ${vListings.sourceListingId} and ${vRows.recordType} = 'listing' and ${vRows.item}->>'descriptionStatus' = 'full_verified')`,
    })
    .from(vListings)
    .innerJoin(vSightings, eq(vSightings.listingId, vListings.id))
    .leftJoin(vJobs, eq(vJobs.id, vSightings.jobId))
    .where(inArray(vListings.id, listingIds))
    .orderBy(vListings.id, asc(vSightings.seenAt), asc(vSightings.jobId))
  return rows.map((row) => {
    const tags = (row.tags ?? {}) as Record<string, unknown>
    return {
      listingId: row.listingId,
      source: row.source,
      sourceListingId: row.sourceListingId,
      shape: typeof tags.shape === 'string' ? tags.shape : undefined,
      regionId: typeof tags.region === 'string' ? tags.region : undefined,
      fromSearch: row.kind === 'search',
      described: Boolean(row.described),
    }
  })
}

/** `v_queue` rows, for readers of this module's state (switch-filtered). */
export async function selectQueue(q: Queryable, sourceListingIds?: string[]) {
  const query = q.select().from(vQueue)
  return sourceListingIds
    ? query.where(inArray(vQueue.sourceListingId, sourceListingIds))
    : query.orderBy(asc(vQueue.createdAt))
}

/** Removes every item and lease of these listings (rule 12, for `seller-rights`). */
export async function deleteListings(
  q: Queryable,
  source: DetailsQueueSource,
  sourceListingIds: string[],
): Promise<number> {
  if (sourceListingIds.length === 0) return 0
  await q
    .delete(leases)
    .where(and(eq(leases.source, source), inArray(leases.sourceListingId, sourceListingIds)))
  const deleted = await q
    .delete(items)
    .where(and(eq(items.source, source), inArray(items.sourceListingId, sourceListingIds)))
    .returning({ id: items.id })
  // The batch record keeps its size (the daily cap's count) but drops the erased IDs.
  const erased = sql`array[${sql.join(
    sourceListingIds.map((id) => sql`${id}`),
    sql`, `,
  )}]::text[]`
  await q
    .update(batches)
    .set({
      sourceListingIds: sql`array(select x from unnest(${batches.sourceListingIds}) as x where not x = any(${erased}))`,
    })
    .where(and(eq(batches.source, source), sql`${batches.sourceListingIds} && ${erased}`))
  return deleted.length
}
