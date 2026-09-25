import { describe, expect, it } from 'vitest'
import {
  countDegraded,
  dayBefore,
  decideRampAdvance,
  emptyHealthDay,
  evaluateAlert,
  type HealthDayTotals,
  isDegradedSpike,
  londonDay,
  mergeHealthDay,
  pagesOf,
  pctDegradedOf,
} from '../src/domain'

describe('countDegraded', () => {
  it('counts browser-fallback and failed as degraded, http and unknown as not', () => {
    const searches = [
      { route: 'http' },
      { route: 'browser-fallback' },
      { route: 'failed' },
      { route: 'unknown' },
    ]
    expect(countDegraded(searches)).toEqual({ total: 4, degraded: 2 })
  })

  it('an empty batch is zero of zero', () => {
    expect(countDegraded([])).toEqual({ total: 0, degraded: 0 })
  })
})

describe('pctDegradedOf', () => {
  it('is 0 for a day with no searches, never a division by zero', () => {
    expect(pctDegradedOf(0, 0)).toBe(0)
  })

  it('divides degraded by total', () => {
    expect(pctDegradedOf(10, 3)).toBeCloseTo(0.3)
  })
})

describe('isDegradedSpike (card: "more than 10% of a day\'s searches degraded")', () => {
  it('exactly at the threshold does not alert (the card says "more than")', () => {
    expect(isDegradedSpike(0.1, 0.1)).toBe(false)
  })

  it('just above the threshold alerts', () => {
    expect(isDegradedSpike(0.11, 0.1)).toBe(true)
  })

  it('below the threshold does not alert', () => {
    expect(isDegradedSpike(0.05, 0.1)).toBe(false)
  })
})

describe('pagesOf (docs/questions/source-health.md, "what counts as a seller block page")', () => {
  it('a page with every row present is not a block page', () => {
    expect(pagesOf([true, true, true], 3)).toEqual([false])
  })

  it('a page with any row missing a seller is a block page', () => {
    expect(pagesOf([true, false, true], 3)).toEqual([true])
  })

  it('splits rows into fixed-size pages, in order', () => {
    expect(pagesOf([true, true, true, false, true], 3)).toEqual([false, true])
  })

  it('an empty presence list is no pages', () => {
    expect(pagesOf([], 20)).toEqual([])
  })
})

describe("mergeHealthDay (the pure form of the repo's SQL increments)", () => {
  it('folds one job into empty totals', () => {
    const merged = mergeHealthDay(emptyHealthDay(), {
      jobId: 1,
      searches: [{ route: 'http' }, { route: 'browser-fallback' }],
      breakerTripped: false,
      newOperationIds: ['q1'],
      sellerPresence: [true, true],
    })
    expect(merged).toEqual({
      totalSearches: 2,
      degradedSearches: 1,
      breakerTrips: 0,
      newOperationIds: ['q1'],
      blockedPages: [false],
      alerted: [],
    })
  })

  it('dedupes new operation IDs across jobs', () => {
    const first = mergeHealthDay(emptyHealthDay(), {
      jobId: 1,
      searches: [],
      breakerTripped: false,
      newOperationIds: ['q1'],
      sellerPresence: [],
    })
    const second = mergeHealthDay(first, {
      jobId: 2,
      searches: [],
      breakerTripped: false,
      newOperationIds: ['q1', 'q2'],
      sellerPresence: [],
    })
    expect(second.newOperationIds).toEqual(['q1', 'q2'])
  })
})

describe('evaluateAlert', () => {
  it('alerts degraded-spike once the share exceeds the threshold', () => {
    const totals = { ...emptyHealthDay(), totalSearches: 10, degradedSearches: 3 }
    expect(evaluateAlert(totals, 0.1)).toEqual(['degraded-spike'])
  })

  it('alerts new-operation-id when one is present', () => {
    const totals = { ...emptyHealthDay(), newOperationIds: ['q1'] }
    expect(evaluateAlert(totals, 0.1)).toEqual(['new-operation-id'])
  })

  it('does not repeat a reason already in `alerted`', () => {
    const totals: HealthDayTotals = {
      ...emptyHealthDay(),
      totalSearches: 10,
      degradedSearches: 3,
      newOperationIds: ['q1'],
      alerted: ['degraded-spike'],
    }
    expect(evaluateAlert(totals, 0.1)).toEqual(['new-operation-id'])
  })

  it('a healthy day with no new IDs alerts nothing', () => {
    const totals = { ...emptyHealthDay(), totalSearches: 10, degradedSearches: 1 }
    expect(evaluateAlert(totals, 0.1)).toEqual([])
  })
})

