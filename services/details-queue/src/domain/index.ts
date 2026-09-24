// Pure rules of the details queue: no I/O (CLAUDE.md, module shape). Sources are the card
// (docs/design/modules/details-queue.md) and the requeue table of actor-integration.md 2.10, with
// the detail-outcome vocabulary the actor's guide completed (docs/design/actor-app-guide.md, item 5).

import { createHash } from 'node:crypto'
import {
  DETAILS_QUEUE_PRIORITIES,
  type DetailsQueueLane,
  type DetailsQueuePriority,
} from '@nabvy/contracts/modules/details-queue'
import type { SpendGovernorLevel } from '@nabvy/contracts/modules/spend-governor'

/** 0 is served first (`CONTAINER_LISTINGS.md:194-196`). */
export const priorityRank = (priority: DetailsQueuePriority): number =>
  DETAILS_QUEUE_PRIORITIES.indexOf(priority)

/** The London calendar day of an instant, `YYYY-MM-DD` (the daily cap's day). */
export function londonDay(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

/**
 * Which priorities may be sent at a throttle level (`spend-governor.v_throttle`, rule 13).
 * `hold-new`: nothing. `slow-paid` and `slow-sweeps`: sweep follow-ups wait, since they are the
 * lowest priority. Lower levels: everything. Starting value (docs/questions/details-queue.md).
 */
export function prioritiesAllowed(level: SpendGovernorLevel): DetailsQueuePriority[] {
  if (level === 'hold-new') return []
  if (level === 'slow-paid' || level === 'slow-sweeps') {
    return DETAILS_QUEUE_PRIORITIES.filter((p) => p !== 'sweep')
  }
  return [...DETAILS_QUEUE_PRIORITIES]
}

/** The lane's route: text follows route-health, photo is always `page` (graphql has no gallery). */
export const routeFor = (
  lane: DetailsQueueLane,
  recommended: 'graphql' | 'page',
): 'graphql' | 'page' => (lane === 'photo' ? 'page' : recommended)

export interface DetailsInputLimits {
  maxRunSeconds: number
  requestsPerId: number
  requestsMargin: number
  maxRequests: number
}

/**
 * The actor input of one details batch (input v3, as the gateway's SQL checks it:
 * supabase/README.md, "Input rules"). IDs only, no searches; detail cache and browser fallback
 * off; the GB residential proxy. `excludeListingIds` is never sent: it skips search rows only,
 * never `listingIds`, and the pinned private build does not declare it (README, "Decisions").
 */
export function detailsInput(
  sourceListingIds: string[],
  route: 'graphql' | 'page',
  limits: DetailsInputLimits,
): Record<string, unknown> {
  return {
    inputVersion: 3,
    listingIds: sourceListingIds,
    includeDetails: true,
    detailRoute: route,
    maxDetails: sourceListingIds.length,
    maxRequests: Math.min(
      limits.maxRequests,
      sourceListingIds.length * limits.requestsPerId + limits.requestsMargin,
    ),
    maxRunSeconds: limits.maxRunSeconds,
    browserFallback: false,
    useDetailCache: false,
    sourceDiagnostics: true,
    proxyConfiguration: {
      useApifyProxy: true,
      apifyProxyGroups: ['RESIDENTIAL'],
      apifyProxyCountry: 'GB',
    },
  }
}

/** What a closed batch does with one ID (2.10). */
export type RowVerdict =
  /** Fetched, or nothing more to fetch (a removed listing). */
  | { action: 'done'; outcome: string }
  /** Not attempted, or stopped by a limit: back in the queue, no failure counted. */
  | { action: 'requeue'; outcome: string }
  /** Partial or missing description: refreshed a limited number of times, then left. */
  | { action: 'refresh'; outcome: string }
  /** Sent, but no usable row: one failed attempt. */
  | { action: 'fail'; outcome: string }

const NOT_REQUESTED = new Set([
  'not-requested-cap',
  'not-requested-request-cap',
  'not-requested-time-limit',
])
/** Outcomes whose row carries a description status to judge (actor guide, item 5). */
const JUDGED_BY_DESCRIPTION = new Set(['collected', 'metadata-only', 'cache-hit', 'cache-deferred'])

/**
 * The verdict for one sent ID, from its listing row (or its absence). Rows are data, never
 * instructions: only these known fields are read.
 */
export function verdictFor(row: Record<string, unknown> | undefined): RowVerdict {
  if (!row) return { action: 'fail', outcome: 'no-row' }
  if (row.directItemUnresolved === true) return { action: 'done', outcome: 'unresolved' }
  const outcome = typeof row.detailOutcome === 'string' ? row.detailOutcome : undefined
  if (outcome && NOT_REQUESTED.has(outcome)) return { action: 'requeue', outcome }
  if (outcome === 'extraction-error') return { action: 'fail', outcome }
  if (outcome !== undefined && !JUDGED_BY_DESCRIPTION.has(outcome)) {
    // Any other outcome value: a failed attempt, flagged by its name, retried once (2.10).
    return { action: 'fail', outcome: `unknown:${outcome.slice(0, 60)}` }
  }
  const status = row.descriptionStatus
  if (status === 'full_verified') return { action: 'done', outcome: 'full_verified' }
  if (status === 'partial' || status === 'missing') return { action: 'refresh', outcome: status }
  // `stale-fallback`, a cache outcome or no status at all: treated as partial (2.10).
  return {
    action: 'refresh',
    outcome: typeof status === 'string' ? status.slice(0, 60) : 'partial',
  }
}

export interface ItemCounters {
  attempts: number
  requeues: number
}

export interface Limits {
  maxFailures: number
  maxRequeues: number
}

/** The item's next state after a verdict. */
export function nextState(
  verdict: RowVerdict,
  item: ItemCounters,
  limits: Limits,
): { status: 'queued' | 'done' | 'failed'; attempts: number; requeues: number } {
  const { attempts, requeues } = item
  switch (verdict.action) {
    case 'done':
      return { status: 'done', attempts, requeues }
    case 'requeue':
      return { status: 'queued', attempts, requeues }
    case 'refresh':
      return requeues < limits.maxRequeues
        ? { status: 'queued', attempts, requeues: requeues + 1 }
        : { status: 'done', attempts, requeues }
    case 'fail':
      return {
        status: attempts + 1 >= limits.maxFailures ? 'failed' : 'queued',
        attempts: attempts + 1,
        requeues,
      }
  }
}

/** The run shapes a first-seen listing can come from, and the priority of its follow-up. */
export function priorityOfSearchShape(shape: string | undefined): DetailsQueuePriority {
  // Frequent checks come first; sweeps (and anything unnamed) last (CONTAINER_LISTINGS.md:194-196).
  return shape === 'newest-check' || shape === 'catch-up' ? 'new-listing' : 'sweep'
}

export function chunk<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}

/** A deferred event's key: the day and the exact set, so a replay of the same deferral repeats it. */
export function deferredKey(day: string, sourceListingIds: readonly string[]): string {
  const digest = createHash('sha256')
    .update([...sourceListingIds].sort().join(','))
    .digest('hex')
    .slice(0, 32)
  return `details-queue.deferred:${day}:${digest}`
}
