import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { aggregate, submit } from '../src/index'
import {
  ALL_ON,
  createTestDatabase,
  daysAgo,
  minutesAgo,
  seedListing,
  seedReport,
  seedUser,
  setSwitches,
  suppressListing,
  type TestDatabase,
  testDeps,
} from './support/database'

// Rule 11: off writes nothing and every view is empty; shadow computes everything but shows the
// reporter's own reports to testers only (design §6.2); on shows them to everyone.

const NOW = new Date('2026-09-25T12:00:00.000Z')
const USER = '0190f1d2-0000-7000-8000-000000000001'
const PAYMENT = [{ reason: 'payment_first', detail: 'deposit' }]

let t: TestDatabase
let listing: string
beforeEach(async () => {
  t = await createTestDatabase()
  await setSwitches(t, ALL_ON)
  await seedUser(t, USER, 60, NOW)
  listing = await seedListing(t, '1001')
})
afterEach(async () => {
  await t.close()
})

const mine = () =>
  t.as(
    'nabvy_app',
    async (q) =>
      (
        (await q.execute('select report_id from app.v_seller_reply_reports_mine')) as unknown as {
          rows: unknown[]
        }
      ).rows,
    USER,
  )
const internal = async () =>
  (
    (await t.as('nabvy_pipeline', (q) =>
      q.execute('select * from seller_reply_reports.v_listing_evidence'),
    )) as unknown as { rows: unknown[] }
  ).rows

describe('seller-reply-reports switch', () => {
  it('off: submit is refused, the aggregator writes nothing, every view is empty', async () => {
    await seedReport(t, {
      listingId: listing,
      userId: USER,
      createdAt: daysAgo(NOW, 2),
      reasons: PAYMENT,
    })
    await setSwitches(t, { 'seller-reply-reports': 'off' })
    const refused = await t.as(
      'nabvy_app',
      (q) =>
        submit(
          q,
          { userId: USER, source: 'facebook', listingId: listing, reasons: [{ reason: 'other' }] },
          testDeps({ opens: { [listing]: minutesAgo(NOW, 30) } }),
          { now: NOW },
        ),
      USER,
    )
    expect(!refused.ok && refused.error.code).toBe('seller-reply-reports.off')
    const out = await t.as('nabvy_pipeline', (q) =>
      aggregate(q, { listingIds: [listing] }, testDeps(), { now: NOW }),
    )
    expect(out).toEqual({ changedListingIds: [], events: [] })
    expect(
      await t.sql('select count(*)::int as n from seller_reply_reports.listing_evidence'),
    ).toEqual([{ n: 0 }])
    expect(await mine()).toHaveLength(0)
  })

  it('shadow: evidence is computed; "Your reports" and the sheet are for testers only', async () => {
    await setSwitches(t, { 'seller-reply-reports': 'shadow' })
    await seedReport(t, {
      listingId: listing,
      userId: USER,
      createdAt: daysAgo(NOW, 2),
      reasons: PAYMENT,
    })
    await t.as('nabvy_pipeline', (q) =>
      aggregate(q, { listingIds: [listing] }, testDeps(), { now: NOW }),
    )
    expect(await internal()).toHaveLength(1)
    expect(await mine()).toHaveLength(0)
    const deps = testDeps({ opens: { [listing]: minutesAgo(NOW, 30) } })
    const other = await seedListing(t, '1002')
    const refused = await t.as(
      'nabvy_app',
      (q) =>
        submit(
          q,
          { userId: USER, source: 'facebook', listingId: other, reasons: [{ reason: 'other' }] },
          deps,
          { now: NOW },
        ),
      USER,
    )
    expect(!refused.ok && refused.error.code).toBe('seller-reply-reports.not_eligible')
    await t.sql(
      `insert into seller_reply_reports.testers (user_id, added_by, audit_id, added_at) values ($1, $1, nabvy_core.uuidv7(), now())`,
      [USER],
    )
    expect(await mine()).toHaveLength(1)
  })

  it('on: the reporter sees their own reports, never a suppressed listing, nothing with suppression off', async () => {
    await seedReport(t, {
      listingId: listing,
      userId: USER,
      createdAt: daysAgo(NOW, 2),
      reasons: PAYMENT,
    })
    expect(await mine()).toHaveLength(1)
    await setSwitches(t, { 'listing-suppression': 'off' })
    expect(await mine()).toHaveLength(0)
    await setSwitches(t, { 'listing-suppression': 'on' })
    await suppressListing(t, '1001')
    expect(await mine()).toHaveLength(0)
  })
})
