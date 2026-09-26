import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { route } from '../src'
import { createTestDatabase, openGateway, type TestDatabase } from './support/database'
import { harness } from './support/fake'

// Rule 8: `router.build-changed` is keyed by provider and build, so the same change announced
// twice (two calls, a retry, two workers) reaches its readers once. The first call ever announces
// nothing: nothing was cached before it.

const input = {
  points: [
    { lon: -0.78, lat: 50.84 },
    { lon: -1.09, lat: 50.82 },
  ],
}
const answer = (osm: string) => ({
  status: 200,
  body: {
    routes: [{ summary: { distance: 1000, duration: 60 } }],
    metadata: { engine: { osm_date: osm } },
  },
})

let db: TestDatabase
beforeEach(async () => {
  db = await createTestDatabase()
  await openGateway(db)
}, 60_000)
afterEach(() => db.close())

describe('router-gateway idempotency', () => {
  it('announces a new build once, however often it is seen', async () => {
    const first = harness(db, answer('2026-08-01'))
    await route(input, first.deps)
    expect(first.publisher.published).toHaveLength(0)

    const next = harness(db, answer('2026-09-01'))
    await route(input, next.deps)
    await route(input, next.deps)
    const announced = next.publisher.ofType('router.build-changed')
    expect(announced).toHaveLength(1)
    expect(announced[0]).toMatchObject({
      key: 'router.build-changed:openrouteservice@2026-09-01',
      payload: { provider: 'openrouteservice', osmBuild: '2026-09-01' },
    })
  })

  it('settles a call once: a second settle of the same row changes nothing', async () => {
    const h = harness(db, answer('2026-09-01'))
    await route(input, h.deps)
    const rows = await db.sql('select status, build from router_gateway.router_calls')
    expect(rows).toEqual([{ status: 'ok', build: '2026-09-01' }])
  })
})
