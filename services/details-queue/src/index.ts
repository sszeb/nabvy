// Public API of the details-queue module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/details-queue' only, never from its internals.
//
// One shared, deduplicated queue of listings that need a paid detail fetch
// (docs/design/modules/details-queue.md). `enqueue` records; `submitNext` (one scheduler tick)
// sends the next batch through apify-gateway after checking the switch, the spend throttle and the
// daily cap; `closeBatch` reads a collected run's rows and requeues per actor-integration.md 2.10.

import { readJobs, submitRun } from '@nabvy/apify-gateway'
import {
  DETAILS_QUEUE_BATCH_SIZE,
  DETAILS_QUEUE_DAILY_CAP,
  DETAILS_QUEUE_DEFAULT_REGION,
  DETAILS_QUEUE_EVENT_BATCH_SIZE,
  DETAILS_QUEUE_LEASE_SECS,
  DETAILS_QUEUE_MAX_FAILURES,
  DETAILS_QUEUE_MAX_REQUESTS,
  DETAILS_QUEUE_MAX_REQUEUES,
  DETAILS_QUEUE_MAX_RUN_SECONDS,
  DETAILS_QUEUE_MEMORY_MB,
  DETAILS_QUEUE_PHOTO_LANE_OPEN,
  DETAILS_QUEUE_REQUESTS_MARGIN,
  DETAILS_QUEUE_REQUESTS_PER_ID,
  DETAILS_QUEUE_TIMEOUT_MARGIN_SECS,
} from '@nabvy/config/modules/details-queue'
import { createEvent, type EventEnvelope, type Result } from '@nabvy/contracts'
import type {
  ApifyGatewayError,
  ApifyGatewayJob,
  ApifyGatewaySubmitRunInput,
  ApifyGatewaySubmitted,
} from '@nabvy/contracts/modules/apify-gateway'
import {
  DetailsQueueEnqueued,
  DetailsQueueEnqueueInput,
  type DetailsQueueItem,
  type DetailsQueueLane,
  type DetailsQueueSource,
  events,
} from '@nabvy/contracts/modules/details-queue'
import type { SpendGovernorLevel } from '@nabvy/contracts/modules/spend-governor'
import type { Queryable } from '@nabvy/db'
import { recommendRoute } from '@nabvy/route-health'
import { readThrottle } from '@nabvy/spend-governor'
import { isOn, state } from '@nabvy/switches'
import {
  chunk,
  deferredKey,
  detailsInput,
  londonDay,
  nextState,
  prioritiesAllowed,
  priorityRank,
  routeFor,
  verdictFor,
} from './domain'
import {
  type BatchRow,
  countSubmitted,
  deferWaiting,
  deleteListings,
  insertItems,
  leaseBatch,
  lockTick,
  markClosed,
  raisePriority,
  releaseLeases,
  requeueForRefresh,
  selectBatch,
  selectItems,
  selectLeasedItems,
  selectListingRows,
  selectNextBatch,
  selectOpenBatches,
  selectQueue,
  updateItem,
} from './repo'

export type {
  DetailsQueueDeferredEvent,
  DetailsQueueEnqueued,
  DetailsQueueEnqueueInput,
  DetailsQueueErrorCode,
  DetailsQueueItem,
  DetailsQueueLane,
  DetailsQueuePriority,
  DetailsQueueReason,
  DetailsQueueStatus,
} from '@nabvy/contracts/modules/details-queue'
export { events, module } from '@nabvy/contracts/modules/details-queue'
export {
  type FirstSeenDeps,
  firstSeenHandler,
  handleFirstSeen,
  type RunCollectedDeps,
  runCollectedHandler,
} from './handlers'

const MODULE = 'details-queue'

/**
 * Records a batch of listings that need a detail fetch. Deduplicated by source, listing ID and
 * lane: an ID already waiting or in flight is kept once (taking the higher priority); an ID
 * already fetched is skipped unless the caller asks for a refresh, because every ID sent forces a
 * paid fetch (`EVIDENCE_LEDGER.md:250-253`). Records whatever the switch says (rule 11): queued
 * work waits, visible, and is never dropped. Safe to run twice.
 */
