import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { pointForPostcode } from '../src'
import { createTestDatabase, setSwitch, type TestDatabase } from './support/database'

// pointForPostcode() is location's only write path (no event handlers, README.md, "Inputs").
// Replaying it for the same postcode must write nothing new: the cache keeps the first result.

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await setSwitch(db, 'location', 'on')
}, 60_000)
afterAll(() => db.close())
afterEach(() => vi.unstubAllGlobals())

describe('pointForPostcode idempotency', () => {
  it('fetches once and writes one row for repeated lookups of the same postcode', async () => {
    const fetchSpy = vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({ status: 200, result: { latitude: 52.2, longitude: -2.2 } }),
    }))
    vi.stubGlobal('fetch', fetchSpy)

    const results = await Promise.all(
      Array.from({ length: 3 }, () => db.as('nabvy_app', (tx) => pointForPostcode(tx, 'B1 1AA'))),
    )

    for (const point of results) expect(point).toEqual({ lat: 52.2, lng: -2.2 })
    const rows = await db.sql(
      "select count(*)::int as n from location.postcode_cache where postcode = 'B1 1AA'",
    )
    expect(rows[0]?.n).toBe(1)
  })

  it('a concurrent insert of the same normalised postcode keeps the first row (onConflictDoNothing)', async () => {
    await db.sql(
      `insert into location.postcode_cache (postcode, lat, lng) values ('EC1A 1BB', 1, 1)`,
    )
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const point = await db.as('nabvy_app', (tx) => pointForPostcode(tx, 'ec1a1bb'))

    expect(point).toEqual({ lat: 1, lng: 1 })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
