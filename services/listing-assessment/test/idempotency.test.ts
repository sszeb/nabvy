import { readFileSync } from 'node:fs'
import { createEvent } from '@nabvy/contracts'
import { events as partsRecordEvents } from '@nabvy/contracts/modules/parts-record'
import type { PartsAiResponse } from '@nabvy/parts-ai'
import { applyCorrection as correctPart } from '@nabvy/parts-record'
import { createMemoryPublisher } from '@nabvy/transport'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyCorrection, assess, partsRecordRecordedHandler } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  loadRun,
  RECORDED,
  recorded,
  type TestDatabase,
} from './support/database'

// Idempotency on (listing, evidence hash, card hash, record hash, rule version): a replayed
// batch writes nothing, keeps T3 and returns the same event key; a new parts record, or a
// correction there, writes a new row beside the old one; a reviewer's correction here is carried
// onto the new row of the same version.

const run = loadRun(RECORDED)
const responses = JSON.parse(
  readFileSync(new URL('./fixtures/cases/recorded-run/input.json', import.meta.url), 'utf8'),
).responses as Record<string, PartsAiResponse>
const REVIEWER = '01920000-0000-7000-8000-000000000009'
let t: TestDatabase
let listingIds: string[]
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  listingIds = await recorded(t, run, run.dataset, responses)
})
afterEach(async () => {
  await t.close()
})

const count = async () =>
  Number((await t.sql('select count(*)::int as n from listing_assessment.assessments'))[0]?.n)

