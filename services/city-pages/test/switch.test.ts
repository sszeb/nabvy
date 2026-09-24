import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listCityPages, reconcileSeen, verify } from '../src'
import { ALL_ON, createTestDatabase, type TestDatabase } from './support/database'

const ADMIN = '00000000-0000-4000-8000-0000000000a1'

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(async () => {
  await t.close()
})

const seenCount = async () => {
  const [row] = await t.sql('select count(*)::int as n from listing_ingest.listings')
  return Number(row?.n)
}
const cityPageCount = async () => {
  const [row] = await t.sql('select count(*)::int as n from city_pages.city_pages')
  return Number(row?.n)
}

describe('switch', () => {
  it('off: reconcileSeen acknowledges, writes nothing, and every view is empty', async () => {
    await t.seenListing({ sourceListingId: '1', cityPageId: 'new-page', townLabel: 'New Town' })
    expect(await seenCount()).toBe(1) // listing-ingest itself is unaffected by city-pages' switch

    await t.switches({ 'city-pages': 'off' })
    const before = await cityPageCount()
    expect(await reconcileSeen(t.db)).toEqual({ event: [] })
    expect(await cityPageCount()).toBe(before)
    expect(await listCityPages(t.db)).toEqual([])

    await t.switches({ 'city-pages': 'on' })
    expect((await reconcileSeen(t.db)).event).toHaveLength(1)
    expect(await cityPageCount()).toBe(before + 1)
    expect(await listCityPages(t.db)).toHaveLength(before + 1)

    await t.switches({ 'city-pages': 'off' })
    expect(await listCityPages(t.db)).toEqual([])
  })

  it('a paused pipeline writes nothing, even with the module on', async () => {
    await t.seenListing({ sourceListingId: '1', cityPageId: 'new-page', townLabel: 'New Town' })
    await t.switches({ pipeline: 'off' })
    const before = await cityPageCount()
    expect(await reconcileSeen(t.db)).toEqual({ event: [] })
    expect(await cityPageCount()).toBe(before)
  })

  it('shadow: runs and writes (there are no user-facing views to hide)', async () => {
    await t.switches({ 'city-pages': 'shadow' })
    await t.seenListing({ sourceListingId: '1', cityPageId: 'new-page', townLabel: 'New Town' })
    const before = await cityPageCount()
    expect((await reconcileSeen(t.db)).event).toHaveLength(1)
    expect(await cityPageCount()).toBe(before + 1)
    const appViews = await t.sql(
      `select count(*)::int as n from information_schema.views
       where table_schema = 'app' and table_name like 'v\\_city\\_pages%'`,
    )
    expect(appViews[0]?.n).toBe(0)
  })

  it('verify() also writes nothing while off', async () => {
    // An unverified grid candidate (not one of the seed's 5 already-verified centres).
    const candidate = '110092169012550'
    await t.searchOutcome({
      jobId: 1,
      searchIndex: 0,
      centreId: candidate,
      kind: 'newest',
      status: 'capped',
      controlLatitude: 51.08,
      controlLongitude: 1.16,
    })
    await t.switches({ 'city-pages': 'off' })
    expect(await verify(t.db, { cityPageId: candidate, jobId: 1, actorUserId: ADMIN })).toEqual({
      event: [],
    })
    const [row] = await t.sql('select verified from city_pages.centres where city_page_id = $1', [
      candidate,
    ])
    expect(row?.verified).toBe(false)
  })
})
