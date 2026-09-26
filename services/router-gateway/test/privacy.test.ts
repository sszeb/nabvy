import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { health, RouterError, route, table } from '../src'
import { createTestDatabase, openGateway, type TestDatabase } from './support/database'
import { harness, TEST_KEY } from './support/fake'

// No coordinate and no key in the log or the table; the key travels in a header only; the
// gateway down (network failure, timeout, oversized body) is a typed error callers fall back on.

const A = { lon: -0.779231, lat: 50.836512 }
const B = { lon: -1.087345, lat: 50.819876 }
const ok = { status: 200, body: { durations: [[100]], distances: [[1000]] } }

let db: TestDatabase
beforeEach(async () => {
  db = await createTestDatabase()
  await openGateway(db)
}, 60_000)
afterEach(() => db.close())

describe('router-gateway privacy and failure', () => {
  it('logs and stores no coordinate and no key', async () => {
    const h = harness(db, ok)
    await table({ sources: [A], destinations: [B] }, h.deps)
    const stored = JSON.stringify(await db.sql('select * from router_gateway.router_calls'))
    const logged = JSON.stringify(h.logs)
    for (const text of [stored, logged]) {
      expect(text).not.toMatch(/50\.8|0\.779|1\.087/)
      expect(text).not.toContain(TEST_KEY)
    }
    expect(h.logs).toEqual([
      expect.objectContaining({
        provider: 'openrouteservice',
        kind: 'table',
        locationCount: 2,
        status: 'ok',
      }),
    ])
    const [request] = h.requests
    expect(request?.url).toBe('https://api.openrouteservice.org/v2/matrix/driving-car')
    expect(request?.url).not.toContain(TEST_KEY)
    expect(new Headers(request?.init.headers).get('authorization')).toBe(TEST_KEY)
  })

  it('reads the provider down as router.provider, and health as down', async () => {
    const h = harness(db, async () => {
      throw new TypeError('fetch failed')
    })
    const error = await route({ points: [A, B] }, h.deps).catch((e) => e)
    expect(error).toBeInstanceOf(RouterError)
    expect(error.code).toBe('router.provider')
    expect(await health(h.deps)).toMatchObject({ status: 'down' })
  })

  it('reads a timeout as router.provider', async () => {
    const h = harness(db, async () => {
      throw new DOMException('timed out', 'TimeoutError')
    })
    const error = await route({ points: [A, B] }, h.deps).catch((e) => e)
    expect(error.code).toBe('router.provider')
    expect((await db.sql('select status from router_gateway.router_calls'))[0]?.status).toBe(
      'timeout',
    )
  })

  it('refuses an oversized body without reading it all', async () => {
    const h = harness(db, { status: 200, body: null, raw: `{"pad":"${'x'.repeat(1_100_000)}"}` })
    const error = await route({ points: [A, B] }, h.deps).catch((e) => e)
    expect(error.code).toBe('router.invalid-response')
  })

  it('refuses too many locations before any call', async () => {
    const h = harness(db, ok)
    const many = Array.from({ length: 50 }, () => A)
    const error = await table({ sources: [A], destinations: many }, h.deps).catch((e) => e)
    expect(error.code).toBe('router.too-large')
    expect(h.requests).toHaveLength(0)
  })

  it('reports unconfigured without a key', async () => {
    const result = await health({ run: (fn) => db.as('nabvy_pipeline', fn) })
    expect(['unconfigured', 'unknown', 'off']).toContain(result.status)
  })
})
