import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { pointForPostcode, townLabel } from '../src'
import {
  createTestDatabase,
  insertCityPage,
  setSwitch,
  type TestDatabase,
} from './support/database'

// Rule 11 of docs/design/modules/_rules.md: off writes nothing and the module's own output reads
// as "no data"; location has no views, so "no rows" here means pointForPostcode() and townLabel()
// return nothing and touch neither the cache table nor the network.

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
}, 60_000)
afterAll(() => db.close())
afterEach(() => vi.unstubAllGlobals())

describe('location off', () => {
  it('pointForPostcode makes no network call and caches nothing', async () => {
    await setSwitch(db, 'location', 'off')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const point = await db.as('nabvy_app', (tx) => pointForPostcode(tx, 'SW1A 1AA'))

    expect(point).toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
    const rows = await db.sql('select 1 from location.postcode_cache')
    expect(rows).toHaveLength(0)
  })

  it('townLabel returns an empty map even for a known city page', async () => {
    await setSwitch(db, 'location', 'off')
    await setSwitch(db, 'city-pages', 'on')
    await insertCityPage(db, { cityPageId: '1', name: 'Chichester' })

    const labels = await db.as('nabvy_pipeline', (tx) => townLabel(tx, ['1']))

    expect(labels.size).toBe(0)
  })
})

describe('location on', () => {
  it('caches a fresh lookup and reuses it without a second network call', async () => {
    await setSwitch(db, 'location', 'on')
    const fetchSpy = vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({ status: 200, result: { latitude: 51.5, longitude: -0.1 } }),
    }))
    vi.stubGlobal('fetch', fetchSpy)

    const first = await db.as('nabvy_app', (tx) => pointForPostcode(tx, 'sw1a 1aa'))
    const second = await db.as('nabvy_app', (tx) => pointForPostcode(tx, 'SW1A 1AA'))

    expect(first).toEqual({ lat: 51.5, lng: -0.1 })
    expect(second).toEqual({ lat: 51.5, lng: -0.1 })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('townLabel reads a rows city-pages has while both switches are on', async () => {
    await setSwitch(db, 'location', 'on')
    await setSwitch(db, 'city-pages', 'on')
    await insertCityPage(db, { cityPageId: '2', name: 'Belfast' })

    const labels = await db.as('nabvy_pipeline', (tx) => townLabel(tx, ['2', 'unknown']))

    expect(labels.get('2')).toBe('Belfast')
    expect(labels.has('unknown')).toBe(false)
  })
})