describe('decideRampAdvance (card: "steps of 24-48 hours ... only while 302s and fallbacks do not rise")', () => {
  const stages = [
    { maxChecksPerDay: 50, minHoursAtStage: 48 },
    { maxChecksPerDay: 100, minHoursAtStage: 48 },
  ]
  const startedAt = new Date('2026-09-20T00:00:00.000Z')
  const held = new Date('2026-09-22T00:00:00.000Z') // 48h later
  const quiet = (pctDegraded: number) => ({ pctDegraded, alerted: [] })

  it('refuses before the minimum hold time', () => {
    const now = new Date('2026-09-21T00:00:00.000Z') // 24h later
    const decision = decideRampAdvance(
      { stage: 0, startedAt },
      now,
      quiet(0.05),
      quiet(0.05),
      stages,
    )
    expect(decision).toEqual({ advance: false, reason: 'too-soon' })
  })

  it('does not advance when the degraded share rose since the previous day, even past the hold time', () => {
    const decision = decideRampAdvance(
      { stage: 0, startedAt },
      held,
      quiet(0.08),
      quiet(0.05),
      stages,
    )
    expect(decision).toEqual({ advance: false, reason: 'degraded-rate-rose' })
  })

  it('advances once the hold time has passed and the share held or improved', () => {
    const decision = decideRampAdvance(
      { stage: 0, startedAt },
      held,
      quiet(0.03),
      quiet(0.05),
      stages,
    )
    expect(decision).toEqual({ advance: true, reason: 'held-or-improved', nextStage: 1 })
  })

  it('an equal share is "not rising" and advances', () => {
    const decision = decideRampAdvance(
      { stage: 0, startedAt },
      held,
      quiet(0.05),
      quiet(0.05),
      stages,
    )
    expect(decision).toEqual({ advance: true, reason: 'held-or-improved', nextStage: 1 })
  })

  it('refuses without a baseline: no row for yesterday, or none for the day before', () => {
    expect(decideRampAdvance({ stage: 0, startedAt }, held, null, quiet(0.05), stages)).toEqual({
      advance: false,
      reason: 'no-baseline',
    })
    expect(decideRampAdvance({ stage: 0, startedAt }, held, quiet(0.05), null, stages)).toEqual({
      advance: false,
      reason: 'no-baseline',
    })
  })

  it('refuses when yesterday alerted, whatever its share did', () => {
    const decision = decideRampAdvance(
      { stage: 0, startedAt },
      held,
      { pctDegraded: 0.01, alerted: ['new-operation-id'] },
      quiet(0.05),
      stages,
    )
    expect(decision).toEqual({ advance: false, reason: 'alerted' })
  })

  it('refuses when yesterday was above the alert threshold, even if lower than the day before', () => {
    const decision = decideRampAdvance(
      { stage: 0, startedAt },
      held,
      quiet(0.4),
      quiet(0.5),
      stages,
      0.1,
    )
    expect(decision).toEqual({ advance: false, reason: 'degraded' })
  })

  it('exactly at the threshold is not "more than" and does not refuse on that ground', () => {
    const decision = decideRampAdvance(
      { stage: 0, startedAt },
      held,
      quiet(0.1),
      quiet(0.1),
      stages,
      0.1,
    )
    expect(decision).toEqual({ advance: true, reason: 'held-or-improved', nextStage: 1 })
  })

  it('never advances past the last stage', () => {
    const decision = decideRampAdvance(
      { stage: 1, startedAt },
      held,
      quiet(0.01),
      quiet(0.05),
      stages,
    )
    expect(decision).toEqual({ advance: false, reason: 'max-stage' })
  })
})

describe('dayBefore (calendar days, not clock hours)', () => {
  it('steps back one calendar day, across a month and a year', () => {
    expect(dayBefore('2026-09-24')).toBe('2026-09-23')
    expect(dayBefore('2026-10-01')).toBe('2026-09-30')
    expect(dayBefore('2026-01-01')).toBe('2025-12-31')
    expect(dayBefore('2026-09-24', 2)).toBe('2026-09-22')
  })

  it('on the clocks-forward Sunday, yesterday is still the calendar day before', () => {
    // 2026-03-29 is the BST switch: 00:30 London on the 30th is 23:30Z on the 29th, and
    // `now - 24h` would land in the 28th for that hour.
    const now = new Date('2026-03-29T23:30:00.000Z')
    expect(londonDay(now)).toBe('2026-03-30')
    expect(dayBefore(londonDay(now))).toBe('2026-03-29')
    expect(londonDay(new Date(now.getTime() - 24 * 3_600_000))).toBe('2026-03-28')
  })

  it('rejects anything that is not a calendar day', () => {
    expect(() => dayBefore('2026-9-24')).toThrow()
  })
})

describe('londonDay', () => {
  it('formats an ISO timestamp as its Europe/London calendar day', () => {
    expect(londonDay('2026-09-24T23:30:00.000Z')).toBe('2026-09-25') // BST, UTC+1
    expect(londonDay('2026-01-24T23:30:00.000Z')).toBe('2026-01-24') // GMT, UTC+0
  })
})
