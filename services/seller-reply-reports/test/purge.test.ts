import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { aggregate, erase, onAccountDeleted } from '../src/index'
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

// Rule 12: account.deleted purges the user's rows; erase(listingIds) deletes every report on
// erased listings (seller-rights). Both are idempotent.

const NOW = new Date('2026-09-25T12:00:00.000Z')
const A = '0190f1d2-0000-7000-8000-000000000001'
const B = '0190f1d2-0000-7000-8000-000000000002'
const count = async (t: TestDatabase, table: string) =>
  (await t.sql(`select count(*)::int as n from seller_reply_reports.${table}`))[0]?.n

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
    createdAt: daysAgo(NOW, 3),
    reasons: [{ reason: 'payment_first' }],
  })
  await seedReport(t, {
    listingId: listing,
    userId: B,
    createdAt: daysAgo(NOW, 2),
    reasons: [{ reason: 'payment_first' }],
  })
  await t.sql(
    `insert into seller_reply_reports.testers (user_id, added_by, audit_id, added_at) values ($1, $1, nabvy_core.uuidv7(), now())`,
    [A],
  )
  await t.as('nabvy_pipeline', (q) =>
    aggregate(q, { listingIds: [listing] }, testDeps(), { now: NOW }),
  )
})
afterEach(async () => {
  await t.close()
})

describe('purge and erase', () => {
  it('account.deleted purges the user and recomputes the evidence, twice safely', async () => {
    for (let i = 0; i < 2; i++) {
      await t.as('nabvy_pipeline', (q) =>
        onAccountDeleted(q, [{ userId: A }, { userId: A }], testDeps()),
      )
    }
    expect(
      await t.sql(`select reporter_user_id::text as u from seller_reply_reports.reports`),
    ).toEqual([{ u: B }])
    expect(
      await t.sql(
        `select count(*)::int as n from seller_reply_reports.reporter_stats where user_id = $1`,
        [A],
      ),
    ).toEqual([{ n: 0 }])
    expect(await count(t, 'testers')).toBe(0)
    expect(await count(t, 'report_reasons')).toBe(1)
  })

  it('erase() deletes every report, evidence row and hold on the listings', async () => {
    await t.sql(
      `insert into seller_reply_reports.holds (source, scope_key, reason, opened_at) values ('facebook', $1, 'burst', now())`,
      [listing],
    )
    for (let i = 0; i < 2; i++) await t.as('nabvy_pipeline', (q) => erase(q, [listing]))
    expect(await count(t, 'reports')).toBe(0)
    expect(await count(t, 'report_reasons')).toBe(0)
    expect(await count(t, 'listing_evidence')).toBe(0)
    expect(await count(t, 'holds')).toBe(0)
  })
})
