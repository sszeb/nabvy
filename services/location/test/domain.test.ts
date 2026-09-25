import { describe, expect, it } from 'vitest'
import {
  distanceKm,
  haversineKm,
  normalizePostcode,
  roundToNearest,
  townLabelFrom,
} from '../src/domain'

describe('haversineKm', () => {
  it('is zero for the same point', () => {
    expect(haversineKm({ lat: 51.5, lng: -0.1 }, { lat: 51.5, lng: -0.1 })).toBe(0)
  })

  it('matches a known great-circle distance within rounding error', () => {
    // London to Edinburgh, about 534 km (public reference figure).
    const km = haversineKm({ lat: 51.5074, lng: -0.1278 }, { lat: 55.9533, lng: -3.1883 })
    expect(km).toBeGreaterThan(530)
    expect(km).toBeLessThan(540)
  })
})

describe('roundToNearest', () => {
  it('rounds down below the midpoint', () => {
    expect(roundToNearest(11.6, 5)).toBe(10)
  })

  it('rounds up above the midpoint', () => {
    expect(roundToNearest(109.0, 5)).toBe(110)
  })

  it('rounds a tie up, like distanceKm() needs', () => {
    expect(roundToNearest(12.5, 5)).toBe(15)
    expect(roundToNearest(7.5, 5)).toBe(10)
  })

  it('is exact on a multiple of the step', () => {
    expect(roundToNearest(65, 5)).toBe(65)
  })
})

describe('distanceKm', () => {
  it('rounds to the nearest 5 km and passes the basis through unchanged', () => {
    const result = distanceKm(
      { lat: 50.836, lng: -0.775 },
      { lat: 50.732117, lng: -0.785522 },
      'coordinates',
    )
    expect(result).toEqual({ km: 10, basis: 'coordinates' })
  })

  it('carries the city_page basis when that is what the caller used', () => {
    const result = distanceKm(
      { lat: 54.5973, lng: -5.9301 },
      { lat: 55.9533, lng: -3.1883 },
      'city_page',
    )
    expect(result.basis).toBe('city_page')
    expect(result.km).toBe(230)
  })
})

describe('normalizePostcode', () => {
  it('upper-cases and inserts the standard single space', () => {
    expect(normalizePostcode('sw1a 1aa')).toBe('SW1A 1AA')
    expect(normalizePostcode('SW1A1AA')).toBe('SW1A 1AA')
  })

  it('collapses extra whitespace before re-inserting the one space', () => {
    expect(normalizePostcode('  sw1a   1aa  ')).toBe('SW1A 1AA')
  })

  it('leaves very short input as-is, upper-cased', () => {
    expect(normalizePostcode('sw1')).toBe('SW1')
  })
})

describe('townLabelFrom', () => {
  const pages = new Map([['114793255199138', { name: 'Abberley, Worcestershire' }]])

  it('returns the city page name for a known ID', () => {
    expect(townLabelFrom(pages, '114793255199138')).toBe('Abberley, Worcestershire')
  })

  it('is undefined for an ID it does not know', () => {
    expect(townLabelFrom(pages, 'unknown')).toBeUndefined()
  })
})
