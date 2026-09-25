// Pure rules of the listing-lifecycle module: no I/O. A listing's status comes from its latest
// observation and detail fetch; a disappearance is never a sale (README.md, "Rules").
import { createHash } from 'node:crypto'
import type { ListingIngestAvailability } from '@nabvy/contracts/modules/listing-ingest'
import type {
  ListingLifecycleBasis,
  ListingLifecycleRecheckReason,
  ListingLifecycleStatusValue,
} from '@nabvy/contracts/modules/listing-lifecycle'

export interface Thresholds {
  notSeenMinMissedSweeps: number
  notSeenMinHours: number
}

/** What the module reads about one listing (listing-ingest's and detail-evidence's views). */
export interface Evidence {
  /** The latest observation, search card or detail, or null when never observed. */
  last: {
    availability: ListingIngestAvailability
    seenAt: string
    kind: 'search' | 'detail'
  } | null
  /** The latest detail fetch that could not identify the item, or null. */
  lastUnresolvedAt: string | null
  /** Later search runs of the listing's last search (same term and centre) that missed it. */
  missedSweeps: number
}

export interface Derived {
  status: ListingLifecycleStatusValue
  basis: ListingLifecycleBasis
  lastSeenAt: string | null
  observedAt: string | null
  missedSweeps: number
}

const HOUR_MS = 3_600_000
const ms = (value: string) => new Date(value).getTime()

/**
 * The status of one listing at `now`:
 * 1. nothing observed: `unknown`;
 * 2. an unresolved fetch at or after the latest observation: `unresolved` (a removed ID is not a
 *    sale, and a sweep that misses it never changes it; a later sighting does);
 * 3. the seller's flags on the latest observation: `marked-sold` or `pending`; `hidden` and
 *    `unknown` stay `unknown`;
 * 4. a live or pending listing missed by at least `notSeenMinMissedSweeps` later sweeps and not
 *    observed for `notSeenMinHours`: `not-seen-recently` (one missed sweep never is);
 * 5. otherwise `live` or `pending`.
 * `marked-sold` is the seller's own flag and is never replaced by absence.
 */
export function deriveStatus(evidence: Evidence, now: Date, t: Thresholds): Derived {
  const { last, lastUnresolvedAt, missedSweeps } = evidence
  const lastSeenAt = last?.seenAt ?? null
  if (lastUnresolvedAt && (!last || ms(lastUnresolvedAt) >= ms(last.seenAt))) {
    return {
      status: 'unresolved',
      basis: 'unresolved-fetch',
      lastSeenAt,
      observedAt: lastUnresolvedAt,
      missedSweeps,
    }
  }
  if (!last) {
    return { status: 'unknown', basis: 'no-data', lastSeenAt, observedAt: null, missedSweeps }
  }
  const basis: ListingLifecycleBasis = last.kind === 'search' ? 'search-card' : 'detail'
  const flagged = flagStatus(last.availability)
  if (
    (flagged === 'live' || flagged === 'pending') &&
    isNotSeenRecently(missedSweeps, last.seenAt, now, t)
  ) {
    return {
      status: 'not-seen-recently',
      basis: 'missed-sweeps',
      lastSeenAt,
      observedAt: last.seenAt,
      missedSweeps,
    }
  }
  return { status: flagged, basis, lastSeenAt, observedAt: last.seenAt, missedSweeps }
}

/** The seller's flags as a status: only `sold` and `pending` are the seller's own words. */
export function flagStatus(availability: ListingIngestAvailability): ListingLifecycleStatusValue {
  switch (availability) {
    case 'sold':
      return 'marked-sold'
    case 'pending':
      return 'pending'
    case 'live':
      return 'live'
    default:
      return 'unknown'
  }
}

/** Both conditions: enough missed sweeps, and long enough since the last observation. */
export function isNotSeenRecently(
  missedSweeps: number,
  lastSeenAt: string,
  now: Date,
  t: Thresholds,
): boolean {
  return (
    missedSweeps >= t.notSeenMinMissedSweeps &&
    now.getTime() - ms(lastSeenAt) >= t.notSeenMinHours * HOUR_MS
  )
}

/**
 * The content hash of a derived status (rule 8): SHA-256 of the fields the row stores. A replay
 * that derives the same row writes nothing.
 */
export function statusHash(listingId: string, derived: Derived): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        listingId,
        derived.status,
        derived.basis,
        derived.lastSeenAt && new Date(derived.lastSeenAt).toISOString(),
        derived.observedAt && new Date(derived.observedAt).toISOString(),
        derived.missedSweeps,
      ]),
    )
    .digest('hex')
}

export interface RecheckStep {
  step: number
  /** Hours after the request. */
  afterHours: number
}

/**
 * The steps a reason schedules: alerted and candidate listings at each of `stepsHours` (+6 h,
 * +24 h, +72 h), numbered from 1; watched and not-seen listings once, step 0, due at once (watched
 * ones then wait for their daily batch).
 */
export function scheduleFor(
  reason: ListingLifecycleRecheckReason,
  stepsHours: readonly number[],
): RecheckStep[] {
  if (reason === 'watched' || reason === 'not-seen') return [{ step: 0, afterHours: 0 }]
  return stepsHours.map((afterHours, i) => ({ step: i + 1, afterHours }))
}

export interface DueRecheck {
  id: string
  listingId: string
  sourceListingId: string
  reason: ListingLifecycleRecheckReason
  dueAt: string
}

/**
 * Which due rechecks go now. Watched ones go only as a batch of at least `watchedBatchMin`, or
 * once the oldest has waited `watchedMaxWaitHours` past its due time, so a lone watched listing is
 * still refreshed; every other reason goes when due.
 */
export function releasable(
  due: DueRecheck[],
  now: Date,
  opts: { watchedBatchMin: number; watchedMaxWaitHours: number },
): DueRecheck[] {
  const watched = due.filter((d) => d.reason === 'watched')
  const others = due.filter((d) => d.reason !== 'watched')
  const oldest = Math.min(...watched.map((d) => ms(d.dueAt)))
  const waitedEnough =
    watched.length > 0 && now.getTime() - oldest >= opts.watchedMaxWaitHours * HOUR_MS
  const watchedGo = watched.length >= opts.watchedBatchMin || waitedEnough
  return watchedGo ? [...others, ...watched] : others
}

/** The details-queue priority of a recheck: users' listings before sweep follow-ups. */
export function priorityFor(reason: ListingLifecycleRecheckReason): 'shortlisted' | 'sweep' {
  return reason === 'not-seen' ? 'sweep' : 'shortlisted'
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * The trigger of a status pass as stored in `changed_by`: the incoming event's key, or
 * `tick@<time>`; hashed when longer than 400 characters so the outgoing key stays within 512.
 */
export function triggerId(trigger: string): string {
  return trigger.length <= 400 ? trigger : createHash('sha256').update(trigger).digest('hex')
}

/** `listing-lifecycle.status-changed:<trigger>:<batch>`. */
export function eventKey(trigger: string, batch: number): string {
  return `listing-lifecycle.status-changed:${triggerId(trigger)}:${batch}`
}
