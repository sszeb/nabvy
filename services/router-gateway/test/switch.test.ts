import { state } from '@nabvy/switches'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { health, RouterError, table } from '../src'
import { createTestDatabase, openGateway, setSwitch, type TestDatabase } from './support/database'
import { harness } from './support/fake'

// Rule 11: off by default. Off (module or provider switch) refuses every call before the quota or
// the provider is touched, and writes nothing. Shadow behaves like on: the module has no
// user-facing output.

const input = { sources: [{ lon: -0.78, lat: 50.84 }], destinations: [{ lon: -1.09, lat: 50.82 }] }
const ok = { status: 200, body: { durations: [[100]], distances: [[1000]] } }

let db: TestDatabase
beforeEach(async () => {
  db = await createTestDatabase()
}, 60_000)
afterEach(() => db.close())

const calls = async () =>
  (await db.sql('select count(*)::int as n from router_gateway.router_calls'))[0]?.n

describe('router-gateway switch', () => {
  it('reads off with no seed row, and refuses', async () => {
    expect(await db.as('nabvy_pipeline', (tx) => state(tx, 'router-gateway'))).toBe('off')
    const h = harness(db, ok)
    await expect(table(input, h.deps)).rejects.toMatchObject({
      code: 'router.off',
    })
    expect(h.requests).toHaveLength(0)
    expect(await calls()).toBe(0)
  })

  it('refuses while the provider switch is off, even with the module on', async () => {
    await setSwitch(db, 'on')
    const h = harness(db, ok)
    const error = await table(input, h.deps).catch((e) => e)
    expect(error).toBeInstanceOf(RouterError)
    expect(error.code).toBe('router.off')
    expect(h.requests).toHaveLength(0)
    expect(await health(h.deps)).toMatchObject({ status: 'off' })
  })

  it('works in shadow and on', async () => {
    await openGateway(db)
    await setSwitch(db, 'shadow')
    const h = harness(db, ok)
    await table(input, h.deps)
    await setSwitch(db, 'on')
    await table(input, h.deps)
    expect(h.requests).toHaveLength(2)
    expect(await calls()).toBe(2)
  })
})
