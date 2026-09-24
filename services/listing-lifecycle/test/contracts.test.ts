import {
  events,
  ListingLifecycleRecheckRequest,
  ListingLifecycleStatus,
  ListingLifecycleStatusChangedEvent,
} from '@nabvy/contracts/modules/listing-lifecycle'
import { vStatus } from '@nabvy/db/schema/listing-lifecycle'
import { getViewConfig } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tick } from '../src'
import {
  ALL_ON,
  createTestDatabase,
  loadRun,
  RECORDED,
  runJob,
  type TestDatabase,
} from './support/database'

let t: TestDatabase
beforeAll(async () => {
  t = await createTestDatabase()
  await t.switches(ALL_ON)
  await runJob(t, loadRun(RECORDED), { kind: 'search', collectedAt: '2026-09-24T01:40:43.415Z' })
  await tick(t.db, { now: new Date('2026-09-24T02:40:43.415Z') })
})
afterAll(async () => {
  await t.close()
})

const camel = (row: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v instanceof Date ? v.toISOString() : v,
    ]),
  )

describe('contracts', () => {
  it('every v_status row parses', async () => {
    const rows = await t.asPipeline('select * from listing_lifecycle.v_status')
    expect(rows).toHaveLength(20)
    for (const row of rows) expect(ListingLifecycleStatus.parse(camel(row))).toBeTruthy()
  })

  it('the Drizzle view has exactly the contract columns', () => {
    const columns = Object.keys(getViewConfig(vStatus).selectedFields).sort()
    expect(columns).toEqual(Object.keys(ListingLifecycleStatus.shape).sort())
  })

  it('the event carries identifiers only, at most 500', () => {
    expect(Object.keys(ListingLifecycleStatusChangedEvent.shape)).toEqual(['listingIds'])
    expect(
      ListingLifecycleStatusChangedEvent.safeParse({
        listingIds: Array.from({ length: 501 }, () => '01920000-0000-7000-8000-000000000001'),
      }).success,
    ).toBe(false)
    expect(Object.keys(events.definitions)).toEqual(['listing-lifecycle.status-changed'])
  })

  it('a recheck request is bounded and carries no time', () => {
    const ok = {
      listingIds: ['01920000-0000-7000-8000-000000000001'],
      reason: 'watched',
      requestedBy: 'watch',
    }
    expect(ListingLifecycleRecheckRequest.safeParse(ok).success).toBe(true)
    expect(
      ListingLifecycleRecheckRequest.safeParse({ ...ok, dueAt: '2026-09-24T00:00:00Z' }).success,
    ).toBe(false)
    expect(ListingLifecycleRecheckRequest.safeParse({ ...ok, reason: 'not-seen' }).success).toBe(
      false,
    )
    expect(ListingLifecycleRecheckRequest.safeParse({ ...ok, listingIds: [] }).success).toBe(false)
  })

  it('no status column is seller-like', () => {
    for (const key of Object.keys(ListingLifecycleStatus.shape)) {
      expect(key.toLowerCase()).not.toMatch(/seller|name|profile|photo|price/)
    }
  })
})
