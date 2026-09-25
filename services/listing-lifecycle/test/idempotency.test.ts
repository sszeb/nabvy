import { createEvent } from '@nabvy/contracts'
import { events as detailEvidenceEvents } from '@nabvy/contracts/modules/detail-evidence'
import { events as listingIngestEvents } from '@nabvy/contracts/modules/listing-ingest'
import { createMemoryPublisher } from '@nabvy/transport'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyEvent, cardChangedHandler, requestRecheck, tick, unresolvedHandler } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  listingIdsBySource,
  loadRun,
  RECORDED,
  runJob,
  type TestDatabase,
} from './support/database'

// Every handler and function is safe to run twice: the status row's content hash stops a replay
// from writing, and the announced IDs are read back from stored rows, so a replay returns the same
// keys, which the transport drops.

const recorded = loadRun(RECORDED)
const X = '1816901372840238'
const T0 = '2026-09-24T01:40:43.415Z'
const SOLD = { live: false, sold: true, hidden: false, pending: false }

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  await runJob(t, recorded, { kind: 'search', collectedAt: T0 })
})
afterEach(async () => {
  await t.close()
})

const snapshot = () =>
  t.sql(
    `select listing_id, status, input_hash, changed_by, changed_at, evaluated_at, updated_at
     from listing_lifecycle.status order by listing_id`,
  )
const rechecks = () =>
  t.sql('select id, sent_at, outcome, updated_at from listing_lifecycle.rechecks order by id')

describe('idempotency', () => {
  it('the same event twice writes once and returns the same keys', async () => {
    const ids = [...(await listingIdsBySource(t)).values()]
    const key = 'listing-ingest.card-changed:1:0'
    const first = await applyEvent(t.db, { listingIds: ids, key })
    const before = await snapshot()
    const second = await applyEvent(t.db, { listingIds: ids, key })
    if (!first.ok || !second.ok) throw new Error('refused')
    expect(first.value.written).toBe(20)
    expect(second.value.written).toBe(0)
    expect(second.value.changed).toEqual(first.value.changed)
    expect(second.value.events.map((e) => e.key)).toEqual(first.value.events.map((e) => e.key))
    expect(await snapshot()).toEqual(before)
  })

  it('an out-of-order replay of an older event changes nothing', async () => {
    const x = (await listingIdsBySource(t)).get(X) as string
    await runJob(t, recorded, {
      kind: 'search',
      collectedAt: '2026-09-24T03:40:43.415Z',
      edits: [{ listingId: X, fields: { availability: SOLD } }],
    })
    const before = await snapshot()
    // The first job's card-changed arrives late: the status is derived from every stored
    // observation, so the newer sold flag stands.
    const late = await applyEvent(t.db, { listingIds: [x], key: 'listing-ingest.card-changed:0:0' })
    if (!late.ok) throw new Error('refused')
    expect(late.value.changed).toEqual([])
    expect(late.value.written).toBe(0)
    expect(await snapshot()).toEqual(before)
    const [row] = await t.sql('select status from listing_lifecycle.status where listing_id = $1', [
      x,
    ])
    expect(row?.status).toBe('marked-sold')
  })

  it('a tick twice at the same time writes once', async () => {
    const now = new Date('2026-09-24T02:40:43.415Z')
    const first = await tick(t.db, { now })
    const before = await snapshot()
    const second = await tick(t.db, { now })
    expect(first.changed).toHaveLength(20)
    expect(second.written).toBe(0)
    expect(second.events.map((e) => e.key)).toEqual(first.events.map((e) => e.key))
    expect(await snapshot()).toEqual(before)
  })

  it('a repeated recheck request and a replayed tick send each step once', async () => {
    const ids = [...(await listingIdsBySource(t)).values()]
    await requestRecheck(t.db, { listingIds: ids, reason: 'watched', requestedBy: 'watch' })
    const again = await requestRecheck(t.db, {
      listingIds: ids,
      reason: 'watched',
      requestedBy: 'watch',
    })
    expect(again).toEqual({ scheduled: 0, alreadyScheduled: 20, unknown: 0 })
    const now = new Date(Date.now() + 3_600_000)
    const first = await tick(t.db, { now })
    const sent = await rechecks()
    const second = await tick(t.db, { now })
    expect(first.rechecksQueued).toBe(20)
    expect(second.rechecksQueued).toBe(0)
    expect(await rechecks()).toEqual(sent)
    const [queue] = await t.sql(
      `select count(*)::int as n from details_queue.items where requested_by = 'listing-lifecycle'`,
    )
    expect(queue?.n).toBe(20)
  })

  it('each handler publishes once; a redelivery publishes nothing new', async () => {
    const ids = [...(await listingIdsBySource(t)).values()]
    const publisher = createMemoryPublisher()
    const deps = { publisher, deadLetters: { record: async () => ({}) } }
    const attempt = { attempt: 1, maxAttempts: 3, firstAttemptAt: '2026-09-24T02:00:00.000Z' }
    const transaction = {
      transaction: <T>(fn: (q: typeof t.db) => Promise<T>) =>
        t.db.transaction(fn as never) as Promise<T>,
    }
    const card = createEvent(
      listingIngestEvents,
      'listing-ingest.card-changed',
      1,
      { listingIds: ids },
      { key: 'listing-ingest.card-changed:1:0' },
    )
    const handler = cardChangedHandler(transaction)
    expect((await handler.run(card, attempt, deps)).status).toBe('handled')
    expect((await handler.run(card, attempt, deps)).status).toBe('handled')
    expect(publisher.ofType('listing-lifecycle.status-changed')).toHaveLength(1)
    expect(publisher.duplicates).toHaveLength(1)

    const unresolved = createEvent(
      detailEvidenceEvents,
      'detail-evidence.unresolved',
      1,
      { listingIds: [ids[0] as string] },
      { key: 'detail-evidence.unresolved:2:0' },
    )
    // Nothing unresolved is stored for it, so the status stays and nothing is announced.
    expect((await unresolvedHandler(transaction).run(unresolved, attempt, deps)).status).toBe(
      'handled',
    )
    expect(publisher.ofType('listing-lifecycle.status-changed')).toHaveLength(1)
  })

  it('listings listing-ingest does not show fail the event before writing, so it is retried', async () => {
    const result = await applyEvent(t.db, {
      listingIds: ['01920000-0000-7000-8000-00000000abcd'],
      key: 'listing-ingest.card-changed:9:0',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('listing-lifecycle.listings_not_found')
    expect(await snapshot()).toEqual([])
  })
})
