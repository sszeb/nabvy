import { createEvent } from '@nabvy/contracts'
import { events as detailEvidenceEvents } from '@nabvy/contracts/modules/detail-evidence'
import { events as listingIngestEvents } from '@nabvy/contracts/modules/listing-ingest'
import { createMemoryPublisher } from '@nabvy/transport'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detailChangedHandler, firstSeenHandler, merge } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  listingRows,
  loadRun,
  RECORDED,
  relist,
  type TestDatabase,
  upstream,
} from './support/database'

const recorded = loadRun(RECORDED)
const rows = listingRows(recorded)
const ORIGINAL = '1816901372840238'
const original = rows.find((row) => row.listingId === ORIGINAL) as Record<string, unknown>

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
    `select (select count(*) from relist_merge.groups)::int as groups,
            (select count(*) from relist_merge.members)::int as members`,
  )
  return row
}

async function relistPair() {
  const all = await upstream(t, recorded, rows)
  const [relisted] = await upstream(t, recorded, [relist(original, '9100000000000001', 3)])
  return { all, relisted: relisted as string }
}

describe('idempotency', () => {
  it('a replayed batch writes nothing and returns the same event keys', async () => {
    const { relisted } = await relistPair()
    const first = await merge(t.db, { listingIds: [relisted] })
    const second = await merge(t.db, { listingIds: [relisted] })
    if (!first.ok || !second.ok) throw new Error('merge failed')
    expect(first.value.membersWritten).toBe(2)
    expect(second.value.membersWritten).toBe(0)
    expect(second.value.events.map((e) => e.key)).toEqual(first.value.events.map((e) => e.key))
    expect(await counts()).toEqual({ groups: 1, members: 2 })
  })

  it('the same pair reached from either side, in any order, makes one group', async () => {
    const { all, relisted } = await relistPair()
    const late = await merge(t.db, { listingIds: [relisted] })
    const early = await merge(t.db, { listingIds: all })
    const both = await merge(t.db, { listingIds: [...all, relisted] })
    if (!late.ok || !early.ok || !both.ok) throw new Error('merge failed')
    expect(await counts()).toEqual({ groups: 1, members: 2 })
    // The original's batch names the same group version, so its key is the one already sent.
    expect(early.value.events.map((e) => e.key)).toEqual(late.value.events.map((e) => e.key))
    expect(both.value.events.map((e) => e.key)).toEqual(late.value.events.map((e) => e.key))
  })

  it('a group that grows announces a new version', async () => {
    const { relisted } = await relistPair()
    const first = await merge(t.db, { listingIds: [relisted] })
    const [third] = await upstream(t, recorded, [relist(original, '9100000000000002', 5)])
    const second = await merge(t.db, { listingIds: [third as string] })
    if (!first.ok || !second.ok) throw new Error('merge failed')
    expect(second.value.merged).toHaveLength(3)
    expect(second.value.events[0]?.key).not.toBe(first.value.events[0]?.key)
  })

  it('a batch with nothing to merge writes and announces nothing', async () => {
    const all = await upstream(t, recorded, rows)
    const result = await merge(t.db, { listingIds: all })
    if (!result.ok) throw new Error('merge failed')
    expect(result.value.events).toEqual([])
    expect(await counts()).toEqual({ groups: 0, members: 0 })
  })

  it('refuses an empty or malformed batch', async () => {
    for (const listingIds of [[], ['not-a-uuid']]) {
      const result = await merge(t.db, { listingIds })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('relist-merge.invalid_input')
    }
  })

  it('both handlers publish once; a redelivery publishes nothing new', async () => {
    const { relisted } = await relistPair()
    const publisher = createMemoryPublisher()
    const deps = { publisher, deadLetters: { record: async () => ({}) } }
    const attempt = { attempt: 1, maxAttempts: 3, firstAttemptAt: '2026-09-27T02:00:00.000Z' }
    const transaction = {
      transaction: <T>(fn: (q: typeof t.db) => Promise<T>) => t.db.transaction(fn),
    }
    const firstSeen = createEvent(
      listingIngestEvents,
      'listing-ingest.first-seen',
      1,
      { listingIds: [relisted] },
      { key: 'listing-ingest.first-seen:2:0' },
    )
    const changed = createEvent(
      detailEvidenceEvents,
      'detail-evidence.changed',
      1,
      { listingIds: [relisted] },
      { key: 'detail-evidence.changed:2:0' },
    )
    const onFirstSeen = firstSeenHandler(transaction)
    const onChanged = detailChangedHandler(transaction)
    expect((await onFirstSeen.run(firstSeen, attempt, deps)).status).toBe('handled')
    expect((await onFirstSeen.run(firstSeen, attempt, deps)).status).toBe('handled')
    expect((await onChanged.run(changed, attempt, deps)).status).toBe('handled')
    expect(publisher.ofType('relist-merge.merged')).toHaveLength(1)
    expect(publisher.published[0]?.payload).toMatchObject({ listingIds: expect.any(Array) })
    expect(publisher.duplicates.length).toBeGreaterThanOrEqual(1)
    expect(await counts()).toEqual({ groups: 1, members: 2 })
  })
})
