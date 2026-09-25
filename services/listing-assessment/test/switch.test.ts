import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyCorrection, assess, erase } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  loadRun,
  RECORDED,
  recorded,
  type TestDatabase,
} from './support/database'

// Switch states (rule 11): off acknowledges and writes nothing and the views are empty; shadow
// runs and writes (no user-facing view exists); the pipeline switch pauses it; an input module
// off is read as "no data", never as "no"; corrections and erasure run whatever the switch says.

const run = loadRun(RECORDED)
let t: TestDatabase
let listingIds: string[]
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  listingIds = await recorded(t, run)
})
afterEach(async () => {
  await t.close()
})

const now = new Date('2026-09-25T02:00:00Z')
const count = async () =>
  Number((await t.sql('select count(*)::int as n from listing_assessment.assessments'))[0]?.n)
const viewRows = async () =>
  Number(
    (
      await t.asPipeline(
        `select (select count(*) from listing_assessment.v_assessments)
              + (select count(*) from listing_assessment.v_unknowns) as n`,
      )
    )[0]?.n,
  )

describe('switch states', () => {
  it('off: acknowledges, writes nothing; the views are empty', async () => {
    await assess(t.db, { listingIds, now })
    await t.switches({ 'listing-assessment': 'off' })
    const result = await assess(t.db, { listingIds, now })
    expect(result).toMatchObject({ ok: true, value: { open: false, written: 0, events: [] } })
    expect(await viewRows()).toBe(0)
    expect(await count()).toBe(20)
  })

  it('a paused pipeline writes nothing', async () => {
    await t.switches({ pipeline: 'off' })
    const result = await assess(t.db, { listingIds, now })
    expect(result).toMatchObject({ ok: true, value: { open: false, written: 0 } })
    expect(await count()).toBe(0)
  })

  it('shadow runs and writes, and the internal views show rows', async () => {
    await t.switches({ 'listing-assessment': 'shadow' })
    const result = await assess(t.db, { listingIds, now })
    expect(result).toMatchObject({ ok: true, value: { open: true, written: 20 } })
    expect(await viewRows()).toBeGreaterThan(20)
  })

  it('parts-record or detail-evidence off: no record to read, nothing assessed', async () => {
    for (const off of ['parts-record', 'detail-evidence']) {
      await t.switches({ ...ALL_ON, [off]: 'off' })
      const result = await assess(t.db, { listingIds, now })
      expect(result).toMatchObject({
        ok: true,
        value: { open: true, listings: 0, written: 0, events: [] },
      })
    }
    expect(await count()).toBe(0)
  })

  it('listing-ingest off: no card, so no previous-price caution and a null card hash', async () => {
    await t.switches({ 'listing-ingest': 'off' })
    const result = await assess(t.db, { listingIds, now })
    expect(result.ok && result.value.written).toBe(20)
    const rows = await t.sql(
      `select count(*)::int as n, count(card_hash)::int as cards,
              count(*) filter (where cautions ? 'previous_price')::int as previous
       from listing_assessment.assessments`,
    )
    expect(rows[0]).toEqual({ n: 20, cards: 0, previous: 0 })
  })

  it('with parts-record off later, the kind reads unknown, never a value of its own', async () => {
    await assess(t.db, { listingIds, now })
    await t.switches({ 'parts-record': 'off' })
    const [row] = await t.asPipeline(
      'select count(*)::int as n, count(kind)::int as kinds from listing_assessment.v_assessments',
    )
    expect(row).toEqual({ n: 20, kinds: 0 })
  })

  it('corrections and erasure run while off', async () => {
    await assess(t.db, { listingIds, now })
    const [target] = await t.sql(
      'select listing_id, evidence_hash from listing_assessment.assessments order by listing_id limit 1',
    )
    await t.switches({ 'listing-assessment': 'off' })
    const applied = await applyCorrection(t.db, {
      listingId: target?.listing_id as string,
      evidenceHash: target?.evidence_hash as string,
      container: false,
      by: '01920000-0000-7000-8000-000000000009',
      reason: 'a repair service',
    })
    expect(applied.ok).toBe(true)
    expect(await erase(t.db, [target?.listing_id as string])).toBe(1)
    expect(await count()).toBe(19)
  })
})
