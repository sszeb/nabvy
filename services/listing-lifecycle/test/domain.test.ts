import {
  LISTING_LIFECYCLE_NOT_SEEN_MIN_HOURS,
  LISTING_LIFECYCLE_NOT_SEEN_MIN_MISSED_SWEEPS,
  LISTING_LIFECYCLE_RECHECK_STEPS_HOURS,
} from '@nabvy/config/modules/listing-lifecycle'
import { describe, expect, it } from 'vitest'
import {
  type DueRecheck,
  deriveStatus,
  type Evidence,
  eventKey,
  flagStatus,
  isNotSeenRecently,
  priorityFor,
  releasable,
  scheduleFor,
  statusHash,
} from '../src/domain'

const T = {
  notSeenMinMissedSweeps: LISTING_LIFECYCLE_NOT_SEEN_MIN_MISSED_SWEEPS,
  notSeenMinHours: LISTING_LIFECYCLE_NOT_SEEN_MIN_HOURS,
}
const SEEN = '2026-09-24T01:40:43.415Z'
const hoursAfter = (h: number) => new Date(new Date(SEEN).getTime() + h * 3_600_000)
const seen = (availability: 'live' | 'pending' | 'sold' | 'hidden' | 'unknown', missed = 0) =>
  ({
    last: { availability, seenAt: SEEN, kind: 'search' },
    lastUnresolvedAt: null,
    missedSweeps: missed,
  }) satisfies Evidence

describe('deriveStatus', () => {
  it('reads nothing observed as unknown, never as gone', () => {
    expect(
      deriveStatus({ last: null, lastUnresolvedAt: null, missedSweeps: 0 }, hoursAfter(0), T),
    ).toMatchObject({ status: 'unknown', basis: 'no-data', observedAt: null })
  })

  it('takes the seller flags from the latest observation', () => {
    expect(deriveStatus(seen('live'), hoursAfter(1), T).status).toBe('live')
    expect(deriveStatus(seen('pending'), hoursAfter(1), T).status).toBe('pending')
    expect(deriveStatus(seen('sold'), hoursAfter(1), T)).toMatchObject({
      status: 'marked-sold',
      basis: 'search-card',
    })
    expect(deriveStatus(seen('hidden'), hoursAfter(1), T).status).toBe('unknown')
  })

  it('never makes a listing gone after one missed sweep, however long ago', () => {
    expect(deriveStatus(seen('live', 1), hoursAfter(1000), T).status).toBe('live')
  })

  it('needs both the missed sweeps and the hours for not-seen-recently', () => {
    const missed = T.notSeenMinMissedSweeps
    expect(
      deriveStatus(seen('live', missed), hoursAfter(T.notSeenMinHours - 0.001), T).status,
    ).toBe('live')
    expect(deriveStatus(seen('live', missed), hoursAfter(T.notSeenMinHours), T)).toMatchObject({
      status: 'not-seen-recently',
      basis: 'missed-sweeps',
      observedAt: SEEN,
      missedSweeps: missed,
    })
    expect(deriveStatus(seen('pending', missed), hoursAfter(48), T).status).toBe(
      'not-seen-recently',
    )
    expect(deriveStatus(seen('live', missed - 1), hoursAfter(48), T).status).toBe('live')
  })

  it('keeps the seller sold flag whatever the absence', () => {
    expect(deriveStatus(seen('sold', 10), hoursAfter(1000), T).status).toBe('marked-sold')
  })

  it('reads an unresolved fetch as unresolved, never as sold, and a later sighting wins', () => {
    const at = hoursAfter(1).toISOString()
    const unresolved = { ...seen('live', 5), lastUnresolvedAt: at }
    expect(deriveStatus(unresolved, hoursAfter(1000), T)).toMatchObject({
      status: 'unresolved',
      basis: 'unresolved-fetch',
      observedAt: at,
      lastSeenAt: SEEN,
    })
    // A tie (the same details job) stays unresolved.
    expect(
      deriveStatus({ ...seen('unknown'), lastUnresolvedAt: SEEN }, hoursAfter(1), T).status,
    ).toBe('unresolved')
    // A never-observed listing with an unresolved fetch is unresolved.
    expect(
      deriveStatus({ last: null, lastUnresolvedAt: at, missedSweeps: 0 }, hoursAfter(2), T).status,
    ).toBe('unresolved')
    // A later observation is newer evidence.
    const back = { ...seen('live'), lastUnresolvedAt: hoursAfter(-1).toISOString() }
    expect(deriveStatus(back, hoursAfter(1), T).status).toBe('live')
  })

  it('names a detail observation as the basis', () => {
    const detail: Evidence = {
      last: { availability: 'pending', seenAt: SEEN, kind: 'detail' },
      lastUnresolvedAt: null,
      missedSweeps: 0,
    }
    expect(deriveStatus(detail, hoursAfter(1), T).basis).toBe('detail')
  })
})

