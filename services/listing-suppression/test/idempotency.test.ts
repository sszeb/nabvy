import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { add, listingHash } from '../src'
import {
  ALL_ON,
  collectedAndRecorded,
  createTestDatabase,
  loadRun,
  RECORDED,
  type TestDatabase,
} from './support/database'

const recorded = loadRun(RECORDED)
const REQUEST = '01920000-0000-7000-8000-00000000a001'
const ROW0 = { source: 'facebook', sourceListingId: '1816901372840238' } as const
let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(async () => {
  await t.close()
})

const count = async () => {
  const [row] = await t.sql(`select count(*)::int as n from listing_suppression.entries`)
  return row?.n
}

describe('idempotency', () => {
  it('a replayed request writes nothing and returns the same entries and event keys', async () => {
    await collectedAndRecorded(t, recorded)
    const first = await add(t.db, { requestId: REQUEST, listings: [ROW0] })
    const second = await add(t.db, { requestId: REQUEST, listings: [ROW0, ROW0] })
    if (!first.ok || !second.ok) throw new Error('add failed')
    expect(first.value.written).toBe(3)
    expect(second.value.written).toBe(0)
    expect(second.value.entryIds).toEqual(first.value.entryIds)
    expect(second.value.events.map((e) => e.key)).toEqual(first.value.events.map((e) => e.key))
    expect(first.value.events.map((e) => e.key)).toEqual([
      `listing-suppression.changed:${REQUEST}@3:0`,
    ])
    expect(await count()).toBe(3)
  })

  it('a retry once the named listing is ingested adds its look-alikes under a new key', async () => {
    const early = await add(t.db, { requestId: REQUEST, listings: [ROW0] })
    await collectedAndRecorded(t, recorded)
    const retry = await add(t.db, { requestId: REQUEST, listings: [ROW0] })
    if (!early.ok || !retry.ok) throw new Error('add failed')
    expect(early.value.written).toBe(1)
    expect(early.value.withoutLookalike).toEqual([ROW0])
    expect(early.value.unenforcedSellerKeys).toBe(0)
    expect(retry.value.written).toBe(2)
    expect(retry.value.withoutLookalike).toEqual([])
    expect(retry.value.entryIds.slice(0, 1)).toEqual(early.value.entryIds)
    expect(retry.value.events[0]?.key).not.toBe(early.value.events[0]?.key)
  })

  it('a replay keeps the first expiry of a look-alike', async () => {
    await collectedAndRecorded(t, recorded)
    await add(
      t.db,
      { requestId: REQUEST, listings: [ROW0] },
      { now: new Date('2026-09-01T00:00:00Z') },
    )
    await add(
      t.db,
      { requestId: REQUEST, listings: [ROW0] },
      { now: new Date('2026-09-20T00:00:00Z') },
    )
    const rows = await t.sql(
      `select distinct expires_at from listing_suppression.entries where kind = 'lookalike'`,
    )
    expect(rows.map((r) => new Date(String(r.expires_at)).toISOString())).toEqual([
      '2026-11-30T00:00:00.000Z',
    ])
  })

  it('refuses a raw seller ID, a malformed request and an empty one, writing nothing', async () => {
    for (const input of [
      { requestId: REQUEST, sellerKeys: ['100064526573389'] },
      { requestId: 'not-a-uuid', listings: [ROW0] },
      { requestId: REQUEST, listings: [{ source: 'facebook', sourceListingId: 'a b' }] },
      { requestId: REQUEST },
    ]) {
      const result = await add(t.db, input as Parameters<typeof add>[1])
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'listing-suppression.invalid_input' },
      })
    }
    expect(await count()).toBe(0)
  })

  it('counts the seller keys that hide nothing yet', async () => {
    const key = createHash('sha256').update('seller-a').digest('hex')
    const result = await add(t.db, { requestId: REQUEST, sellerKeys: [key, key] })
    expect(result).toMatchObject({ ok: true, value: { written: 1, unenforcedSellerKeys: 1 } })
  })

  it('hashes a listing the same way in TypeScript and in SQL', async () => {
    const [row] = await t.asPipeline(
      `select listing_suppression.listing_hash('facebook', '1816901372840238') as h`,
    )
    expect(row?.h).toBe(listingHash(ROW0.source, ROW0.sourceListingId))
  })
})
