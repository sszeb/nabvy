import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyCorrection, erase, record } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  loadRun,
  RECORDED,
  ruled,
  type TestDatabase,
} from './support/database'

// Switch states (rule 11): off acknowledges and writes nothing and the views are empty; shadow
// runs and writes (no user-facing view exists); the pipeline switch pauses it; an input module
// off is read as "no data", never as "no"; corrections and erasure run whatever the switch says.

const recorded = loadRun(RECORDED)
let t: TestDatabase
let listingIds: string[]
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  listingIds = await ruled(t, recorded)
})
afterEach(async () => {
  await t.close()
})

const count = async (table: string) =>
  Number((await t.sql(`select count(*)::int as n from parts_record.${table}`))[0]?.n)
const viewRows = async () =>
  Number(
    (
      await t.asPipeline(
        `select (select count(*) from parts_record.v_records)
              + (select count(*) from parts_record.v_parts) as n`,
      )
    )[0]?.n,
  )

describe('switch states', () => {
  it('off: acknowledges, writes nothing; the views are empty', async () => {
    await record(t.db, { listingIds })
    await t.switches({ 'parts-record': 'off' })
    const result = await record(t.db, { listingIds })
    expect(result).toMatchObject({
      ok: true,
      value: { open: false, recordsWritten: 0, events: [] },
    })
    expect(await viewRows()).toBe(0)
    expect(await count('records')).toBe(20)
  })

  it('a paused pipeline writes nothing', async () => {
    await t.switches({ pipeline: 'off' })
    const result = await record(t.db, { listingIds })
    expect(result).toMatchObject({ ok: true, value: { open: false, recordsWritten: 0 } })
    expect(await count('records')).toBe(0)
  })

  it('shadow runs and writes, and the internal views show rows', async () => {
    await t.switches({ 'parts-record': 'shadow' })
    const result = await record(t.db, { listingIds })
    expect(result).toMatchObject({ ok: true, value: { open: true, recordsWritten: 20 } })
    expect(await viewRows()).toBeGreaterThan(20)
  })

  it('parts-rules or detail-evidence off: no rules row to read, nothing recorded', async () => {
    for (const off of ['parts-rules', 'detail-evidence']) {
      await t.switches({ ...ALL_ON, [off]: 'off' })
      const result = await record(t.db, { listingIds })
      expect(result).toMatchObject({
        ok: true,
        value: { open: true, listings: 0, recordsWritten: 0, events: [] },
      })
    }
    expect(await count('records')).toBe(0)
  })

  it('parts-ai off: rule rows only, the AI version null (never "no parts")', async () => {
    await t.switches({ 'parts-ai': 'off' })
    const result = await record(t.db, { listingIds })
    expect(result.ok && result.value.recordsWritten).toBe(20)
    const [row] = await t.asPipeline(
      `select count(*)::int as n, count(ai_version)::int as with_ai,
              (select count(*)::int from parts_record.v_parts where extractor <> 'rules') as other
       from parts_record.v_records`,
    )
    expect(row).toEqual({ n: 20, with_ai: 0, other: 0 })
  })

  it('product-catalogue off: no families to compare, so no conflict is invented', async () => {
    await t.switches({ 'product-catalogue': 'off' })
    const result = await record(t.db, { listingIds })
    expect(result.ok && result.value.recordsWritten).toBe(20)
    const [row] = await t.asPipeline(`select bool_or(conflict) as any from parts_record.v_records`)
    expect(row?.any).toBe(false)
  })

  it('corrections and erasure run while off', async () => {
    await record(t.db, { listingIds })
    const [target] = await t.sql(
      `select listing_id, evidence_hash, seq from parts_record.parts order by listing_id, seq limit 1`,
    )
    await t.switches({ 'parts-record': 'off' })
    const applied = await applyCorrection(t.db, {
      listingId: target?.listing_id as string,
      evidenceHash: target?.evidence_hash as string,
      seq: target?.seq as number,
      rejected: true,
      by: '01920000-0000-7000-8000-000000000009',
      reason: 'not a part',
    })
    expect(applied.ok).toBe(true)
    expect(await erase(t.db, [target?.listing_id as string])).toBe(1)
    expect(await count('records')).toBe(19)
    const [orphans] = await t.sql(
      `select count(*)::int as n from parts_record.parts where listing_id = $1`,
      [target?.listing_id],
    )
    expect(orphans?.n).toBe(0)
  })
})
