import {
  events,
  module,
  SellerReplyReportsEvidenceChangedEvent,
  SellerReplyReportsListingEvidence,
  SellerReplyReportsMine,
  SellerReplyReportsRecordedEvent,
  SellerReplyReportsReporterSignal,
  SellerReplyReportsSubmitInput,
} from '@nabvy/contracts/modules/seller-reply-reports'
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
  type TestDatabase,
  testDeps,
} from './support/database'

const NOW = new Date('2026-09-25T12:00:00.000Z')
const USER = '0190f1d2-0000-7000-8000-000000000001'

describe('seller-reply-reports contracts', () => {
  it('declares its name and three events', () => {
    expect(module).toBe('seller-reply-reports')
    expect(Object.keys(events.definitions).sort()).toEqual([
      'seller-reply-reports.evidence-changed',
      'seller-reply-reports.recorded',
      'seller-reply-reports.resolved',
    ])
  })

  it('has no free-text or link field on a reason', () => {
    const base = { userId: USER, source: 'facebook', listingId: USER }
    expect(
      SellerReplyReportsSubmitInput.safeParse({
        ...base,
        reasons: [{ reason: 'other', note: 'hi' }],
      }).success,
    ).toBe(false)
    expect(
      SellerReplyReportsSubmitInput.safeParse({
        ...base,
        reasons: [{ reason: 'link_or_fb_delivery', kind: 'payment_link', url: 'x' }],
      }).success,
    ).toBe(false)
    expect(
      SellerReplyReportsSubmitInput.safeParse({
        ...base,
        reasons: [{ reason: 'collection_elsewhere', placeId: 'PO30 1AB', canSeeAndPay: 'no' }],
      }).success,
    ).toBe(false)
  })
})

describe('events and view rows parse', () => {
  let t: TestDatabase
  beforeEach(async () => {
    t = await createTestDatabase()
    await setSwitches(t, ALL_ON)
    await seedUser(t, USER, 60, NOW)
  })
  afterEach(async () => {
    await t.close()
  })

  it('recorded, evidence-changed and every view row', async () => {
    const listing = await seedListing(t, '1001')
    const made = await t.as(
      'nabvy_app',
      (q) =>
        submit(
          q,
          {
            userId: USER,
            source: 'facebook',
            listingId: listing,
            reasons: [{ reason: 'payment_first', kind: 'deposit' }],
          },
          testDeps({ opens: { [listing]: minutesAgo(NOW, 30) } }),
          { now: NOW },
        ),
      USER,
    )
    expect(made.ok && SellerReplyReportsRecordedEvent.parse(made.value.event?.payload)).toBeTruthy()
    await seedReport(t, {
      listingId: listing,
      userId: '0190f1d2-0000-7000-8000-000000000002',
      createdAt: daysAgo(NOW, 1),
      reasons: [{ reason: 'other' }],
    })
    const agg = await t.as('nabvy_pipeline', (q) =>
      aggregate(q, { listingIds: [listing] }, testDeps(), { now: NOW }),
    )
    expect(SellerReplyReportsEvidenceChangedEvent.parse(agg.events[0]?.payload).listingIds).toEqual(
      [listing],
    )

    const camel = (row: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(row).map(([k, v]) => [
          k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase()),
          v instanceof Date
            ? v.toISOString()
            : /_at$|^as_of$/.test(k) && typeof v === 'string'
              ? new Date(v).toISOString()
              : v,
        ]),
      )
    const evidenceRows = await t.sql('select * from seller_reply_reports.v_listing_evidence')
    expect(evidenceRows.length).toBeGreaterThan(0)
    for (const row of evidenceRows) SellerReplyReportsListingEvidence.parse(camel(row))
    const signals = await t.sql('select * from seller_reply_reports.v_reporter_signals')
    for (const row of signals) SellerReplyReportsReporterSignal.parse(camel(row))
    const mine = await t.as(
      'nabvy_app',
      async (q) =>
        (
          (await q.execute('select * from app.v_seller_reply_reports_mine')) as unknown as {
            rows: Record<string, unknown>[]
          }
        ).rows,
      USER,
    )
    expect(mine).toHaveLength(1)
    for (const row of mine) SellerReplyReportsMine.parse(camel(row))
  })
})
