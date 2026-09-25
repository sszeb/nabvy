import { readFileSync } from 'node:fs'
import { createEvent } from '@nabvy/contracts'
import { events as partsAiEvents } from '@nabvy/contracts/modules/parts-ai'
import { events as partsRulesEvents } from '@nabvy/contracts/modules/parts-rules'
import type { PartsAiResponse } from '@nabvy/parts-ai'
import { createMemoryPublisher } from '@nabvy/transport'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyCorrection, partsAiExtractedHandler, partsRulesRanHandler, record } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  extracted,
  loadRun,
  RECORDED,
  ruled,
  type TestDatabase,
  withFields,
} from './support/database'

// Idempotency on (listing, evidence hash, rule version, AI version, photo version): a replayed
// batch writes nothing and returns the same event key; a new input version writes a new record
// row, never rewrites one; a merge that only lacks an input the stored record has writes
// nothing; corrections follow the same evidence onto the re-merged record.

const recorded = loadRun(RECORDED)
const responses = JSON.parse(
  readFileSync(new URL('./fixtures/cases/recorded-run/input.json', import.meta.url), 'utf8'),
).responses as Record<string, PartsAiResponse>
let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(async () => {
  await t.close()
})

const counts = async () => {
  const [row] = await t.sql(
    `select (select count(*)::int from parts_record.records) as records,
            (select count(*)::int from parts_record.parts) as parts,
            (select max(updated_at) from parts_record.parts) as touched`,
  )
  return row
}

