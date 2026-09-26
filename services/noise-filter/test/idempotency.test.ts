import { readFileSync } from 'node:fs'
import { createEvent } from '@nabvy/contracts'
import { events as listingAssessmentEvents } from '@nabvy/contracts/modules/listing-assessment'
import type { PartsAiResponse } from '@nabvy/parts-ai'
import { createMemoryPublisher } from '@nabvy/transport'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { classify, erase, listingAssessmentAssessedHandler } from '../src'
import {
  ALL_ON,
  assessed,
  createTestDatabase,
  listingIdsBySource,
  loadRun,
  RECORDED,
  type TestDatabase,
} from './support/database'

// Idempotency on (listing, evidence hash, input hash, rule version): a replayed batch, in any
// order, writes nothing, keeps the done time and returns the same event key; a new found-by term
// writes a new row beside the old one; inputs that return to an earlier state make that row the
// latest again without a new row.

const run = loadRun(RECORDED)
const responses = JSON.parse(
  readFileSync(new URL('./fixtures/cases/recorded-run/input.json', import.meta.url), 'utf8'),
).responses as Record<string, PartsAiResponse>
const SERVICE = '2537899006714740' // "Gaming pc / Builder and repair" (dataset.json:6713)
let t: TestDatabase
let listingIds: string[]
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  listingIds = await assessed(t, run, run.dataset, responses)
})
afterEach(async () => {
  await t.close()
})

const count = async () =>
  Number((await t.sql('select count(*)::int as n from noise_filter.classifications'))[0]?.n)

const setTerms = async (sid: string, terms: string[]) =>
  t.sql('update listing_ingest.listings set found_by_terms = $2 where source_listing_id = $1', [
    sid,
    terms,
  ])

describe('idempotency', () => {
  it('a second run of the same batch, in another order, writes nothing and returns the same key', async () => {
    const first = await classify(t.db, { listingIds, now: new Date('2026-09-25T02:00:00Z') })
    const second = await classify(t.db, {
      listingIds: [...listingIds].reverse(),
      now: new Date('2026-09-25T03:00:00Z'),
    })
    if (!first.ok || !second.ok) throw new Error('classify failed')
    expect(first.value).toMatchObject({ written: 20, listings: 20, current: 0 })
    expect(second.value).toMatchObject({ written: 0, current: 20 })
    expect(second.value.events.map((e) => e.key)).toEqual(first.value.events.map((e) => e.key))
    expect(second.value.classified).toEqual(first.value.classified)
    expect(await count()).toBe(20)
    const [row] = await t.asPipeline(
      'select min(classified_at) as lo, max(classified_at) as hi from noise_filter.v_classifications',
    )
    expect(new Date(row?.hi as string).toISOString()).toBe('2026-09-25T02:00:00.000Z')
    expect(row?.lo).toEqual(row?.hi)
  })

  it('a new found-by term writes a new row; returning to the old terms reuses the old row', async () => {
    const ids = await listingIdsBySource(t)
    const one = [ids.get('1072745435569624') as string]
    await classify(t.db, { listingIds: one, now: new Date('2026-09-25T02:00:00Z') })
    await setTerms('1072745435569624', ['rtx 5080'])
    const b = await classify(t.db, { listingIds: one, now: new Date('2026-09-25T03:00:00Z') })
    if (!b.ok) throw new Error('classify failed')
    expect(b.value.written).toBe(1)
    await setTerms('1072745435569624', ['gaming pc'])
    const a = await classify(t.db, { listingIds: one, now: new Date('2026-09-25T04:00:00Z') })
    if (!a.ok) throw new Error('classify failed')
    expect(a.value.written).toBe(1)
    expect(await count()).toBe(2)
    const [row] = await t.asPipeline(
      'select terms, classified_at from noise_filter.v_classifications where listing_id = $1',
      one,
    )
    expect(row?.terms).toEqual([{ term: 'gaming pc', key: null, status: 'generic' }])
    expect(new Date(row?.classified_at as string).toISOString()).toBe('2026-09-25T04:00:00.000Z')
    const again = await classify(t.db, { listingIds: one, now: new Date('2026-09-25T05:00:00Z') })
    if (!again.ok) throw new Error('classify failed')
    expect(again.value).toMatchObject({ written: 0, current: 1 })
    expect(again.value.events.map((e) => e.key)).toEqual(a.value.events.map((e) => e.key))
  })

  it('the event key derives from the stored rows, so new input gives a new key', async () => {
    const ids = await listingIdsBySource(t)
    const one = [ids.get(SERVICE) as string]
    const first = await classify(t.db, { listingIds: one, now: new Date('2026-09-25T02:00:00Z') })
    await setTerms(SERVICE, ['gaming pc', 'pc repair'])
    const second = await classify(t.db, { listingIds: one, now: new Date('2026-09-25T03:00:00Z') })
    if (!first.ok || !second.ok) throw new Error('classify failed')
    expect(second.value.events[0]?.key).not.toBe(first.value.events[0]?.key)
  })

  it('the handler publishes once; a redelivery adds nothing and keeps the done time', async () => {
    const publisher = createMemoryPublisher()
    const attempt = { attempt: 1, maxAttempts: 3, firstAttemptAt: '2026-09-25T02:00:00.000Z' }
    const transaction = <T>(fn: (q: typeof t.db) => Promise<T>) => t.db.transaction(fn)
    const handler = listingAssessmentAssessedHandler({ transaction })
    const event = createEvent(
      listingAssessmentEvents,
      'listing-assessment.assessed',
      1,
      { listingIds },
      { key: 'listing-assessment.assessed:1:0' },
    )
    const at = (iso: string) => ({
      publisher,
      deadLetters: { record: async () => ({}) },
      now: () => new Date(iso),
    })
    expect((await handler.run(event, attempt, at('2026-09-25T02:00:00Z'))).status).toBe('handled')
    expect((await handler.run(event, attempt, at('2026-09-25T05:00:00Z'))).status).toBe('handled')
    expect(publisher.ofType('noise-filter.classified')).toHaveLength(1)
    expect(publisher.duplicates).toHaveLength(1)
    expect(publisher.published[0]?.payload).toEqual({ listingIds: expect.any(Array) })
    expect(await count()).toBe(20)
    const [row] = await t.asPipeline(
      'select max(classified_at) as done from noise_filter.v_classifications',
    )
    expect(new Date(row?.done as string).toISOString()).toBe('2026-09-25T02:00:00.000Z')
  })

  it('a batch over 500 listing IDs is refused before reading anything', async () => {
    const ids = Array.from(
      { length: 501 },
      (_, i) => `01920000-0000-7000-8000-${String(i).padStart(12, '0')}`,
    )
    const result = await classify(t.db, { listingIds: ids, now: new Date() })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('noise-filter.too_many_listings')
    expect(await count()).toBe(0)
  })

  it('erase removes every classification of the listings', async () => {
    await classify(t.db, { listingIds, now: new Date() })
    expect(await erase(t.db, listingIds.slice(0, 5))).toBe(5)
    expect(await count()).toBe(15)
  })
})
