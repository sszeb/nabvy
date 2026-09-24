import { createEvent } from '@nabvy/contracts'
import { events as gatewayEvents } from '@nabvy/contracts/modules/apify-gateway'
import { createMemoryPublisher } from '@nabvy/transport'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ingest, runCollectedHandler } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  loadRun,
  RECORDED,
  type TestDatabase,
} from './support/database'

const recorded = loadRun(RECORDED)
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
    `select (select count(*)::int from listing_ingest.listings) as listings,
            (select count(*)::int from listing_ingest.sightings) as sightings,
            (select max(updated_at) from listing_ingest.listings) as touched`,
  )
  return row
}

describe('idempotency', () => {
  it('a second run of the same job writes nothing and returns the same event keys', async () => {
    const jobId = await t.collected(recorded)
    const first = await ingest(t.db, { jobId, kind: 'search' })
    const after = await counts()
    const second = await ingest(t.db, { jobId, kind: 'search' })
    if (!first.ok || !second.ok) throw new Error('ingest failed')
    expect(after).toMatchObject({ listings: 20, sightings: 20 })
    expect(await counts()).toEqual(after)
    expect(second.value.sightingsWritten).toBe(0)
    expect(second.value.events.map((e) => e.key)).toEqual(first.value.events.map((e) => e.key))
    expect(second.value.firstSeen).toEqual(first.value.firstSeen)
  })

  it('a late replay of an older run never overwrites a newer card', async () => {
    const older = await t.collected(recorded)
    const newer = await t.collected({
      ...recorded,
      dataset: recorded.dataset.map((row) =>
        row.listingId === '1816901372840238'
          ? {
              ...row,
              collectedAt: '2026-09-25T00:00:00.000Z',
              money: { ...(row.money as object), amountMinor: 15000 },
            }
          : row,
      ),
    })
    expect((await ingest(t.db, { jobId: newer, kind: 'search' })).ok).toBe(true)
    expect((await ingest(t.db, { jobId: older, kind: 'search' })).ok).toBe(true)
    const [row] = await t.sql(
      `select price_minor from listing_ingest.listings where source_listing_id = '1816901372840238'`,
    )
    expect(Number(row?.price_minor)).toBe(15000)
  })

  it('the handler publishes once; a redelivery publishes nothing new', async () => {
    const jobId = await t.collected(recorded)
    const publisher = createMemoryPublisher()
    const handler = runCollectedHandler({ transaction: (fn) => t.db.transaction(fn) })
    const envelope = createEvent(
      gatewayEvents,
      'apify-gateway.run-collected',
      1,
      { jobId, apifyRunId: recorded.apifyRunId, kind: 'search' },
      { key: `apify-gateway.run-collected:${jobId}` },
    )
    const attempt = { attempt: 1, maxAttempts: 3, firstAttemptAt: '2026-09-24T02:00:00.000Z' }
    const deps = { publisher, deadLetters: { record: async () => ({}) } }
    expect((await handler.run(envelope, attempt, deps)).status).toBe('handled')
    expect((await handler.run(envelope, attempt, deps)).status).toBe('handled')
    expect(publisher.ofType('listing-ingest.first-seen')).toHaveLength(1)
    expect(publisher.published[0]?.payload).toMatchObject({ listingIds: expect.any(Array) })
    expect(publisher.duplicates).toHaveLength(1)
    expect(await counts()).toMatchObject({ listings: 20, sightings: 20 })
  })

  it('a job the gateway does not show fails, so it is retried rather than dropped', async () => {
    const result = await ingest(t.db, { jobId: 999, kind: 'search' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('listing-ingest.job_not_found')
  })
})
