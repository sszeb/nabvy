import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { add, suppressed } from '../src'
import {
  ALL_ON,
  collectedAndRecorded,
  createSampleAppView,
  createTestDatabase,
  listingIdOf,
  loadRun,
  RECORDED,
  type TestDatabase,
} from './support/database'

// Rule 11 for this module: `add` keeps recording while off; v_suppressed and is_suppressed()
// always answer; user-facing views of listings return no rows unless the module is on; and the
// module fails closed when a view it needs is empty because its owner is off.

const recorded = loadRun(RECORDED)
const REQUEST = '01920000-0000-7000-8000-00000000a001'
const ROW0 = { source: 'facebook', sourceListingId: '1816901372840238' } as const
let t: TestDatabase
let ids: string[]
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  await createSampleAppView(t)
  await collectedAndRecorded(t, recorded)
  ids = (await t.asPipeline(`select id::text as id from listing_ingest.v_listings`)).map((r) =>
    String(r.id),
  )
})
afterEach(async () => {
  await t.close()
})

const appRows = async () => {
  const [row] = await t.asApp(`select count(*)::int as n from app.v_listing_card_sample`)
  return row?.n
}
const suppressedRows = async () => {
  const [row] = await t.asPipeline(
    `select count(*)::int as n from listing_suppression.v_suppressed`,
  )
  return row?.n
}

describe('switch', () => {
  it('off: add still records, the list still answers, user-facing views return no rows', async () => {
    await t.switches({ 'listing-suppression': 'off' })
    const result = await add(t.db, { requestId: REQUEST, listings: [ROW0] })
    expect(result).toMatchObject({ ok: true, value: { written: 3 } })
    expect(await suppressedRows()).toBe(2)
    expect([...(await suppressed(t.db, ids))]).toEqual([await listingIdOf(t, ROW0.sourceListingId)])
    expect(await appRows()).toBe(0)
    await t.switches({ 'listing-suppression': 'on' })
    expect(await appRows()).toBe(19)
  })

  it('shadow: no user-facing rows either (only on shows them)', async () => {
    await t.switches({ 'listing-suppression': 'shadow' })
    expect(await appRows()).toBe(0)
  })

  it('fails closed while listing-ingest is off and a named listing is on the list', async () => {
    await t.switches({ 'listing-ingest': 'off' })
    expect((await suppressed(t.db, ids)).size).toBe(0)
    await add(t.db, { requestId: REQUEST, listings: [ROW0] })
    expect((await suppressed(t.db, ids)).size).toBe(ids.length)
    await t.switches({ 'listing-ingest': 'on' })
    expect((await suppressed(t.db, ids)).size).toBe(1)
  })

  it('fails closed while detail-evidence is off and a description look-alike is active', async () => {
    await add(t.db, { requestId: REQUEST, listings: [ROW0] })
    await t.switches({ 'detail-evidence': 'off' })
    expect((await suppressed(t.db, ids)).size).toBe(ids.length)
  })

  it('does not fail closed on expired look-alikes alone', async () => {
    await add(
      t.db,
      { requestId: REQUEST, listings: [ROW0] },
      { now: new Date('2026-01-01T00:00:00Z') },
    )
    await t.switches({ 'detail-evidence': 'off' })
    expect((await suppressed(t.db, ids)).size).toBe(1)
  })

  it('nabvy_app calls is_suppressed() but cannot read the list', async () => {
    await add(t.db, { requestId: REQUEST, listings: [ROW0] })
    const id = await listingIdOf(t, ROW0.sourceListingId)
    const [row] = await t.asApp(`select listing_suppression.is_suppressed($1::uuid) as s`, [id])
    expect(row?.s).toBe(true)
    const [nothing] = await t.asApp(`select listing_suppression.is_suppressed(null) as s`)
    expect(nothing?.s).toBe(true)
    await expect(t.asApp(`select * from listing_suppression.v_suppressed`)).rejects.toThrow(
      /permission denied/,
    )
    await expect(t.asApp(`select * from listing_suppression.entries`)).rejects.toThrow(
      /permission denied/,
    )
  })

  it('no role may update or delete an entry', async () => {
    await add(t.db, { requestId: REQUEST, listings: [ROW0] })
    await expect(
      t.asPipeline(`update listing_suppression.entries set expires_at = now()`),
    ).rejects.toThrow(/permission denied/)
    await expect(t.asPipeline(`delete from listing_suppression.entries`)).rejects.toThrow(
      /permission denied/,
    )
  })
})
