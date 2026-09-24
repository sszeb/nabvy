import {
  events as contractEvents,
  ListingSuppressionChangedEvent,
  ListingSuppressionEntry,
  ListingSuppressionSuppressed,
} from '@nabvy/contracts/modules/listing-suppression'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { add, events, module } from '../src'
import {
  ALL_ON,
  collectedAndRecorded,
  createTestDatabase,
  loadRun,
  RECORDED,
  type TestDatabase,
} from './support/database'

const camel = (row: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v instanceof Date ? v.toISOString() : v,
    ]),
  )

const recorded = loadRun(RECORDED)
let t: TestDatabase
let emitted: unknown[] = []
beforeAll(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  await collectedAndRecorded(t, recorded)
  const result = await add(t.db, {
    requestId: '01920000-0000-7000-8000-00000000a001',
    listings: recorded.dataset
      .filter((row) => row.recordType === 'listing')
      .slice(0, 3)
      .map((row) => ({ source: 'facebook' as const, sourceListingId: String(row.listingId) })),
    sellerKeys: ['8254c329a92850f6d539dd376f4816ee2764517da5e0235514af433164480d7a'],
  })
  if (!result.ok) throw new Error(result.error.message)
  emitted = result.value.events
})
afterAll(async () => {
  await t.close()
})

describe('contracts', () => {
  it('exports the module name and its registry', () => {
    expect(module).toBe('listing-suppression')
    expect(events).toBe(contractEvents)
  })

  it('the changed event parses', () => {
    expect(emitted).toHaveLength(1)
    for (const e of emitted as { type: string; payload: unknown }[]) {
      expect(e.type).toBe('listing-suppression.changed')
      expect(ListingSuppressionChangedEvent.parse(e.payload).entryIds).toHaveLength(10)
    }
  })

  it('every entry and every v_suppressed row parses', async () => {
    const entries = await t.asPipeline(
      `select id::text, kind, basis, value, expires_at, request_id::text, created_at
       from listing_suppression.entries`,
    )
    expect(entries).toHaveLength(10)
    for (const row of entries) ListingSuppressionEntry.parse(camel(row))
    const rows = await t.asPipeline(
      `select listing_id::text, reason, until from listing_suppression.v_suppressed`,
    )
    expect(rows.length).toBe(6)
    for (const row of rows) ListingSuppressionSuppressed.parse(camel(row))
  })

  it('stores hashes only: no listing ID, seller ID or text', async () => {
    const values = (await t.sql(`select value from listing_suppression.entries`)).map((r) =>
      String(r.value),
    )
    const ids = recorded.dataset.map((row) => String(row.listingId))
    for (const value of values) {
      expect(value).toMatch(/^[0-9a-f]{64}$/)
      for (const id of ids) expect(value).not.toContain(id)
    }
    const columns = await t.sql(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'listing_suppression'`,
    )
    for (const c of columns) {
      expect(String(c.column_name)).not.toMatch(/seller|profile|name|url|raw|title|description/)
    }
  })
})
