import { createEvent } from '@nabvy/contracts'
import { events as listingIngestEvents } from '@nabvy/contracts/modules/listing-ingest'
import { createMemoryPublisher } from '@nabvy/transport'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { firstSeenHandler, select } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  IN_AREA_CITY_PAGE_ID,
  listingRows,
  loadRun,
  RECORDED,
  type TestDatabase,
  upstream,
  withCityPage,
} from './support/database'

const recorded = loadRun(RECORDED)
const rows = listingRows(recorded)
const original = rows.find((row) => row.listingId === '1816901372840238') as Record<string, unknown>
const inAreaRow = withCityPage(original, IN_AREA_CITY_PAGE_ID)

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
    `select (select count(*) from details_selector.selections)::int as selections,
            (select count(*) from details_queue.items)::int as queued`,
  )
  return row
}

describe('idempotency', () => {
  it('a replayed batch writes no new selection and enqueues nothing further', async () => {
    const [listingId] = await upstream(t, recorded, [inAreaRow])
    const first = await select(t.db, { listingIds: [listingId as string] })
    const second = await select(t.db, { listingIds: [listingId as string] })
    if (!first.ok || !second.ok) throw new Error('select failed')
    expect(first.value.selected).toHaveLength(1)
    expect(first.value.enqueued.queued).toBe(1)
    expect(second.value.selected).toHaveLength(0)
    expect(second.value.enqueued).toEqual({ queued: 0, alreadyQueued: 0, skipped: 0 })
    expect(await counts()).toEqual({ selections: 1, queued: 1 })
  })

  it('a changed card version (price change) is a new row and is re-selected', async () => {
    const [listingId] = await upstream(t, recorded, [inAreaRow])
    await select(t.db, { listingIds: [listingId as string] })
    const cheaper = {
      ...inAreaRow,
      money: {
        ...(inAreaRow.money as Record<string, unknown>),
        amountMinor: 10000,
        rawAmount: '100.00',
      },
    }
    await upstream(t, recorded, [cheaper])
    const [again] = await listingIdOf(t, '1816901372840238')
    const result = await select(t.db, { listingIds: [again as string] })
    if (!result.ok) throw new Error('select failed')
    expect(result.value.selected).toHaveLength(1)
    expect(await counts()).toEqual({ selections: 2, queued: 1 })
  })

  it('refuses an empty or malformed batch', async () => {
    for (const listingIds of [[], ['not-a-uuid']]) {
      const result = await select(t.db, { listingIds })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('details-selector.invalid_input')
    }
  })

  it('the handler runs once per delivery; a redelivery writes nothing new', async () => {
    const [listingId] = await upstream(t, recorded, [inAreaRow])
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
      { listingIds: [listingId as string] },
      { key: 'listing-ingest.first-seen:1:0' },
    )
    const handler = firstSeenHandler(transaction)
    expect((await handler.run(firstSeen, attempt, deps)).status).toBe('handled')
    expect((await handler.run(firstSeen, attempt, deps)).status).toBe('handled')
    expect(await counts()).toEqual({ selections: 1, queued: 1 })
  })
})

async function listingIdOf(t: TestDatabase, sourceListingId: string) {
  const rows = await t.sql('select id from listing_ingest.listings where source_listing_id = $1', [
    sourceListingId,
  ])
  return rows.map((row) => String(row.id))
}