describe('rules', () => {
  it('maps flags', () => {
    expect(flagStatus('unknown')).toBe('unknown')
  })

  it('bounds not-seen at the thresholds', () => {
    expect(
      isNotSeenRecently(2, SEEN, hoursAfter(24), {
        notSeenMinMissedSweeps: 2,
        notSeenMinHours: 24,
      }),
    ).toBe(true)
    expect(
      isNotSeenRecently(1, SEEN, hoursAfter(24), {
        notSeenMinMissedSweeps: 2,
        notSeenMinHours: 24,
      }),
    ).toBe(false)
  })

  it('hashes the stored fields, stable across timestamp spellings', () => {
    const derived = deriveStatus(seen('live'), hoursAfter(1), T)
    const same = { ...derived, lastSeenAt: '2026-09-24T01:40:43.415+00:00' }
    expect(statusHash('a', derived)).toBe(statusHash('a', same))
    expect(statusHash('a', derived)).not.toBe(statusHash('a', { ...derived, missedSweeps: 1 }))
    expect(statusHash('a', derived)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('schedules +6 h, +24 h, +72 h for alerted and candidate, once for watched', () => {
    expect(LISTING_LIFECYCLE_RECHECK_STEPS_HOURS).toEqual([6, 24, 72])
    expect(scheduleFor('alerted', [6, 24, 72])).toEqual([
      { step: 1, afterHours: 6 },
      { step: 2, afterHours: 24 },
      { step: 3, afterHours: 72 },
    ])
    expect(scheduleFor('candidate', [6])).toEqual([{ step: 1, afterHours: 6 }])
    expect(scheduleFor('watched', [6, 24, 72])).toEqual([{ step: 0, afterHours: 0 }])
    expect(scheduleFor('not-seen', [6, 24, 72])).toEqual([{ step: 0, afterHours: 0 }])
  })

  it('batches watched rechecks at 20, or after the wait', () => {
    const now = hoursAfter(0)
    const watched = (n: number, dueHoursAgo = 0): DueRecheck[] =>
      Array.from({ length: n }, (_, i) => ({
        id: `w${i}`,
        listingId: `l${i}`,
        sourceListingId: `${i}`,
        reason: 'watched',
        dueAt: new Date(now.getTime() - dueHoursAgo * 3_600_000).toISOString(),
      }))
    const alerted: DueRecheck = { ...watched(1)[0], id: 'a', reason: 'alerted' } as DueRecheck
    const opts = { watchedBatchMin: 20, watchedMaxWaitHours: 24 }
    expect(releasable([...watched(19), alerted], now, opts)).toEqual([alerted])
    expect(releasable(watched(20), now, opts)).toHaveLength(20)
    expect(releasable(watched(1, 23.9), now, opts)).toHaveLength(0)
    expect(releasable(watched(1, 24), now, opts)).toHaveLength(1)
    expect(releasable([], now, opts)).toEqual([])
  })

  it('puts users’ listings before sweep follow-ups', () => {
    expect(priorityFor('alerted')).toBe('shortlisted')
    expect(priorityFor('watched')).toBe('shortlisted')
    expect(priorityFor('not-seen')).toBe('sweep')
  })

  it('keeps event keys within the transport limit', () => {
    expect(eventKey('tick@2026-09-24T01:40:43.415Z', 0)).toBe(
      'listing-lifecycle.status-changed:tick@2026-09-24T01:40:43.415Z:0',
    )
    expect(eventKey('x'.repeat(600), 3).length).toBeLessThanOrEqual(512)
  })
})