export async function enqueue(
  q: Queryable,
  request: DetailsQueueEnqueueInput,
): Promise<DetailsQueueEnqueued> {
  const input = DetailsQueueEnqueueInput.parse(request)
  const ids = [...new Set(input.sourceListingIds)]
  const existing = new Map(
    (await selectItems(q, input.source, input.lane, ids)).map((row) => [row.sourceListingId, row]),
  )
  const fresh = ids.filter((id) => !existing.has(id))
  const raise: string[] = []
  const refresh: string[] = []
  let alreadyQueued = 0
  let skipped = 0
  for (const row of existing.values()) {
    if (row.status === 'done' || row.status === 'failed') {
      if (input.refresh) refresh.push(row.id)
      else skipped += 1
      continue
    }
    alreadyQueued += 1
    const current = row.priority as typeof input.priority
    if (row.status !== 'leased' && priorityRank(input.priority) < priorityRank(current)) {
      raise.push(row.id)
    }
  }
  const regionId = input.regionId ?? null
  const inserted = await insertItems(
    q,
    fresh.map((sourceListingId) => ({
      source: input.source,
      sourceListingId,
      lane: input.lane,
      priority: input.priority,
      reason: input.reason,
      requestedBy: input.requestedBy,
      regionId,
      status: 'queued' as const,
    })),
  )
  await raisePriority(q, raise, input.priority)
  await requeueForRefresh(q, refresh, {
    priority: input.priority,
    reason: input.reason,
    requestedBy: input.requestedBy,
    regionId,
  })
  return DetailsQueueEnqueued.parse({
    queued: inserted + refresh.length,
    alreadyQueued: alreadyQueued + (fresh.length - inserted),
    skipped,
  })
}

/**
 * The other modules one tick calls, injected so tests need no Apify, no gateway tables and no
 * budgets. `defaultPorts` wires the real ones.
 */
export interface DetailsQueuePorts {
  /** apify-gateway's `submitRun`: the only way the queue starts a run. */
  submitRun(
    q: Queryable,
    request: ApifyGatewaySubmitRunInput,
  ): Promise<Result<ApifyGatewaySubmitted, ApifyGatewayError>>
  /** apify-gateway's `readJobs`: the jobs of batches whose lease has run out. */
  readJobs(
    q: Queryable,
    jobIds: number[],
  ): Promise<Pick<ApifyGatewayJob, 'id' | 'status' | 'announcedAt'>[]>
  /** route-health's `recommendRoute`: the text lane's route for a region. */
  recommendRoute(q: Queryable, regionId: string): Promise<{ route: 'graphql' | 'page' }>
  /** spend-governor's `readThrottle`: read before every paid submit (rule 13). */
  readThrottle(q: Queryable): Promise<{ level: SpendGovernorLevel }>
}

export const defaultPorts: DetailsQueuePorts = {
  submitRun,
  readJobs,
  recommendRoute,
  readThrottle,
}

export interface TickDeps {
  ports: DetailsQueuePorts
  /** The tick's clock; defaults to now. */
  now?: Date
}

export type TickReport =
  | { status: 'off' }
  /** A batch is still in flight: one details run at a time (question 5). */
  | { status: 'busy'; jobId: number; closed: number[] }
  /** The throttle holds new paid work: nothing sent, nothing deferred. */
  | { status: 'held'; level: SpendGovernorLevel; closed: number[] }
  /** The daily cap is reached: waiting work is deferred, visibly. */
  | { status: 'capped'; day: string; deferred: number; events: EventEnvelope[]; closed: number[] }
  | { status: 'idle'; closed: number[] }
  /** apify-gateway refused the run; nothing was leased, the items wait. */
  | { status: 'refused'; error: ApifyGatewayError; closed: number[] }
  | {
      status: 'submitted'
      jobId: number
      lane: DetailsQueueLane
      regionId: string
      route: 'graphql' | 'page'
      size: number
      closed: number[]
    }

const openLanes = (): DetailsQueueLane[] =>
  DETAILS_QUEUE_PHOTO_LANE_OPEN ? ['text', 'photo'] : ['text']

/**
 * One scheduler tick, in one pipeline transaction. While the module or the pipeline is off, it
 * does nothing. Otherwise it first settles batches whose lease has run out, then — only when no
 * batch is in flight — reads the spend throttle, applies the daily cap, picks the next batch (one
 * lane, one region, at most 200 IDs, most urgent first) and submits it through apify-gateway,
 * leasing its IDs in the same transaction, so a refused submit leases nothing and a retried tick
 * finds the batch in flight. Ticks are serialised by a transaction-scoped advisory lock, so the
 * caller must run it in one transaction. The caller publishes `report.events` after commit.
 */
