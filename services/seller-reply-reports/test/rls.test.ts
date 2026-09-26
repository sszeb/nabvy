import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ALL_ON,
  createTestDatabase,
  daysAgo,
  seedListing,
  seedReport,
  seedUser,
  setSwitches,
  type TestDatabase,
} from './support/database'

// Row-level security and grants (docs/security.md): a reporter reads only their own reports and
// never their internal columns; no internal view reaches nabvy_app.

const NOW = new Date('2026-09-25T12:00:00.000Z')
const A = '0190f1d2-0000-7000-8000-000000000001'
const B = '0190f1d2-0000-7000-8000-000000000002'

let t: TestDatabase
let listing: string
beforeEach(async () => {
  t = await createTestDatabase()
  await setSwitches(t, ALL_ON)
  await seedUser(t, A, 60, NOW)
  await seedUser(t, B, 60, NOW)
  listing = await seedListing(t, '1001')
  await seedReport(t, {
    listingId: listing,
    userId: A,
    createdAt: daysAgo(NOW, 1),
    reasons: [{ reason: 'other' }],
  })
})
afterEach(async () => {
  await t.close()
})

const asApp = (userId: string | undefined, query: string) =>
  t.as(
    'nabvy_app',
    async (q) => ((await q.execute(query)) as unknown as { rows: unknown[] }).rows,
    userId,
  )

describe('row-level security', () => {
  it('a user reads only their own reports and reasons, and nothing outside withUser', async () => {
    expect(await asApp(A, 'select id from seller_reply_reports.reports')).toHaveLength(1)
    expect(await asApp(B, 'select id from seller_reply_reports.reports')).toHaveLength(0)
    expect(await asApp(B, 'select reason from seller_reply_reports.report_reasons')).toHaveLength(0)
    expect(await asApp(undefined, 'select id from seller_reply_reports.reports')).toHaveLength(0)
    expect(await asApp(B, 'select report_id from app.v_seller_reply_reports_mine')).toHaveLength(0)
    expect(await asApp(A, 'select report_id from app.v_seller_reply_reports_mine')).toHaveLength(1)
  })

  it('a user cannot report as someone else', async () => {
    await expect(
      asApp(
        B,
        `insert into seller_reply_reports.reports (source, listing_id, reporter_user_id, rule_version) values ('facebook', '${listing}', '${A}', 'x')`,
      ),
    ).rejects.toThrow()
  })

  it('the app role cannot read or set internal columns', async () => {
    await expect(asApp(A, 'select eligibility from seller_reply_reports.reports')).rejects.toThrow()
    await expect(asApp(A, 'select weight from seller_reply_reports.reports')).rejects.toThrow()
    await expect(
      asApp(A, `update seller_reply_reports.reports set eligibility = 'eligible'`),
    ).rejects.toThrow()
    await expect(
      asApp(A, `update seller_reply_reports.reports set status = 'helping_warn'`),
    ).rejects.toThrow()
  })

  it('no internal view, and not v_reporter_signals, reaches nabvy_app', async () => {
    for (const view of [
      'v_listing_evidence',
      'v_review_items',
      'v_shadow_metrics',
      'v_reporter_signals',
    ]) {
      await expect(asApp(A, `select 1 from seller_reply_reports.${view}`)).rejects.toThrow()
    }
    const grants = await t.sql(
      `select grantee from information_schema.role_table_grants
       where table_schema = 'seller_reply_reports' and table_name = 'v_reporter_signals' and privilege_type = 'SELECT' and grantee like 'nabvy%'
       order by grantee`,
    )
    expect(grants.map((g) => g.grantee)).toEqual(['nabvy_pipeline'])
  })

  it('v_listing_evidence and v_review_items carry no user ID and no free text', async () => {
    const cols = await t.sql(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'seller_reply_reports' and table_name in ('v_listing_evidence', 'v_review_items')`,
    )
    const names = cols.map((c) => String(c.column_name))
    expect(names.some((n) => n.includes('user'))).toBe(false)
    const mine = await t.sql(
      `select column_name from information_schema.columns where table_schema = 'app' and table_name = 'v_seller_reply_reports_mine' order by ordinal_position`,
    )
    expect(mine.map((c) => c.column_name)).toEqual([
      'report_id',
      'listing_id',
      'reasons',
      'status',
      'created_at',
      'withdrawable',
    ])
  })

  it('refuses free text: note_text stays null', async () => {
    await expect(
      t.sql(`update seller_reply_reports.reports set note_text = 'hello'`),
    ).rejects.toThrow()
  })
})
