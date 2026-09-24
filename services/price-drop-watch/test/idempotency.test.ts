import { ingest } from '@nabvy/listing-ingest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyEvent, watch } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  listingIdsBySource,
  loadRun,
  RECORDED,
  runJob,
  type TestDatabase,
} from './support/database'

const USER_ID = '00000000-0000-4000-8000-000000000001'
const LISTING_SOURCE_ID = '1816901372840238'

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(async () => {
  await t.close()
})

describe('idempotency', () => {
  it('a replayed card-changed event writes nothing new and announces the same watch IDs', async () => {
    const recorded = loadRun(RECORDED)
    await runJob(t, recorded, { collectedAt: recorded.run.startedAt as string })
    const located = await listingIdsBySource(t)
    const listingId = located.get(LISTING_SOURCE_ID) as string
    const watched = await t.asApp(USER_ID, (tx) => watch(tx, { userId: USER_ID, listingId }))
    if (!watched.ok) throw new Error(watched.error.message)

    const jobId = await t.collected(recorded, [
      ...recorded.dataset.filter((r) => r.recordType !== 'listing'),
      ...recorded.dataset
        .filter((r) => r.recordType === 'listing')
        .map((r) =>
          r.listingId === LISTING_SOURCE_ID
            ? {
                ...r,
                collectedAt: '2026-09-25T01:40:43.415Z',
                money: {
                  kind: 'fixed',
                  display: '£150',
                  currency: 'GBP',
                  exponent: 2,
                  rawAmount: '150.00',
                  amountMinor: 15000,
                },
              }
            : { ...r, collectedAt: '2026-09-25T01:40:43.415Z' },
        ),
    ])
    const ingested = await ingest(t.db, { jobId, kind: 'search' })
    if (!ingested.ok) throw new Error(ingested.error.message)
    const batches = ingested.value.events
      .filter((e) => e.type === 'listing-ingest.card-changed')
      .map((e, i) => ({
        ids: (e.payload as { listingIds: string[] }).listingIds,
        key: `listing-ingest.card-changed:${jobId}:${i}`,
      }))
    expect(batches.length).toBeGreaterThan(0)
    const batch = batches[0] as (typeof batches)[number]

    const first = await applyEvent(t.db, { listingIds: batch.ids, key: batch.key })
    const second = await applyEvent(t.db, { listingIds: batch.ids, key: batch.key })

    expect(first.candidates).toBeGreaterThan(0)
    expect(first.events.map((e) => e.key)).toEqual(second.events.map((e) => e.key))
    const firstEvent = first.events[0] as (typeof first.events)[number]
    const secondEvent = second.events[0] as (typeof second.events)[number]
    expect((firstEvent.payload as { watchIds: string[] }).watchIds).toEqual(
      (secondEvent.payload as { watchIds: string[] }).watchIds,
    )

    const drops = await t.asPipeline('select id from price_drop_watch.drops where watch_id = $1', [
      watched.value.id,
    ])
    expect(drops).toHaveLength(1)
  })

  it('unknown listing IDs are simply ignored (no active watch, nothing found)', async () => {
    const report = await applyEvent(t.db, { listingIds: [crypto.randomUUID()], key: 'k' })
    expect(report).toEqual({ open: true, evaluated: 0, candidates: 0, events: [] })
  })
})
