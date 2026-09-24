import { ingest } from '@nabvy/listing-ingest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assess } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  loadRun,
  RECORDED,
  type TestDatabase,
} from './support/database'

const recorded = loadRun(RECORDED)
const VIEWS = ['v_search_coverage', 'v_scope_baselines', 'v_search_controls']
let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(async () => {
  await t.close()
})

const tableCount = async () => {
  const [row] = await t.sql('select count(*)::int as n from run_coverage.search_outcomes')
  return row?.n
}
const viewRows = async () => {
  const out: Record<string, number> = {}
  for (const view of VIEWS) {
    const [row] = await t.asPipeline(`select count(*)::int as n from run_coverage.${view}`)
    out[view] = Number(row?.n)
  }
  return out
}
const ingested = async () => {
  const jobId = await t.collected(recorded)
  await ingest(t.db, { jobId, kind: 'search' })
  return jobId
}

describe('switch', () => {
  it('off: acknowledges, writes nothing, and the views are empty', async () => {
    const jobId = await ingested()
    await t.switches({ 'run-coverage': 'off' })
    const result = await assess(t.db, { jobId, kind: 'search' })
    expect(result).toMatchObject({ ok: true, value: { open: false, events: [] } })
    expect(await tableCount()).toBe(0)

    await t.switches({ 'run-coverage': 'on' })
    expect((await assess(t.db, { jobId, kind: 'search' })).ok).toBe(true)
    expect(await viewRows()).toEqual({
      v_search_coverage: 1,
      v_scope_baselines: 1,
      v_search_controls: 1,
    })
    await t.switches({ 'run-coverage': 'off' })
    expect(Object.values(await viewRows()).every((n) => n === 0)).toBe(true)
  })

  it('a paused pipeline writes nothing', async () => {
    const jobId = await ingested()
    await t.switches({ pipeline: 'off' })
    expect(await assess(t.db, { jobId, kind: 'search' })).toMatchObject({
      ok: true,
      value: { open: false },
    })
    expect(await tableCount()).toBe(0)
  })

  it('shadow: runs, writes and shows internal rows (there are no user-facing views)', async () => {
    await t.switches({ 'run-coverage': 'shadow' })
    const result = await assess(t.db, { jobId: await ingested(), kind: 'search' })
    expect(result.ok && result.value.statuses).toEqual([{ searchIndex: 0, status: 'capped' }])
    expect((await viewRows()).v_search_coverage).toBe(1)
    const appViews = await t.sql(
      `select count(*)::int as n from information_schema.views
       where table_schema = 'app' and table_name like 'v\\_run\\_coverage%'`,
    )
    expect(appViews[0]?.n).toBe(0)
  })

  it('with listing-ingest off, the gap check is noted as not run and nothing waits', async () => {
    await t.switches({ 'listing-ingest': 'off' })
    const jobId = await t.collected(recorded)
    const result = await assess(t.db, { jobId, kind: 'search' })
    expect(result.ok && result.value.statuses).toEqual([{ searchIndex: 0, status: 'capped' }])
    const [row] = await t.asPipeline('select reasons from run_coverage.v_search_coverage')
    expect(row?.reasons).toEqual(['overlap-unchecked'])
  })

  it("a reader's input still parses with this module off: listing-ingest ingests as before", async () => {
    await t.switches({ 'run-coverage': 'off' })
    const jobId = await t.collected(recorded)
    const result = await ingest(t.db, { jobId, kind: 'search' })
    expect(result.ok && result.value.firstSeen).toHaveLength(20)
  })
})
