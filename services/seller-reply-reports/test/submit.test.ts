import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canReport, edit, submit, withdraw } from '../src/index'
import {
  ALL_ON,
  createTestDatabase,
  minutesAgo,
  seedListing,
  seedUser,
  setSwitches,
  suppressListing,
  type TestDatabase,
  testDeps,
} from './support/database'

// The reporter's calls, as nabvy_app inside withUser (§3.1-3.2).

const NOW = new Date('2026-09-25T12:00:00.000Z')
const USER = '0190f1d2-0000-7000-8000-000000000001'
const PAYMENT = [{ reason: 'payment_first' as const, kind: 'bank_transfer' as const }]

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

const opened = (at = minutesAgo(NOW, 30)) => testDeps({ opens: { [listing]: at } })
const asUser = <T>(fn: Parameters<TestDatabase['as']>[1]) =>
  t.as('nabvy_app', fn, USER) as Promise<T>

describe('the gate', () => {
  it('offers no sheet without notifier open (the default seam)', async () => {
    const answer = await t.as(
      'nabvy_app',
      (q) => canReport(q, { userId: USER, listingIds: [listing] }, undefined, { now: NOW }),
      USER,
    )
    expect(answer.ok && answer.value).toEqual([
      { listingId: listing, allowed: false, reportId: null },
    ])
    const refused = await t.as(
      'nabvy_app',
      (q) =>
        submit(
          q,
          { userId: USER, source: 'facebook', listingId: listing, reasons: PAYMENT },
          undefined,
          { now: NOW },
        ),
      USER,
    )
    expect(!refused.ok && refused.error.code).toBe('seller-reply-reports.not_eligible')
  })

  it('offers it 5 minutes after an open, not before, and never when messaging is off', async () => {
    const ask = (deps: ReturnType<typeof testDeps>) =>
      t.as(
        'nabvy_app',
        (q) => canReport(q, { userId: USER, listingIds: [listing] }, deps, { now: NOW }),
        USER,
      )
    expect((await ask(opened(minutesAgo(NOW, 4)))).ok).toBe(true)
    expect(await ask(opened(minutesAgo(NOW, 4)))).toMatchObject({ value: [{ allowed: false }] })
    expect(await ask(opened())).toMatchObject({ value: [{ allowed: true }] })
    const off = testDeps({
      opens: { [listing]: minutesAgo(NOW, 30) },
      flags: { [listing]: { messagingEnabled: false, shippingOffered: false } },
    })
    expect(await ask(off)).toMatchObject({ value: [{ allowed: false }] })
  })

  it('offers no sheet on a suppressed listing', async () => {
    await suppressListing(t, '1001')
    const answer = await t.as(
      'nabvy_app',
      (q) => canReport(q, { userId: USER, listingIds: [listing] }, opened(), { now: NOW }),
      USER,
    )
    expect(answer).toMatchObject({ value: [{ allowed: false }] })
  })
})

describe('submit, edit and withdraw', () => {
  it('keeps one report per user per listing', async () => {
    const first = await asUser<Awaited<ReturnType<typeof submit>>>((q) =>
      submit(
        q,
        { userId: USER, source: 'facebook', listingId: listing, reasons: PAYMENT },
        opened(),
        { now: NOW },
      ),
    )
    expect(first.ok && first.value.created).toBe(true)
    expect(first.ok && first.value.event?.type).toBe('seller-reply-reports.recorded')
    const second = await asUser<Awaited<ReturnType<typeof submit>>>((q) =>
      submit(
        q,
        { userId: USER, source: 'facebook', listingId: listing, reasons: [{ reason: 'other' }] },
        opened(),
        { now: NOW },
      ),
    )
    expect(second.ok && second.value).toMatchObject({
      created: false,
      event: null,
      reportId: first.ok && first.value.reportId,
    })
    const rows = await t.sql(`select count(*)::int as n from seller_reply_reports.reports`)
    expect(rows[0]?.n).toBe(1)
    const reasons = await t.sql(`select reason, detail from seller_reply_reports.report_reasons`)
    expect(reasons).toEqual([{ reason: 'payment_first', detail: 'bank_transfer' }])
  })

  it('refuses duplicate reasons and "Nothing odd" with another reason', async () => {
    const dup = await asUser<Awaited<ReturnType<typeof submit>>>((q) =>
      submit(
        q,
        { userId: USER, source: 'facebook', listingId: listing, reasons: [...PAYMENT, ...PAYMENT] },
        opened(),
        { now: NOW },
      ),
    )
    expect(!dup.ok && dup.error.code).toBe('seller-reply-reports.duplicate_reason')
    const mixed = await asUser<Awaited<ReturnType<typeof submit>>>((q) =>
      submit(
        q,
        {
          userId: USER,
          source: 'facebook',
          listingId: listing,
          reasons: [...PAYMENT, { reason: 'as_listed' }],
        },
        opened(),
        { now: NOW },
      ),
    )
    expect(!mixed.ok && mixed.error.code).toBe('seller-reply-reports.as_listed_alone')
  })

  it('edits within 24 hours only', async () => {
    const made = await asUser<Awaited<ReturnType<typeof submit>>>((q) =>
      submit(
        q,
        { userId: USER, source: 'facebook', listingId: listing, reasons: PAYMENT },
        opened(),
        { now: NOW },
      ),
    )
    const reportId = made.ok ? made.value.reportId : ''
    await t.sql(`update seller_reply_reports.reports set created_at = $1`, [
      minutesAgo(NOW, 60).toISOString(),
    ])
    const ok = await asUser<Awaited<ReturnType<typeof edit>>>((q) =>
      edit(
        q,
        { userId: USER, reportId, reasons: [{ reason: 'postage_only', paidHow: 'bank_transfer' }] },
        { now: NOW },
      ),
    )
    expect(ok.ok).toBe(true)
    expect(
      await t.sql(`select reason, second_answer from seller_reply_reports.report_reasons`),
    ).toEqual([{ reason: 'postage_only', second_answer: 'bank_transfer' }])
    await t.sql(`update seller_reply_reports.reports set created_at = $1`, [
      minutesAgo(NOW, 24 * 60 + 1).toISOString(),
    ])
    const late = await asUser<Awaited<ReturnType<typeof edit>>>((q) =>
      edit(q, { userId: USER, reportId, reasons: PAYMENT }, { now: NOW }),
    )
    expect(!late.ok && late.error.code).toBe('seller-reply-reports.edit_window_closed')
  })

  it('withdraws at any time, idempotently', async () => {
    const made = await asUser<Awaited<ReturnType<typeof submit>>>((q) =>
      submit(
        q,
        { userId: USER, source: 'facebook', listingId: listing, reasons: PAYMENT },
        opened(),
        { now: NOW },
      ),
    )
    const reportId = made.ok ? made.value.reportId : ''
    await t.sql(`update seller_reply_reports.reports set created_at = $1`, [
      minutesAgo(NOW, 60 * 24 * 10).toISOString(),
    ])
    for (let i = 0; i < 2; i++) {
      const out = await asUser<Awaited<ReturnType<typeof withdraw>>>((q) =>
        withdraw(q, { userId: USER, reportId }, { now: NOW }),
      )
      expect(out.ok).toBe(true)
    }
    const [row] = await t.sql(
      `select status, withdrawn_at is not null as w from seller_reply_reports.reports`,
    )
    expect(row).toEqual({ status: 'withdrawn', w: true })
  })
})