describe('idempotency', () => {
  it('a second run of the same batch writes nothing and returns the same event key', async () => {
    const first = await assess(t.db, { listingIds, now: new Date('2026-09-25T02:00:00Z') })
    const second = await assess(t.db, {
      listingIds: [...listingIds].reverse(),
      now: new Date('2026-09-25T03:00:00Z'),
    })
    if (!first.ok || !second.ok) throw new Error('assess failed')
    expect(first.value).toMatchObject({ written: 20, listings: 20, current: 0 })
    expect(second.value).toMatchObject({ written: 0, current: 20 })
    expect(second.value.events.map((e) => e.key)).toEqual(first.value.events.map((e) => e.key))
    expect(second.value.assessed).toEqual(first.value.assessed)
    expect(await count()).toBe(20)
    const [row] = await t.asPipeline(
      'select min(assessed_at) as lo, max(assessed_at) as hi from listing_assessment.v_assessments',
    )
    expect(new Date(row?.hi as string).toISOString()).toBe('2026-09-25T02:00:00.000Z')
    expect(row?.lo).toEqual(row?.hi)
  })

  it('a correction in the parts record gives a new row and a new key; a replay adds none', async () => {
    const first = await assess(t.db, { listingIds, now: new Date('2026-09-25T02:00:00Z') })
    const [part] = await t.asPipeline(
      `select p.listing_id, p.evidence_hash, p.seq from parts_record.v_parts p
       where p.part_type = 'gpu' and p.inclusion = 'offered' order by p.listing_id, p.seq limit 1`,
    )
    const struck = await correctPart(t.db, {
      listingId: part?.listing_id as string,
      evidenceHash: part?.evidence_hash as string,
      seq: part?.seq as number,
      rejected: true,
      by: REVIEWER,
      reason: 'not a part',
    })
    expect(struck.ok).toBe(true)
    const second = await assess(t.db, {
      listingIds: [part?.listing_id as string],
      now: new Date('2026-09-25T03:00:00Z'),
    })
    if (!first.ok || !second.ok) throw new Error('assess failed')
    expect(second.value).toMatchObject({ written: 1, current: 0 })
    expect(await count()).toBe(21)
    const again = await assess(t.db, {
      listingIds: [part?.listing_id as string],
      now: new Date('2026-09-25T04:00:00Z'),
    })
    expect(again.ok && again.value).toMatchObject({ written: 0, current: 1 })
    expect(again.ok && again.value.events[0]?.key).toBe(second.value.events[0]?.key)
    const [row] = await t.asPipeline(
      `select count(*)::int as n, max(assessed_at) as latest from listing_assessment.v_assessments
       where listing_id = $1`,
      [part?.listing_id],
    )
    expect(row?.n).toBe(1)
    expect(new Date(row?.latest as string).toISOString()).toBe('2026-09-25T03:00:00.000Z')
  })

  it("a reviewer's correction shows in the views and follows a re-assessment", async () => {
    await assess(t.db, { listingIds, now: new Date('2026-09-25T02:00:00Z') })
    const [a] = await t.asPipeline(
      `select listing_id, evidence_hash from listing_assessment.v_assessments
       where gpu_state = 'not_stated' order by listing_id limit 1`,
    )
    const key = { listingId: a?.listing_id as string, evidenceHash: a?.evidence_hash as string }
    const applied = await applyCorrection(t.db, {
      ...key,
      gpuState: 'none',
      by: REVIEWER,
      reason: 'seller confirmed no card',
    })
    expect(applied.ok).toBe(true)
    const read = async () =>
      (
        await t.asPipeline(
          `select gpu_state, correction from listing_assessment.v_assessments
           where listing_id = $1`,
          [key.listingId],
        )
      )[0]
    expect(await read()).toMatchObject({ gpu_state: 'none', correction: { gpuState: 'none' } })
    const unknownGpu = await t.asPipeline(
      `select 1 from listing_assessment.v_unknowns where listing_id = $1 and part_type = 'gpu'`,
      [key.listingId],
    )
    expect(unknownGpu).toHaveLength(0)
    // A new card hash (the price changed) re-assesses the version; the correction comes along.
    await t.sql('update listing_ingest.listings set card_hash = $2 where id = $1', [
      key.listingId,
      'f'.repeat(64),
    ])
    const again = await assess(t.db, {
      listingIds: [key.listingId],
      now: new Date('2026-09-25T03:00:00Z'),
    })
    expect(again.ok && again.value.written).toBe(1)
    expect(await read()).toMatchObject({ gpu_state: 'none', correction: { gpuState: 'none' } })

    const missing = await applyCorrection(t.db, {
      listingId: key.listingId,
      evidenceHash: '0'.repeat(64),
      form: 'system',
      by: REVIEWER,
      reason: 'no such version',
    })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe('listing-assessment.not_found')
  })

  it('the handler stamps T3 with its hop time and publishes once; a redelivery adds nothing', async () => {
    const publisher = createMemoryPublisher()
    const attempt = { attempt: 1, maxAttempts: 3, firstAttemptAt: '2026-09-25T02:00:00.000Z' }
    const transaction = <T>(fn: (q: typeof t.db) => Promise<T>) => t.db.transaction(fn)
    const handler = partsRecordRecordedHandler({ transaction })
    const event = createEvent(
      partsRecordEvents,
      'parts-record.recorded',
      1,
      { listingIds },
      { key: 'parts-record.recorded:1:0' },
    )
    const at = (iso: string) => ({
      publisher,
      deadLetters: { record: async () => ({}) },
      now: () => new Date(iso),
    })
    expect((await handler.run(event, attempt, at('2026-09-25T02:00:00Z'))).status).toBe('handled')
    expect((await handler.run(event, attempt, at('2026-09-25T05:00:00Z'))).status).toBe('handled')
    expect(publisher.ofType('listing-assessment.assessed')).toHaveLength(1)
    expect(publisher.duplicates).toHaveLength(1)
    expect(publisher.published[0]?.payload).toEqual({ listingIds: expect.any(Array) })
    expect(await count()).toBe(20)
    const [row] = await t.asPipeline(
      'select max(assessed_at) as t3 from listing_assessment.v_assessments',
    )
    expect(new Date(row?.t3 as string).toISOString()).toBe('2026-09-25T02:00:00.000Z')
  })

  it('a batch over 500 listing IDs is refused before reading anything', async () => {
    const ids = Array.from(
      { length: 501 },
      (_, i) => `01920000-0000-7000-8000-${String(i).padStart(12, '0')}`,
    )
    const result = await assess(t.db, { listingIds: ids, now: new Date() })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('listing-assessment.too_many_listings')
    expect(await count()).toBe(0)
  })
})
