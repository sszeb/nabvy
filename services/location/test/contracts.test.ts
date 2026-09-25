import {
  events,
  LocationDistance,
  LocationErrorCode,
  LocationPoint,
  module,
} from '@nabvy/contracts/modules/location'
import { describe, expect, it } from 'vitest'
import { distanceKm } from '../src'

describe('location contracts', () => {
  it('declares its name and no events', () => {
    expect(module).toBe('location')
    expect(events.module).toBe('location')
    expect(Object.keys(events.definitions)).toEqual([])
  })

  it('LocationPoint accepts a valid point and rejects one out of range', () => {
    expect(LocationPoint.parse({ lat: 51.5, lng: -0.1 })).toEqual({ lat: 51.5, lng: -0.1 })
    expect(() => LocationPoint.parse({ lat: 200, lng: -0.1 })).toThrow()
    expect(() => LocationPoint.parse({ lat: 51.5, lng: -0.1, extra: true })).toThrow()
  })

  it("distanceKm()'s return value round-trips through LocationDistance", () => {
    const result = distanceKm({ lat: 51.5, lng: -0.1 }, { lat: 51.5, lng: -0.1 }, 'coordinates')
    expect(LocationDistance.parse(result)).toEqual(result)
  })

  it('LocationErrorCode carries only the codes location returns', () => {
    expect(LocationErrorCode.options).toEqual(['location.provider_unavailable'])
  })
})
