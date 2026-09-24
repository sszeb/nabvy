import {
  ListingIngestCardChangedEvent,
  ListingIngestCardHash,
  ListingIngestFirstSeenEvent,
  ListingIngestListing,
  ListingIngestPriceChange,
  ListingIngestSighting,
} from '@nabvy/contracts/modules/listing-ingest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { events, ingest, module } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  loadRun,
  RECORDED,
  type TestDatabase,
  withPrice,
} from './support/database'

const camel = (row: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v,
    ]),
  )

let t: TestDatabase
let emitted: unknown[] = []
beforeAll(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  const recorded = loadRun(RECORDED)
  const a = await ingest(t.db, { jobId: await t.collected(recorded), kind: 'search' })
  const rows = withPrice(recorded.dataset, '1816901372840238', 18000)
  const b = await ingest(t.db, { jobId: await t.collected(recorded, rows), kind: 'search' })
  if (!a.ok || !b.ok) throw new Error('ingest failed')
  emitted = [...a.value.events, ...b.value.events]
})
afterAll(async () => {
  await t.close()
})

describe('contracts', () => {
  it('declares its events under its own name', () => {
    expect(module).toBe('listing-ingest')
    expect(Object.keys(events.definitions).sort()).toEqual([
      'listing-ingest.card-changed',
      'listing-ingest.first-seen',
    ])
  })

  it('emits envelopes whose payloads parse, carrying IDs only', () => {
    expect(emitted).toHaveLength(2)
    for (const envelope of emitted as { type: string; payload: unknown }[]) {
      const schema =
        envelope.type === 'listing-ingest.first-seen'
          ? ListingIngestFirstSeenEvent
          : ListingIngestCardChangedEvent
      expect(schema.safeParse(envelope.payload).success).toBe(true)
    }
  })

  it('refuses an empty or oversized batch', () => {
    expect(ListingIngestFirstSeenEvent.safeParse({ listingIds: [] }).success).toBe(false)
    const ids = Array.from({ length: 501 }, () => '0190a000-0000-7000-8000-000000000000')
    expect(ListingIngestCardChangedEvent.safeParse({ listingIds: ids }).success).toBe(false)
    expect(ListingIngestCardHash.safeParse('ABC').success).toBe(false)
  })

  it('parses every view row', async () => {
    for (const row of await t.asPipeline('select * from listing_ingest.v_listings')) {
      ListingIngestListing.parse(camel(row))
    }
    for (const row of await t.asPipeline('select * from listing_ingest.v_sightings')) {
      ListingIngestSighting.parse(camel(row))
    }
    const changes = await t.asPipeline('select * from listing_ingest.v_price_changes')
    expect(changes).toHaveLength(1)
    for (const row of changes) ListingIngestPriceChange.parse(camel(row))
  })

  it('publishes no seller field in any view', async () => {
    const columns = await t.asPipeline(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'listing_ingest' and table_name like 'v\\_%'`,
    )
    expect(columns.length).toBeGreaterThan(0)
    for (const { column_name } of columns) {
      expect(String(column_name)).not.toMatch(/seller|profile|^raw|_raw$|source_fields/)
    }
  })
})
