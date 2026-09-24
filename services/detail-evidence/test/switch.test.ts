import { ingest } from '@nabvy/listing-ingest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { erase, record } from '../src'
import {
  ALL_ON,
  collectedAndIngested,
  createTestDatabase,
  loadRun,
  RECORDED,
  type TestDatabase,
} from './support/database'

const recorded = loadRun(RECORDED)
const VIEWS = ['v_current', 'v_text', 'v_outcomes', 'v_fingerprints']
let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(async () => {
  await t.close()
})

const tableCount = async () => {
  const [row] = await t.sql(
    `select (select count(*)::int from detail_evidence.evidence)
          + (select count(*)::int from detail_evidence.fetches) as n`,
  )
  return row?.n
}
const viewRows = async () => {
  const out: Record<string, number> = {}
  for (const view of VIEWS) {
    const [row] = await t.asPipeline(`select count(*)::int as n from detail_evidence.${view}`)
    out[view] = Number(row?.n)
  }
  return out
}

describe('switch', () => {
  it('off: acknowledges, writes nothing, and the views are empty', async () => {
    const jobId = await collectedAndIngested(t, recorded)
    await t.switches({ 'detail-evidence': 'off' })
    expect(await record(t.db, { jobId })).toMatchObject({
      ok: true,
      value: { open: false, events: [] },
    })
    expect(await tableCount()).toBe(0)

    await t.switches({ 'detail-evidence': 'on' })
    expect((await record(t.db, { jobId })).ok).toBe(true)
    expect(await viewRows()).toEqual({
      v_current: 20,
      v_text: 20,
      v_outcomes: 20,
      v_fingerprints: 20,
    })
    await t.switches({ 'detail-evidence': 'off' })
    expect(Object.values(await viewRows()).every((n) => n === 0)).toBe(true)
  })

  it('a paused pipeline writes nothing', async () => {
    const jobId = await collectedAndIngested(t, recorded)
    await t.switches({ pipeline: 'off' })
    expect(await record(t.db, { jobId })).toMatchObject({ ok: true, value: { open: false } })
    expect(await tableCount()).toBe(0)
  })

  it('shadow: runs, writes and shows internal rows (there are no user-facing views)', async () => {
    await t.switches({ 'detail-evidence': 'shadow' })
    const result = await record(t.db, { jobId: await collectedAndIngested(t, recorded) })
    expect(result.ok && result.value.changed).toHaveLength(20)
    expect((await viewRows()).v_current).toBe(20)
    const appViews = await t.sql(
      `select count(*)::int as n from information_schema.views
       where table_schema = 'app' and table_name like 'v\\_detail\\_evidence%'`,
    )
    expect(appViews[0]?.n).toBe(0)
  })

  it('a reader carries on while this module is off: listing-ingest ingests as before', async () => {
    await t.switches({ 'detail-evidence': 'off' })
    const jobId = await t.collected(recorded)
    const result = await ingest(t.db, { jobId, kind: 'search' })
    expect(result.ok && result.value.firstSeen).toHaveLength(20)
    expect((await record(t.db, { jobId })).ok).toBe(true)
    expect(await tableCount()).toBe(0)
  })

  it('erase also removes fetches recorded before the listing was ingested', async () => {
    const id = '1816901372840238'
    const early = await t.collected(recorded, [
      {
        recordType: 'listing',
        listingId: id,
        collectedAt: '2026-09-23T00:00:00.000Z',
        detailAttempted: true,
        detailOutcome: 'extraction-error',
        directItemUnresolved: true,
      },
    ])
    expect((await record(t.db, { jobId: early })).ok).toBe(true)
    await record(t.db, { jobId: await collectedAndIngested(t, recorded) })
    const [row] = await t.sql(
      `select listing_id from detail_evidence.evidence where source_listing_id = '${id}'`,
    )
    expect(await erase(t.db, [String(row?.listing_id)])).toBe(1)
    const [left] = await t.sql(
      `select count(*)::int as n from detail_evidence.fetches where source_listing_id = '${id}'`,
    )
    expect(left?.n).toBe(0)
  })

  it('erase removes versions and fetches whatever the switch', async () => {
    await record(t.db, { jobId: await collectedAndIngested(t, recorded) })
    await t.switches({ 'detail-evidence': 'off' })
    const ids = (await t.sql('select listing_id from detail_evidence.evidence limit 3')).map((r) =>
      String(r.listing_id),
    )
    expect(await erase(t.db, ids)).toBe(3)
    expect(await tableCount()).toBe(34)
  })
})