export async function submitNext(q: Queryable, deps: TickDeps): Promise<TickReport> {
  const now = deps.now ?? new Date()
  // One tick at a time, whatever the scheduler does: one details run at a time and the daily
  // cap both depend on it.
  await lockTick(q)
  if ((await state(q, MODULE)) === 'off' || !(await isOn(q, 'pipeline'))) return { status: 'off' }
  const { ports } = deps

  const { closed, stillOpen } = await settleExpiredLeases(q, ports, now)
  if (stillOpen) return { status: 'busy', jobId: stillOpen.jobId, closed }

  const { level } = await ports.readThrottle(q)
  const priorities = prioritiesAllowed(level)
  if (priorities.length === 0) return { status: 'held', level, closed }

  const lanes = openLanes()
  const day = londonDay(now)
  const remaining = DETAILS_QUEUE_DAILY_CAP - (await countSubmitted(q, day))
  if (remaining <= 0) {
    const deferred = await deferWaiting(q, lanes, day)
    return {
      status: 'capped',
      day,
      deferred: deferred.length,
      events: deferredEvents(deferred, day),
      closed,
    }
  }

  const batch = await selectNextBatch(q, {
    lanes,
    priorities,
    size: Math.min(DETAILS_QUEUE_BATCH_SIZE, remaining),
    defaultRegion: DETAILS_QUEUE_DEFAULT_REGION,
  })
  const lead = batch[0]
  if (!lead) return { status: 'idle', closed }

  const lane = lead.lane as DetailsQueueLane
  const source = lead.source as DetailsQueueSource
  const regionId = lead.regionId ?? DETAILS_QUEUE_DEFAULT_REGION
  const route = routeFor(
    lane,
    lane === 'text' ? (await ports.recommendRoute(q, regionId)).route : 'page',
  )
  const ids = batch.map((item) => item.sourceListingId)
  const submitted = await ports.submitRun(q, {
    shape: lane === 'text' ? 'details-text' : 'details-photo',
    input: detailsInput(ids, route, {
      maxRunSeconds: DETAILS_QUEUE_MAX_RUN_SECONDS,
      requestsPerId: DETAILS_QUEUE_REQUESTS_PER_ID,
      requestsMargin: DETAILS_QUEUE_REQUESTS_MARGIN,
      maxRequests: DETAILS_QUEUE_MAX_REQUESTS,
    }),
    memoryMb: DETAILS_QUEUE_MEMORY_MB,
    timeoutSecs: DETAILS_QUEUE_MAX_RUN_SECONDS + DETAILS_QUEUE_TIMEOUT_MARGIN_SECS,
    tags: { module: MODULE, region: regionId, purpose: lead.priority },
  })
  if (!submitted.ok) return { status: 'refused', error: submitted.error, closed }

  await leaseBatch(
    q,
    {
      jobId: submitted.value.jobId,
      source,
      lane,
      regionId,
      route,
      day,
      now,
      expiresAt: new Date(now.getTime() + DETAILS_QUEUE_LEASE_SECS * 1000),
    },
    batch,
  )
  return {
    status: 'submitted',
    jobId: submitted.value.jobId,
    lane,
    regionId,
    route,
    size: batch.length,
    closed,
  }
}

function deferredEvents(
  deferred: { source: string; sourceListingId: string }[],
  day: string,
): EventEnvelope[] {
  const ids = deferred.map((d) => d.sourceListingId).sort()
  return chunk(ids, DETAILS_QUEUE_EVENT_BATCH_SIZE).map(
    (group) =>
      createEvent(
        events,
        'details-queue.deferred',
        1,
        { source: 'facebook', sourceListingIds: group, day },
        { key: deferredKey(day, group) },
      ) as EventEnvelope,
  )
}

/**
 * Batches whose lease has run out: the job decides. Pending or running (or not visible, e.g. the
 * gateway off): the lease holds. Succeeded and announced: closed from its rows (a lost
 * `run-collected`). Refused: every ID back in the queue, no failure counted. Failed: one failed
 * attempt each. Succeeded but not announced yet: wait for the event.
 */