describe('idempotency', () => {
  it('a second run of the same batch writes nothing and returns the same event key', async () => {
    const listingIds = await ruled(t, recorded)
    const first = await record(t.db, { listingIds })
    const after = await counts()
    const second = await record(t.db, { listingIds: [...listingIds].reverse() })
    if (!first.ok || !second.ok) throw new Error('record failed')
    expect(first.value).toMatchObject({ recordsWritten: 20, listings: 20, current: 0 })
    expect(first.value.partsWritten).toBe(after?.parts)
    expect(second.value).toMatchObject({ recordsWritten: 0, partsWritten: 0, current: 20 })
    expect(await counts()).toEqual(after)
    expect(second.value.events.map((e) => e.key)).toEqual(first.value.events.map((e) => e.key))
    expect(second.value.recorded).toEqual(first.value.recorded)
  })

  it('the AI result adds a record row per version it reaches, under a new key; replay adds none', async () => {
    const listingIds = await ruled(t, recorded)
    const onRan = await record(t.db, { listingIds })
    const withAi = await extracted(t, listingIds, responses)
    expect(withAi.length).toBe(12)
    const onExtracted = await record(t.db, { listingIds: withAi })
    if (!onRan.ok || !onExtracted.ok) throw new Error('record failed')
    expect(onExtracted.value).toMatchObject({ recordsWritten: 12, listings: 12, current: 0 })
    expect(onExtracted.value.events[0]?.key).not.toBe(onRan.value.events[0]?.key)
    expect((await counts())?.records).toBe(32)
    const again = await record(t.db, { listingIds: withAi })
    expect(again.ok && again.value).toMatchObject({ recordsWritten: 0, current: 12 })
    expect(again.ok && again.value.events[0]?.key).toBe(onExtracted.value.events[0]?.key)
    // The views show one record per version, the one with the AI rows.
    const [row] = await t.asPipeline(
      `select count(*)::int as n, count(ai_version)::int as with_ai from parts_record.v_records`,
    )
    expect(row).toEqual({ n: 20, with_ai: 12 })
  })

  it('parts-ai switched off later: the record keeps its AI rows, nothing is written', async () => {
    const listingIds = await ruled(t, recorded)
    await record(t.db, { listingIds })
    await record(t.db, { listingIds: await extracted(t, listingIds, responses) })
    await t.switches({ 'parts-ai': 'off' })
    const result = await record(t.db, { listingIds })
    expect(result.ok && result.value).toMatchObject({ recordsWritten: 0, current: 20 })
    const [row] = await t.asPipeline(
      `select count(ai_version)::int as with_ai from parts_record.v_records`,
    )
    expect(row?.with_ai).toBe(12)
  })

  it('a new version of one listing records that listing only, under a new key', async () => {
    const listingIds = await ruled(t, recorded)
    const first = await record(t.db, { listingIds })
    const edited = withFields(recorded.dataset, '1756692548940192', {
      collectedAt: '2026-09-25T00:00:00.000Z',
      description: 'Now with an RTX 3060 12GB and 16GB DDR4 RAM.',
    })
    const changed = await ruled(t, recorded, edited)
    expect(changed).toHaveLength(1)
    const second = await record(t.db, { listingIds: changed })
    if (!first.ok || !second.ok) throw new Error('record failed')
    expect(second.value.recordsWritten).toBe(1)
    expect(second.value.events[0]?.key).not.toBe(first.value.events[0]?.key)
    const [row] = await t.asPipeline(
      `select count(*)::int as n from parts_record.v_records where listing_id = $1`,
      [changed[0]],
    )
    expect(row?.n).toBe(2)
  })

  it('a correction follows the same evidence onto the re-merged record', async () => {
    const listingIds = await ruled(t, recorded)
    await record(t.db, { listingIds })
    const [target] = await t.asPipeline(
      `select p.listing_id, p.evidence_hash, p.seq, p.quote from parts_record.v_parts p
       join listing_ingest.v_listings l on l.id = p.listing_id
       where l.source_listing_id = '1083674317719227' order by p.seq limit 1`,
    )
    const key = {
      listingId: target?.listing_id as string,
      evidenceHash: target?.evidence_hash as string,
      seq: target?.seq as number,
    }
    const by = '01920000-0000-7000-8000-000000000009'
    const applied = await applyCorrection(t.db, {
      ...key,
      inclusion: 'mention',
      by,
      reason: 'reads as a mention',
    })
    expect(applied).toEqual({ ok: true, value: { applied: true } })
    // The AI rows join the record: a new row, the correction carried onto the same rule hit.
    await record(t.db, { listingIds: await extracted(t, listingIds, responses) })
    const rows = await t.asPipeline(
      `select seq, quote, inclusion, correction ->> 'inclusion' as corrected, extractor
       from parts_record.v_parts where listing_id = $1 and evidence_hash = $2 order by seq`,
      [key.listingId, key.evidenceHash],
    )
    expect(rows.length).toBe(4)
    expect(rows[0]).toMatchObject({
      quote: target?.quote,
      inclusion: 'mention',
      corrected: 'mention',
      extractor: 'rules',
    })
    expect(rows.slice(1).every((r) => r.corrected === null)).toBe(true)
    // A correction naming no part on the latest record is refused as a value.
    const missing = await applyCorrection(t.db, {
      ...key,
      seq: 99,
      rejected: true,
      by,
      reason: 'x',
    })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe('parts-record.part_not_found')
  })

  it('both handlers publish once; a redelivery publishes nothing new', async () => {
    const listingIds = await ruled(t, recorded)
    const publisher = createMemoryPublisher()
    const deps = { publisher, deadLetters: { record: async () => ({}) } }
    const attempt = { attempt: 1, maxAttempts: 3, firstAttemptAt: '2026-09-25T02:00:00.000Z' }
    const transaction = <T>(fn: (q: typeof t.db) => Promise<T>) => t.db.transaction(fn)
    const onRan = partsRulesRanHandler({ transaction })
    const ran = createEvent(
      partsRulesEvents,
      'parts-rules.ran',
      1,
      { listingIds },
      { key: 'parts-rules.ran:1:0' },
    )
    expect((await onRan.run(ran, attempt, deps)).status).toBe('handled')
    expect((await onRan.run(ran, attempt, deps)).status).toBe('handled')
    expect(publisher.ofType('parts-record.recorded')).toHaveLength(1)
    expect(publisher.duplicates).toHaveLength(1)

    const withAi = await extracted(t, listingIds, responses)
    const onExtracted = partsAiExtractedHandler({ transaction })
    const ex = createEvent(
      partsAiEvents,
      'parts-ai.extracted',
      1,
      { listingIds: withAi },
      { key: 'parts-ai.extracted:1:0' },
    )
    expect((await onExtracted.run(ex, attempt, deps)).status).toBe('handled')
    expect((await onExtracted.run(ex, attempt, deps)).status).toBe('handled')
    expect(publisher.ofType('parts-record.recorded')).toHaveLength(2)
    expect(publisher.duplicates).toHaveLength(2)
    expect(publisher.published[0]?.payload).toEqual({ listingIds: expect.any(Array) })
    expect(await counts()).toMatchObject({ records: 32 })
  })

  it('a batch over 500 listing IDs is refused before reading anything', async () => {
    const ids = Array.from(
      { length: 501 },
      (_, i) => `00000000-0000-7000-8000-${String(i).padStart(12, '0')}`,
    )
    const result = await record(t.db, { listingIds: ids })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('parts-record.too_many_listings')
  })

  it('listings with no current version or no rules run are skipped', async () => {
    const result = await record(t.db, { listingIds: ['00000000-0000-7000-8000-000000000001'] })
    expect(result).toMatchObject({
      ok: true,
      value: { listings: 0, recordsWritten: 0, events: [] },
    })
  })
})
