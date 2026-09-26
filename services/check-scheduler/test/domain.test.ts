import { describe, expect, it } from 'vitest'
import { defaultLimits } from '../src'
import {
  cadenceFor,
  inActiveHours,
  londonDay,
  londonDayStart,
  searchInput,
  shapeFor,
  startsNew,
  tickSlot,
} from '../src/domain'

const L = defaultLimits

describe('check-scheduler domain', () => {
  it('slows cadences in the owner order, never faster than the base', () => {
    const newest = (paid: boolean, level: Parameters<typeof cadenceFor>[2]) =>
      cadenceFor('newest', paid, level, L) / 3600
    expect([newest(true, 'none'), newest(false, 'none')]).toEqual([1, 1])
    expect([newest(true, 'slow-free'), newest(false, 'slow-free')]).toEqual([1, 2])
    expect([newest(true, 'slow-paid'), newest(false, 'slow-paid')]).toEqual([2, 4])
    expect(cadenceFor('sweep', true, 'slow-paid', L)).toBe(86_400)
    expect(cadenceFor('sweep', true, 'slow-sweeps', L)).toBe(172_800)
    expect([startsNew('slow-sweeps'), startsNew('hold-new')]).toEqual([true, false])
  })

  it('never schedules catch-up (actor test T2 dropped it)', () => {
    expect(shapeFor('catch-up', 'narrow')).toBeNull()
    expect(shapeFor('sweep', 'broad')).toBe('sweep-broad')
    expect(shapeFor('newest', 'broad')).toBe('newest-check')
  })

  it('builds search inputs inside the schema and gateway limits', () => {
    const newest = searchInput('115935195086622', ['rtx 3090', 'pc'], 'newest-check', L)
    expect(newest).toMatchObject({
      memoryMb: 512,
      timeoutSecs: 180,
      input: {
        inputVersion: 3,
        searchTerms: ['rtx 3090', 'pc'],
        cityId: '115935195086622',
        sort: 'newest',
        includeDetails: false,
        maxPagesPerSearch: 1,
        maxListings: 50,
        maxRequests: 6,
        browserFallback: false,
        useDetailCache: false,
        proxyConfiguration: { apifyProxyGroups: ['RESIDENTIAL'], apifyProxyCountry: 'GB' },
      },
    })
    const three = searchInput('1', ['a', 'b', 'c'], 'sweep-broad', L).input
    expect(three).toMatchObject({ sort: 'default', maxPagesPerSearch: 60, maxListings: 4500 })
    const twenty = searchInput(
      '1',
      Array.from({ length: 20 }, (_, i) => `t${i}`),
      'sweep-narrow',
      L,
    )
    expect(twenty.input).toMatchObject({
      maxPagesPerSearch: 10,
      maxListings: 5000,
      maxRequests: 240,
    })
    expect(() => searchInput('1', [], 'newest-check', L)).toThrow(RangeError)
  })

  it('reads slots, London days and active hours across the clock change', () => {
    expect(tickSlot(new Date('2026-09-25T12:04:59Z'), 300).toISOString()).toBe(
      '2026-09-25T12:00:00.000Z',
    )
    expect(londonDay(new Date('2026-09-25T23:30:00Z'))).toBe('2026-09-26')
    expect(londonDayStart(new Date('2026-09-25T12:00:00Z')).toISOString()).toBe(
      '2026-09-24T23:00:00.000Z',
    )
    expect(londonDayStart(new Date('2026-12-01T12:00:00Z')).toISOString()).toBe(
      '2026-12-01T00:00:00.000Z',
    )
    expect(inActiveHours(new Date('2026-09-25T06:59:00Z'), L.activeHours)).toBe(false) // 07:59
    expect(inActiveHours(new Date('2026-09-25T07:00:00Z'), L.activeHours)).toBe(true) // 08:00
    expect(inActiveHours(new Date('2026-09-25T21:00:00Z'), L.activeHours)).toBe(false) // 22:00
  })
})