async function settleExpiredLeases(
  q: Queryable,
  ports: DetailsQueuePorts,
  now: Date,
): Promise<{ closed: number[]; stillOpen: BatchRow | undefined }> {
  const open = await selectOpenBatches(q)
  const expired = open.filter(
    (b) => b.submittedAt.getTime() + DETAILS_QUEUE_LEASE_SECS * 1000 <= now.getTime(),
  )
  const jobs = new Map(
    (
      await ports.readJobs(
        q,
        expired.map((b) => b.jobId),
      )
    ).map((job) => [job.id, job]),
  )
  const closed: number[] = []
  for (const batch of expired) {
    const job = jobs.get(batch.jobId)
    let done = false
    if (job?.status === 'succeeded' && job.announcedAt) {
      done = await closeBatch(q, batch.jobId, { now })
    } else if (job?.status === 'refused') {
      done = await closeBatch(q, batch.jobId, { now, withoutRows: 'requeue' })
    } else if (job?.status === 'failed') {
      done = await closeBatch(q, batch.jobId, { now, withoutRows: 'fail' })
    }
    if (done) closed.push(batch.jobId)
  }
  return { closed, stillOpen: open.find((b) => !closed.includes(b.jobId)) }
}

export interface CloseOptions {
  now?: Date
  /**
   * The job ended without rows to read: `requeue` (refused before it started: no failure) or
   * `fail` (the run failed: one failed attempt per ID).
   */
  withoutRows?: 'requeue' | 'fail'
}

/**
 * Closes a batch once: reads the collected run's listing rows (apify-gateway `v_rows`) and moves
 * each leased ID on per actor-integration.md 2.10, then releases the leases. Returns false and
 * changes nothing when the job is not one of this queue's batches or is already closed, so
 * closing a batch twice changes nothing.
 */
export async function closeBatch(
  q: Queryable,
  jobId: number,
  options: CloseOptions = {},
): Promise<boolean> {
  const now = options.now ?? new Date()
  const batch = await selectBatch(q, jobId)
  if (!batch || batch.closedAt) return false
  const rows = options.withoutRows ? new Map() : await selectListingRows(q, jobId)
  const leased = await selectLeasedItems(q, jobId)
  const outcome: Record<string, number> = {}
  const limits = {
    maxFailures: DETAILS_QUEUE_MAX_FAILURES,
    maxRequeues: DETAILS_QUEUE_MAX_REQUEUES,
  }
  const updates = leased.map((item) => {
    const verdict =
      options.withoutRows === 'requeue'
        ? ({ action: 'requeue', outcome: 'run-refused' } as const)
        : options.withoutRows === 'fail'
          ? ({ action: 'fail', outcome: 'run-failed' } as const)
          : verdictFor(rows.get(item.sourceListingId))
    const next = nextState(verdict, item, limits)
    outcome[next.status] = (outcome[next.status] ?? 0) + 1
    return { item, verdict, next }
  })
  if (!(await markClosed(q, jobId, now, outcome))) return false
  for (const { item, verdict, next } of updates) {
    await updateItem(q, item.id, {
      ...next,
      lastOutcome: verdict.outcome,
      doneAt: next.status === 'done' ? now : null,
    })
  }
  await releaseLeases(q, jobId)
  return true
}

/** `v_queue` rows (empty while the module is off), optionally for some listings. */
export async function readQueue(
  q: Queryable,
  sourceListingIds?: string[],
): Promise<DetailsQueueItem[]> {
  const iso = (d: Date | null) => (d ? d.toISOString() : null)
  return (await selectQueue(q, sourceListingIds)).map((row) => ({
    ...row,
    source: row.source as DetailsQueueItem['source'],
    lane: row.lane as DetailsQueueItem['lane'],
    priority: row.priority as DetailsQueueItem['priority'],
    status: row.status as DetailsQueueItem['status'],
    reason: row.reason as DetailsQueueItem['reason'],
    leaseExpiresAt: iso(row.leaseExpiresAt),
    doneAt: iso(row.doneAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }))
}

/** Removes these listings from the queue (rule 12, for `seller-rights`), whatever the switch says. */
export async function erase(
  q: Queryable,
  sourceListingIds: string[],
  source: DetailsQueueSource = 'facebook',
): Promise<number> {
  return deleteListings(q, source, sourceListingIds)
}
