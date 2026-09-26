import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { health, table } from '../src'
import { createTestDatabase, openGateway, type TestDatabase } from './support/database'
import { harness } from './support/fake'

// The quota guard (card): the 501st matrix call of a UTC day and the 41st of a minute are refused
// with router.quota without calling the provider, and the refusal is logged.

const input = { sources: [{ lon: -0.78, lat: 50.84 }], destinations: [{ lon: -1.09, lat: 50.82 }] }
const ok = { status: 200, body: { durations: [[100]], distances: [[1000]] } }
const now = new Date('2026-09-25T12:00:00.000Z')

let db: TestDatabase
beforeEach(async () => {
  db = await createTestDatabase()
  await openGateway(db)
}, 60_000)
afterEach(() => db.close())

async function seed(count: number, at: Date, kind = 'table', status = 'ok') {
  await db.sql(
    `insert into router_gateway.router_calls (provider, kind, location_count, status, at)
     select 'openrouteservice', $1, 2, $2, $3::timestamptz from generate_series(1, $4)`,
    [kind, status, at.toISOString(), count],
  )
}

const attempt = async () => {
  const h = harness(db, ok, () => now)
  const outcome = await table(input, h.deps).catch((e) => e)
  return { h, outcome }
}

describe('router-gateway quota', () => {
  it('makes the 500th matrix call of the day and refuses the 501st', async () => {
    await seed(499, new Date('2026-09-25T06:00:00.000Z'))
    const allowed = await attempt()
    expect(allowed.h.requests).toHaveLength(1)
    const refused = await attempt()
    expect(refused.outcome.code).toBe('router.quota')
    expect(refused.h.requests).toHaveLength(0)
    expect(refused.h.logs).toEqual([
      {
        provider: 'openrouteservice',
        kind: 'table',
        locationCount: 2,
        latencyMs: null,
        status: 'refused_quota',
      },
    ])
  })

  it('does not count yesterday, other kinds, or refusals', async () => {
    await seed(500, new Date('2026-09-24T23:59:00.000Z'))
    await seed(500, new Date('2026-09-25T06:00:00.000Z'), 'route')
    await seed(600, new Date('2026-09-25T06:00:00.000Z'), 'table', 'refused_quota')
    expect((await attempt()).h.requests).toHaveLength(1)
  })

  it('refuses the 41st call of a minute', async () => {
    await seed(40, new Date(now.getTime() - 30_000))
    const refused = await attempt()
    expect(refused.outcome.code).toBe('router.quota')
    expect(refused.h.requests).toHaveLength(0)
  })

  it('reports quota in health when both kinds are at a cap', async () => {
    await seed(500, new Date('2026-09-25T06:00:00.000Z'))
    await seed(2000, new Date('2026-09-25T06:00:00.000Z'), 'route')
    const h = harness(db, ok, () => now)
    expect(await health(h.deps)).toMatchObject({ status: 'quota' })
  })
})
