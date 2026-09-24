import { describe, expect, it } from 'vitest'
import { haversineKm, nearestCentre, newCityPagesFrom, selectGrid } from '../src/domain'

describe('haversineKm', () => {
  it('is zero for the same point', () => {
    expect(haversineKm({ lat: 51.5, lng: -0.1 }, { lat: 51.5, lng: -0.1 })).toBe(0)
  })

  it('matches a known distance (London to Paris, about 344 km)', () => {
    const km = haversineKm({ lat: 51.5074, lng: -0.1278 }, { lat: 48.8566, lng: 2.3522 })
    expect(km).toBeGreaterThan(340)
    expect(km).toBeLessThan(348)
  })

  it('is symmetric', () => {
    const a = { lat: 55.955, lng: -3.209 }
    const b = { lat: 54.597, lng: -5.93 }
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 10)
  })
})

describe('nearestCentre', () => {
  const centres = [
    { cityPageId: 'a', lat: 51.0, lng: 0.0 },
    { cityPageId: 'b', lat: 52.0, lng: 0.0 },
  ]

  it('returns null with no centres', () => {
    expect(nearestCentre({ lat: 51.0, lng: 0.0 }, [])).toBeNull()
  })

  it('picks the closer of two centres', () => {
    expect(nearestCentre({ lat: 51.1, lng: 0.0 }, centres)?.cityPageId).toBe('a')
    expect(nearestCentre({ lat: 51.9, lng: 0.0 }, centres)?.cityPageId).toBe('b')
  })
})

describe('selectGrid', () => {
  const candidates = [
    {
      cityPageId: '1',
      name: 'One',
      towns: [],
      lat: 50.0,
      lng: 0.0,
      listingsSeen: 1,
      verifiedAsSearchCentre: false,
    },
    {
      cityPageId: '2',
      name: 'Two',
      towns: [],
      lat: 50.05,
      lng: 0.0,
      listingsSeen: 1,
      verifiedAsSearchCentre: false,
    },
    {
      cityPageId: '3',
      name: 'Three',
      towns: [],
      lat: 52.0,
      lng: 0.0,
      listingsSeen: 1,
      verifiedAsSearchCentre: false,
    },
    {
      cityPageId: '4',
      name: 'Four',
      towns: [],
      lat: null,
      lng: null,
      listingsSeen: 1,
      verifiedAsSearchCentre: false,
    },
  ]

  it('never picks two candidates closer than the minimum separation', () => {
    // '1' and '2' are about 5.5 km apart; only one of them can be chosen at 80 km minimum.
    const grid = selectGrid(candidates, [], 80)
    expect(grid).toContain('3')
    expect(grid.includes('1') && grid.includes('2')).toBe(false)
  })

  it('ignores candidates with no coordinate', () => {
    const grid = selectGrid(candidates, [], 80)
    expect(grid).not.toContain('4')
  })

  it('starts from forced centres and respects their separation too', () => {
    const grid = selectGrid(candidates, [{ cityPageId: 'forced', lat: 50.02, lng: 0.0 }], 80)
    // '1' and '2' are both within 80 km of the forced centre, so neither is chosen.
    expect(grid.includes('1') || grid.includes('2')).toBe(false)
    expect(grid).toContain('3')
  })

  it('is deterministic: the same input always yields the same order', () => {
    expect(selectGrid(candidates, [], 80)).toEqual(selectGrid(candidates, [], 80))
  })
})

describe('newCityPagesFrom', () => {
  const at = new Date('2026-09-24T01:40:43.415Z')

  it('adds a city page not yet known', () => {
    const additions = newCityPagesFrom(
      [{ cityPageId: 'x', townLabel: 'Poole', firstSeenAt: at }],
      new Set(),
    )
    expect(additions).toEqual([
      { cityPageId: 'x', name: 'Poole', towns: ['Poole'], firstSeenAt: at },
    ])
  })

  it('skips a city page already known', () => {
    expect(
      newCityPagesFrom([{ cityPageId: 'x', townLabel: 'Poole', firstSeenAt: at }], new Set(['x'])),
    ).toEqual([])
  })

  it('names a page with no town label after its own ID, with no towns', () => {
    expect(
      newCityPagesFrom([{ cityPageId: 'x', townLabel: null, firstSeenAt: at }], new Set()),
    ).toEqual([{ cityPageId: 'x', name: 'x', towns: [], firstSeenAt: at }])
  })

  it('adds a repeated new ID only once, keeping the first row seen', () => {
    const additions = newCityPagesFrom(
      [
        { cityPageId: 'x', townLabel: 'First', firstSeenAt: at },
        { cityPageId: 'x', townLabel: 'Second', firstSeenAt: at },
      ],
      new Set(),
    )
    expect(additions).toHaveLength(1)
    expect(additions[0]?.name).toBe('First')
  })
})
