import { createEvent } from '@nabvy/contracts'
import { events as gatewayEvents } from '@nabvy/contracts/modules/apify-gateway'
import { events as ingestEvents } from '@nabvy/contracts/modules/listing-ingest'
import { createMemoryPublisher } from '@nabvy/transport'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeBatch, enqueue, firstSeenHandler, runCollectedHandler, submitNext } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  fakePorts,
  ids,
  row,
  type TestDatabase,
} from './support/database'

// Every handler is safe to run twice (CLAUDE.md, "Idempotent handlers"): the queue's key is
// source + sourceListingId (+ lane); a batch's key is its gateway job ID.

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
})
afterEach(() => t.close())

const attempt = { attempt: 1, maxAttempts: 3, firstAttemptAt: '2026-09-24T02:00:00.000Z' }
const snapshot = () =>
  t.sql(
    'select source_listing_id, lane, priority, status, attempts, requeues, last_outcome, job_id, deferred_on from details_queue.items order by source_listing_id',
  )

describe('idempotency', () => {
  it('enqueue twice writes nothing new', async () => {
    const input = {
      sourceListingIds: ids(3),
      priority: 'new-listing' as const,
      lane: 'text' as const,
      reason: 'first-seen' as const,
      requestedBy: 'details-selector',
    }
    await t.db.transaction((q) => enqueue(q, input))
    const before = await snapshot()
    await t.db.transaction((q) => enqueue(q, input))
    expect(await snapshot()).toEqual(before)
  })

  it('closing a batch twice changes nothing', async () => {
    const ports = fakePorts()
    const three = ids(3)
    await t.db.transaction((q) =>
      enqueue(q, {
        sourceListingIds: three,
        priority: 'new-listing',
        lane: 'text',
        reason: 'first-seen',
        requestedBy: 'details-selector',
      }),
    )
    await t.db.transaction((q) => submitNext(q, { ports }))
    await t.rows(1, [
      row(three[0] as string),
      row(three[1] as string, { descriptionStatus: 'partial' }),
    ])
    expect(await t.db.transaction((q) => closeBatch(q, 1))).toBe(true)
    const before = await snapshot()
    const batch = await t.sql('select closed_at, outcome from details_queue.batches')
    expect(await t.db.transaction((q) => closeBatch(q, 1))).toBe(false)
    expect(await snapshot()).toEqual(before)
    expect(await t.sql('select closed_at, outcome from details_queue.batches')).toEqual(batch)
    // An unknown job (another module's details run) is ignored.
    expect(await t.db.transaction((q) => closeBatch(q, 99))).toBe(false)
  })

  it('the database refuses to reopen a closed batch', async () => {
    const ports = fakePorts()
    await t.db.transaction((q) =>
      enqueue(q, {
        sourceListingIds: ids(1),
        priority: 'new-listing',
        lane: 'text',
        reason: 'first-seen',
        requestedBy: 'details-selector',
      }),
    )
    await t.db.transaction((q) => submitNext(q, { ports }))
    await t.db.transaction((q) => closeBatch(q, 1))
    await expect(t.sql('update details_queue.batches set closed_at = null')).rejects.toThrow(
      /stays closed/,
    )
  })

  it('run-collected delivered twice closes once; search runs are ignored', async () => {
    const ports = fakePorts()
    const two = ids(2)
    await t.db.transaction((q) =>
      enqueue(q, {
        sourceListingIds: two,
        priority: 'new-listing',
        lane: 'text',
        reason: 'first-seen',
        requestedBy: 'details-selector',
      }),
    )
    await t.db.transaction((q) => submitNext(q, { ports }))
    await t.rows(
      1,
      two.map((id) => row(id)),
    )
    const handler = runCollectedHandler({ transaction: (fn) => t.db.transaction(fn) })
    const deps = { publisher: createMemoryPublisher(), deadLetters: { record: async () => ({}) } }
    const envelope = (kind: 'search' | 'details', jobId: number) =>
      createEvent(
        gatewayEvents,
        'apify-gateway.run-collected',
        1,
        { jobId, apifyRunId: 'VkryjpwS6U2GBDh3k', kind },
        { key: `apify-gateway.run-collected:${jobId}` },
      )
    expect((await handler.run(envelope('search', 1), attempt, deps)).status).toBe('handled')
    expect(await t.sql('select 1 from details_queue.batches where closed_at is null')).toHaveLength(
      1,
    )
    expect((await handler.run(envelope('details', 1), attempt, deps)).status).toBe('handled')
    const after = await snapshot()
    expect((await handler.run(envelope('details', 1), attempt, deps)).status).toBe('handled')
    expect(await snapshot()).toEqual(after)
    expect(after.map((r) => r.status)).toEqual(['done', 'done'])
  })

  it('first-seen delivered twice queues once', async () => {
    const listingId = '01930000-0000-7000-8000-000000000001'
    await t.listing({
      id: listingId,
      sourceListingId: '4000000000000001',
      jobId: 5,
      kind: 'search',
      tags: { module: 'check-scheduler', region: 'york', purpose: 'newest', shape: 'newest-check' },
    })
    const handler = firstSeenHandler({ transaction: (fn) => t.db.transaction(fn) })
    const deps = { publisher: createMemoryPublisher(), deadLetters: { record: async () => ({}) } }
    const envelope = createEvent(
      ingestEvents,
      'listing-ingest.first-seen',
      1,
      { listingIds: [listingId] },
      { key: 'listing-ingest.first-seen:5:0' },
    )
    expect((await handler.run(envelope, attempt, deps)).status).toBe('handled')
    const before = await snapshot()
    expect(before).toMatchObject([
      { source_listing_id: '4000000000000001', priority: 'new-listing', status: 'queued' },
    ])
    expect((await handler.run(envelope, attempt, deps)).status).toBe('handled')
    expect(await snapshot()).toEqual(before)
  })

  it('a replay that finds a queued listing already described marks it done, unpaid', async () => {
    const listingId = '01930000-0000-7000-8000-000000000002'
    await t.db.transaction((q) =>
      enqueue(q, {
        sourceListingIds: ['4000000000000002'],
        priority: 'sweep',
        lane: 'text',
        reason: 'first-seen',
        requestedBy: 'details-selector',
      }),
    )
    await t.listing({
      id: listingId,
      sourceListingId: '4000000000000002',
      jobId: 9,
      kind: 'search',
    })
    await t.rows(9, [row('4000000000000002')])
    const handler = firstSeenHandler({ transaction: (fn) => t.db.transaction(fn) })
    const deps = { publisher: createMemoryPublisher(), deadLetters: { record: async () => ({}) } }
    const envelope = createEvent(
      ingestEvents,
      'listing-ingest.first-seen',
      1,
      { listingIds: [listingId] },
      { key: 'listing-ingest.first-seen:9:0' },
    )
    expect((await handler.run(envelope, attempt, deps)).status).toBe('handled')
    expect(await snapshot()).toMatchObject([{ status: 'done', last_outcome: 'full_verified' }])
    const ports = fakePorts()
    expect(await t.db.transaction((q) => submitNext(q, { ports }))).toMatchObject({
      status: 'idle',
    })
    expect(ports.submitted).toHaveLength(0)
  })

  it('first-seen for listings listing-ingest does not show is retried, not dropped', async () => {
    const handler = firstSeenHandler({ transaction: (fn) => t.db.transaction(fn) })
    const deps = { publisher: createMemoryPublisher(), deadLetters: { record: async () => ({}) } }
    const envelope = createEvent(
      ingestEvents,
      'listing-ingest.first-seen',
      1,
      { listingIds: ['01930000-0000-7000-8000-000000000404'] },
      { key: 'listing-ingest.first-seen:6:0' },
    )
    await expect(handler.run(envelope, attempt, deps)).rejects.toThrow(/listings_not_found/)
  })
})
