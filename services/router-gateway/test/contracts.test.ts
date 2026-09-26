import { createEvent } from '@nabvy/contracts'
import {
  events,
  module,
  RouterBuildChangedEvent,
  RouterRouteResult,
  RouterTableInput,
  RouterTableResult,
} from '@nabvy/contracts/modules/router-gateway'
import { describe, expect, it } from 'vitest'

describe('router-gateway contracts', () => {
  it('declares its name and its one event', () => {
    expect(module).toBe('router-gateway')
    expect(events.module).toBe('router-gateway')
    expect(Object.keys(events.definitions)).toEqual(['router.build-changed'])
  })

  it('parses the documented shapes and refuses the obvious bad input', () => {
    expect(
      RouterTableResult.parse({
        provider: 'openrouteservice',
        build: null,
        distancesM: [[1, null]],
        durationsS: [[2, null]],
      }),
    ).toBeTruthy()
    expect(
      RouterRouteResult.safeParse({
        provider: 'openrouteservice',
        build: null,
        distanceM: -1,
        durationS: 0,
      }).success,
    ).toBe(false)
    expect(
      RouterTableInput.safeParse({
        sources: [{ lon: 181, lat: 0 }],
        destinations: [{ lon: 0, lat: 0 }],
      }).success,
    ).toBe(false)
    expect(
      RouterTableInput.safeParse({ sources: [], destinations: [{ lon: 0, lat: 0 }] }).success,
    ).toBe(false)
  })

  it('builds a thin build-changed envelope (rule 7)', () => {
    const event = createEvent(
      events,
      'router.build-changed',
      1,
      {
        provider: 'openrouteservice',
        osmBuild: '2026-09-15T20:21:03Z',
        at: '2026-09-25T12:00:00.000Z',
      },
      { key: 'router.build-changed:openrouteservice@2026-09-15T20:21:03Z' },
    )
    expect(RouterBuildChangedEvent.parse(event.payload)).toEqual(event.payload)
    expect(Object.keys(event.payload).sort()).toEqual(['at', 'osmBuild', 'provider'])
  })
})
