import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { aggregate, onRecorded } from '../src/index'
import {
  ALL_ON,
  createTestDatabase,
  daysAgo,
  seedListing,
  seedReport,
  seedUser,
  setSwitches,
  type TestDatabase,
  testDeps,
} from './support/database'

// Rule 8: the aggregator keyed by its inputs hash (design §6.6): a replay writes nothing and
// publishes no event.

const NOW = new Date('2026-09-25T12:00:00.000Z')
const USER = '0190f1d2-0000-7000-8000-000000000001'

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await setSwitches(t, ALL_ON)
  await seedUser(t, USER, 60, NOW)
})
afterEach(async () => {
  await t.close()
})

describe('seller-reply-reports idempotency', () => {
  it('the aggregator run twice writes once and publishes once', async () => {
    const listing = await seedListing(t, '1001')
    const id = await seedReport(t, {
      listingId: listing,
      userId: USER,
      createdAt: daysAgo(NOW, 2),
      reasons: [{ reason: 'payment_first' }],
    })
    const first = await t.as('nabvy_pipeline', (q) =>
      aggregate(q, { listingIds: [listing, listing] }, testDeps(), { now: NOW }),
    )
    expect(first.changedListingIds).toEqual([listing])
    expect(first.events).toHaveLength(1)
    const snapshot = await t.sql(
      `select (select max(updated_at) from seller_reply_reports.listing_evidence) as e,
              (select max(updated_at) from seller_reply_reports.reports) as r,
              (select max(updated_at) from seller_reply_reports.report_reasons) as rr`,
    )
    const later = new Date(NOW.getTime() + 60_000)
    const second = await t.as('nabvy_pipeline', (q) =>
      aggregate(q, { listingIds: [listing] }, testDeps(), { now: later }),
    )
    expect(second).toEqual({ changedListingIds: [], events: [] })
    const replay = await t.as('nabvy_pipeline', (q) =>
      onRecorded(
        q,
        [{ source: 'facebook', reportIds: [id], recordedAt: NOW.toISOString() }],
        testDeps(),
      ),
    )
    expect(replay).toEqual([])
    expect(
      await t.sql(
        `select (select max(updated_at) from seller_reply_reports.listing_evidence) as e,
                (select max(updated_at) from seller_reply_reports.reports) as r,
                (select max(updated_at) from seller_reply_reports.report_reasons) as rr`,
      ),
    ).toEqual(snapshot)
  })
})
