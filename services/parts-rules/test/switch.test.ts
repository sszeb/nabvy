import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyCorrection, erase, RULE_VERSION, run } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  detailed,
  loadRun,
  RECORDED,
  type TestDatabase,
} from './support/database'

const recorded = loadRun(RECORDED)
const VIEWS = ['v_rule_parts', 'v_gaps', 'v_tag_blocks', 'v_kind_signals']
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
    `select (select count(*)::int from parts_rules.runs)
          + (select count(*)::int from parts_rules.rule_parts) as n`,
  )
  return row?.n
}
const viewRows = async () => {
  const out: Record<string, number> = {}
  for (const view of VIEWS) {
    const [row] = await t.asPipeline(`select count(*)::int as n from parts_rules.${view}`)
    out[view] = Number(row?.n)
  }
  return out
}

describe('switch', () => {
  it('off: acknowledges, writes nothing, and the views are empty', async () => {
    const listingIds = await detailed(t, recorded)
    await t.switches({ 'parts-rules': 'off' })
    expect(await run(t.db, { listingIds })).toMatchObject({
      ok: true,
      value: { open: false, events: [] },
    })
    expect(await tableCount()).toBe(0)

    await t.switches({ 'parts-rules': 'on' })
    expect((await run(t.db, { listingIds })).ok).toBe(true)
    const on = await viewRows()
    expect(on.v_gaps).toBe(20)
    expect(on.v_rule_parts).toBeGreaterThan(100)
    expect(on.v_kind_signals).toBeGreaterThan(20)
    await t.switches({ 'parts-rules': 'off' })
    expect(Object.values(await viewRows()).every((n) => n === 0)).toBe(true)
  })

  it('a paused pipeline writes nothing', async () => {
    const listingIds = await detailed(t, recorded)
    await t.switches({ pipeline: 'off' })
    expect(await run(t.db, { listingIds })).toMatchObject({ ok: true, value: { open: false } })
    expect(await tableCount()).toBe(0)
  })

  it('shadow: runs, writes and shows internal rows (there are no user-facing views)', async () => {
    await t.switches({ 'parts-rules': 'shadow' })
    const result = await run(t.db, { listingIds: await detailed(t, recorded) })
    expect(result.ok && result.value.ran).toHaveLength(20)
    expect((await viewRows()).v_gaps).toBe(20)
    const appViews = await t.sql(
      `select count(*)::int as n from information_schema.views
       where table_schema = 'app' and table_name like 'v\\_parts\\_rules%'`,
    )
    expect(appViews[0]?.n).toBe(0)
  })

  it('with product-catalogue off the rules still run: no catalogue IDs, OptiPlex still removed', async () => {
    const listingIds = await detailed(t, recorded)
    await t.switches({ 'product-catalogue': 'off' })
    expect((await run(t.db, { listingIds })).ok).toBe(true)
    const [row] = await t.asPipeline(
      `select count(*)::int as n, count(catalogue_id)::int as ids from parts_rules.v_rule_parts`,
    )
    expect(Number(row?.n)).toBeGreaterThan(100)
    expect(row?.ids).toBe(0)
  })

  it('with detail-evidence off there is nothing to read, and nothing is written', async () => {
    const listingIds = await detailed(t, recorded)
    await t.switches({ 'detail-evidence': 'off' })
    expect(await run(t.db, { listingIds })).toMatchObject({ ok: true, value: { listings: 0 } })
    expect(await tableCount()).toBe(0)
  })

  it('erase removes runs and hits whatever the switch; corrections apply beside the candidate', async () => {
    const listingIds = await detailed(t, recorded)
    await run(t.db, { listingIds })
    const [part] = await t.asPipeline(
      'select listing_id, evidence_hash, seq, inclusion_candidate from parts_rules.v_rule_parts limit 1',
    )
    const correction = {
      listingId: String(part?.listing_id),
      evidenceHash: String(part?.evidence_hash),
      ruleVersion: RULE_VERSION,
      seq: Number(part?.seq),
      inclusion: 'mention' as const,
      by: '00000000-0000-7000-8000-000000000009',
      reason: 'The seller says it was upgraded to this card.',
    }
    expect(await applyCorrection(t.db, correction)).toEqual({ ok: true, value: { applied: true } })
    const [after] = await t.asPipeline(
      'select inclusion_candidate, correction from parts_rules.v_rule_parts where listing_id = $1 and seq = $2',
      [correction.listingId, correction.seq],
    )
    expect(after?.inclusion_candidate).toBe(part?.inclusion_candidate)
    expect(after?.correction).toMatchObject({ inclusion: 'mention', by: correction.by })
    expect(await applyCorrection(t.db, { ...correction, seq: 9999 })).toMatchObject({
      ok: false,
      error: { code: 'parts-rules.part_not_found' },
    })

    await t.switches({ 'parts-rules': 'off' })
    expect(await erase(t.db, listingIds.slice(0, 3))).toBe(3)
    const [left] = await t.sql(
      'select count(*)::int as n from parts_rules.runs where listing_id = any($1::uuid[])',
      [listingIds.slice(0, 3)],
    )
    expect(left?.n).toBe(0)
    expect((await t.sql('select count(*)::int as n from parts_rules.runs'))[0]?.n).toBe(17)
  })
})
