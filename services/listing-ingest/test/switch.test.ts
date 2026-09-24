import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { erase, ingest } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  loadRun,
  RECORDED,
  type TestDatabase,
} from './support/database'

const recorded = loadRun(RECORDED)
const VIEWS = [
  'v_listings',
  'v_sightings',
  'v_price_changes',
  'v_city_pages_seen',
  'v_fingerprints',
]
let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(async () => {
  await t.close()
})

const tableCount = async () => {
  const [row] = await t.sql('select count(*)::int as n from listing_ingest.sightings')
  return row?.n
}
const viewRows = async () => {
  const out: Record<string, number> = {}
  for (const view of VIEWS) {
    const [row] = await t.asPipeline(`select count(*)::int as n from listing_ingest.${view}`)
    out[view] = Number(row?.n)
  }
  return out
}

describe('switch', () => {
  it('off: acknowledges, writes nothing, and the views are empty', async () => {
    const jobId = await t.collected(recorded)
    await t.switches({ 'listing-ingest': 'off' })
    const result = await ingest(t.db, { jobId, kind: 'search' })
    expect(result).toMatchObject({ ok: true, value: { open: false, events: [] } })
    expect(await tableCount()).toBe(0)

    await t.switches({ 'listing-ingest': 'on' })
    expect((await ingest(t.db, { jobId, kind: 'search' })).ok).toBe(true)
    expect((await viewRows()).v_listings).toBe(20)
    await t.switches({ 'listing-ingest': 'off' })
    expect(Object.values(await viewRows()).every((n) => n === 0)).toBe(true)
  })

  it('a paused pipeline writes nothing', async () => {
    const jobId = await t.collected(recorded)
    await t.switches({ pipeline: 'off' })
    expect(await ingest(t.db, { jobId, kind: 'search' })).toMatchObject({
      ok: true,
      value: { open: false },
    })
    expect(await tableCount()).toBe(0)
  })

  it('shadow: runs, writes and shows internal rows (there are no user-facing views)', async () => {
    await t.switches({ 'listing-ingest': 'shadow' })
    const jobId = await t.collected(recorded)
    const result = await ingest(t.db, { jobId, kind: 'search' })
    expect(result.ok && result.value.firstSeen).toHaveLength(20)
    const rows = await viewRows()
    expect(rows).toMatchObject({ v_listings: 20, v_sightings: 20, v_fingerprints: 20 })
    expect(rows.v_city_pages_seen).toBeGreaterThan(0)
    const appViews = await t.sql(
      `select count(*)::int as n from information_schema.views
       where table_schema = 'app' and table_name like 'v\\_listing\\_ingest%'`,
    )
    expect(appViews[0]?.n).toBe(0)
  })

  it('erase removes listings and their observations whatever the switch', async () => {
    const jobId = await t.collected(recorded)
    await ingest(t.db, { jobId, kind: 'search' })
    await t.switches({ 'listing-ingest': 'off' })
    const ids = (await t.sql('select id from listing_ingest.listings limit 3')).map((r) =>
      String(r.id),
    )
    expect(await erase(t.db, ids)).toBe(3)
    expect(await tableCount()).toBe(17)
  })
})
