import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { erase, select } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  IN_AREA_CITY_PAGE_ID,
  listingRows,
  loadRun,
  RECORDED,
  type TestDatabase,
  upstream,
  withCityPage,
} from './support/database'

const recorded = loadRun(RECORDED)
const rows = listingRows(recorded)
const original = rows.find((row) => row.listingId === '1816901372840238') as Record<string, unknown>
const inAreaRow = withCityPage(original, IN_AREA_CITY_PAGE_ID)

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(async () => {
  await t.close()
})

const selections = async () =>
  Number((await t.sql('select count(*)::int as n from details_selector.selections'))[0]?.n)
const visible = async () =>
  Number((await t.asPipeline('select count(*)::int as n from details_selector.v_selections'))[0]?.n)
const queued = async () =>
  Number((await t.sql('select count(*)::int as n from details_queue.items'))[0]?.n)

describe('switch', () => {
  it('off: acknowledges, writes nothing, and the view is empty', async () => {
    const [listingId] = await upstream(t, recorded, [inAreaRow])
    await t.switches({ 'details-selector': 'off' })
    const result = await select(t.db, { listingIds: [listingId as string] })
    expect(result.ok && result.value).toMatchObject({ open: false, selected: [] })
    expect(await selections()).toBe(0)
    expect(await visible()).toBe(0)
    expect(await queued()).toBe(0)
  })

  it('a paused pipeline writes nothing', async () => {
    const [listingId] = await upstream(t, recorded, [inAreaRow])
    await t.switches({ pipeline: 'off' })
    const result = await select(t.db, { listingIds: [listingId as string] })
    expect(result.ok && result.value.open).toBe(false)
    expect(await selections()).toBe(0)
  })

  it('shadow runs, writes and shows internal rows (there is no user-facing output)', async () => {
    const [listingId] = await upstream(t, recorded, [inAreaRow])
    await t.switches({ 'details-selector': 'shadow' })
    const result = await select(t.db, { listingIds: [listingId as string] })
    expect(result.ok && result.value.selected).toHaveLength(1)
    expect(await visible()).toBe(1)
  })

  it('with city-pages off, its area view is empty, so nothing is selected (conservative default)', async () => {
    const [listingId] = await upstream(t, recorded, [inAreaRow])
    await t.switches({ 'city-pages': 'off' })
    const result = await select(t.db, { listingIds: [listingId as string] })
    expect(result.ok && result.value).toMatchObject({ open: true, selected: [] })
    expect(await selections()).toBe(0)
  })

  it('erase removes a selection whatever the switch says', async () => {
    const [listingId] = await upstream(t, recorded, [inAreaRow])
    await select(t.db, { listingIds: [listingId as string] })
    expect(await selections()).toBe(1)
    await t.switches({ 'details-selector': 'off' })
    expect(await erase(t.db, [listingId as string])).toBe(1)
    expect(await selections()).toBe(0)
    expect(await erase(t.db, [listingId as string])).toBe(0)
  })

  it('upstream modules carry on with this module off', async () => {
    await t.switches({ 'details-selector': 'off' })
    expect(await upstream(t, recorded, rows)).toHaveLength(20)
  })
})
