import { DEMAND_SIGNALS_SUPPRESSION_THRESHOLD } from '@nabvy/config/modules/demand-signals'
import { describe, expect, it } from 'vitest'
import {
  buildCells,
  isClosed,
  lastClosedWeek,
  publishedKey,
  shownCount,
  weekRange,
  weekStartOf,
} from '../src/domain'

describe('weeks', () => {
  it('starts on the Monday, 00:00 UTC', () => {
    expect(weekStartOf(new Date('2026-09-14T00:00:00Z'))).toBe('2026-09-14') // Monday
    expect(weekStartOf(new Date('2026-09-20T23:59:59Z'))).toBe('2026-09-14') // Sunday
    expect(weekStartOf(new Date('2026-09-21T00:00:00Z'))).toBe('2026-09-21')
    expect(weekStartOf(new Date('2026-01-01T12:00:00Z'))).toBe('2025-12-29') // across a year
  })

  it('is half-open and closed only once it has ended', () => {
    const { from, to } = weekRange('2026-09-14')
    expect(from.toISOString()).toBe('2026-09-14T00:00:00.000Z')
    expect(to.toISOString()).toBe('2026-09-21T00:00:00.000Z')
    expect(isClosed('2026-09-14', new Date('2026-09-20T23:59:59.999Z'))).toBe(false)
    expect(isClosed('2026-09-14', new Date('2026-09-21T00:00:00Z'))).toBe(true)
    expect(lastClosedWeek(new Date('2026-09-21T00:00:00Z'))).toBe('2026-09-14')
    expect(lastClosedWeek(new Date('2026-09-25T19:45:00Z'))).toBe('2026-09-14')
  })

  it('keys a week by date and rule version', () => {
    expect(publishedKey('2026-09-14', 'ds-1')).toBe('demand-signals.published:2026-09-14@ds-1')
  })
})

describe('suppression', () => {
  it('is 10, and a count of 9 is never shown', () => {
    expect(DEMAND_SIGNALS_SUPPRESSION_THRESHOLD).toBe(10)
    expect(shownCount(0, 10)).toBeNull()
    expect(shownCount(9, 10)).toBeNull()
    expect(shownCount(10, 10)).toBe(10)
    expect(shownCount(11, 10)).toBe(11)
  })

  it('suppresses a cell only when every count is under the threshold', () => {
    const cells = buildCells(
      [
        { centreId: 'A', family: 'f', wantCount: 9 },
        { centreId: 'A', family: 'g', wantCount: 10 },
      ],
      [],
      10,
    )
    expect(cells).toEqual([
      { centreId: 'A', family: 'f', wants: null, adverts: null, suppressed: true },
      { centreId: 'A', family: 'g', wants: 10, adverts: null, suppressed: false },
    ])
  })
})

describe('counting', () => {
  const advert = (i: number, clusterKey: string | null = null, centreId = 'A', family = 'f') => ({
    listingId: `l${i}`,
    centreId,
    family,
    clusterKey,
  })

  it('counts a copy-advert cluster once per cell', () => {
    const rows = [
      ...Array.from({ length: 9 }, (_, i) => advert(i)),
      advert(9, 'k'),
      advert(10, 'k'),
    ]
    expect(buildCells([], rows, 10)).toEqual([
      { centreId: 'A', family: 'f', wants: null, adverts: 10, suppressed: false },
    ])
  })

  it('counts a cluster once in each cell it reaches, and a listing once per family', () => {
    const rows = [
      ...Array.from({ length: 9 }, (_, i) => advert(i, null, 'B')),
      advert(9, 'k', 'A'),
      advert(10, 'k', 'B'),
      advert(10, 'k', 'B'), // a duplicate row adds nothing
    ]
    const cells = buildCells([], rows, 10)
    expect(cells.map((c) => [c.centreId, c.adverts])).toEqual([
      ['A', null],
      ['B', 10],
    ])
  })

  it('sums duplicated want rows and sorts by centre then family', () => {
    const cells = buildCells(
      [
        { centreId: 'B', family: 'f', wantCount: 5 },
        { centreId: 'A', family: 'g', wantCount: 12 },
        { centreId: 'B', family: 'f', wantCount: 5 },
      ],
      [],
      10,
    )
    expect(cells.map((c) => [c.centreId, c.family, c.wants])).toEqual([
      ['A', 'g', 12],
      ['B', 'f', 10],
    ])
  })
})
