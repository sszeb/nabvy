import { describe, expect, it } from 'vitest'
import {
  buildChanged,
  judgeHealth,
  minuteStart,
  openrouteservice,
  orsBuild,
  safeBuild,
  utcDayStart,
  withinQuota,
} from '../src/domain'

const free = { matrix: { perDay: 500, perMinute: 40 }, directions: { perDay: 2000, perMinute: 40 } }

describe('quota', () => {
  it('allows the 500th matrix call of a day and refuses the 501st', () => {
    expect(withinQuota({ today: 499, lastMinute: 0 }, free.matrix)).toBe(true)
    expect(withinQuota({ today: 500, lastMinute: 0 }, free.matrix)).toBe(false)
  })
  it('allows the 40th call of a minute and refuses the 41st', () => {
    expect(withinQuota({ today: 39, lastMinute: 39 }, free.directions)).toBe(true)
    expect(withinQuota({ today: 40, lastMinute: 40 }, free.directions)).toBe(false)
  })
  it('counts per UTC day and a rolling minute', () => {
    const now = new Date('2026-09-25T23:30:15.000Z')
    expect(utcDayStart(now).toISOString()).toBe('2026-09-25T00:00:00.000Z')
    expect(minuteStart(now).toISOString()).toBe('2026-09-25T23:29:15.000Z')
  })
})

describe('build change', () => {
  const ors = (build: string | null) => ({ provider: 'openrouteservice' as const, build })
  it('is no change on the first call ever', () => expect(buildChanged(null, ors('a'))).toBe(false))
  it('is a change when the build differs', () =>
    expect(buildChanged(ors('a'), ors('b'))).toBe(true))
  it('is no change for the same build, or an unknown one', () => {
    expect(buildChanged(ors('a'), ors('a'))).toBe(false)
    expect(buildChanged(ors('a'), ors(null))).toBe(false)
  })
  it('is a change when the provider changes', () => {
    expect(buildChanged({ provider: 'osrm', build: 'a' }, ors('a'))).toBe(true)
  })
})

describe('health', () => {
  it('reads the newest settled call', () => {
    expect(judgeHealth([])).toBe('unknown')
    expect(judgeHealth(['pending', 'ok', 'timeout'])).toBe('ok')
    expect(judgeHealth(['refused_quota', 'network_error', 'ok'])).toBe('down')
    expect(judgeHealth(['provider_quota'])).toBe('quota')
  })
})

describe('openrouteservice mapping', () => {
  const a = { lon: -0.7792123456, lat: 50.8365 }
  const b = { lon: -1.0873, lat: 50.8198 }
  it('sends [lon, lat], sources then destinations, metres', () => {
    const request = openrouteservice.tableRequest([a], [b, a])
    expect(request.path).toBe('/v2/matrix/driving-car')
    expect(request.body).toEqual({
      locations: [
        [-0.779212, 50.8365],
        [-1.0873, 50.8198],
        [-0.779212, 50.8365],
      ],
      sources: [0],
      destinations: [1, 2],
      metrics: ['distance', 'duration'],
      units: 'm',
    })
  })
  it('asks directions for no geometry and no instructions', () => {
    const request = openrouteservice.routeRequest([a, b])
    expect(request.path).toBe('/v2/directions/driving-car/json')
    expect(request.body).toMatchObject({ units: 'm', geometry: false, instructions: false })
  })
  it('carries the key in a header only', () => {
    expect(openrouteservice.authHeader('k')).toEqual({ Authorization: 'k' })
    expect(JSON.stringify(openrouteservice.tableRequest([a], [b]))).not.toContain('k"')
  })
  it('takes the OSM date, else the graph date, as the build', () => {
    expect(orsBuild({ osm_date: '2026-09-15T20:21:03Z', graph_date: 'x' })).toBe(
      '2026-09-15T20:21:03Z',
    )
    expect(orsBuild({ osm_date: '0000-00-00T00:00:00Z', graph_date: '2026-09-20' })).toBe(
      '2026-09-20',
    )
    expect(orsBuild(undefined)).toBeNull()
  })
  it('drops a build that is not a plain date or version', () => {
    expect(safeBuild('2026-09-15T20:21:03Z')).toBe('2026-09-15T20:21:03Z')
    expect(safeBuild('<script>')).toBeNull()
    expect(safeBuild('x'.repeat(101))).toBeNull()
    expect(safeBuild(3)).toBeNull()
  })
})
