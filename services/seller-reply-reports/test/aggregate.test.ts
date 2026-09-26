import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  aggregate,
  onStandingChanged,
  recordVerdictFixture,
  resolve,
} from './support/aggregate-helpers'
import {
  ALL_ON,
  createTestDatabase,
  daysAgo,
  evidence,
  minutesAgo,
  seedListing,
  seedReport,
  seedUser,
  setSwitches,
  type TestDatabase,
  testDeps,
} from './support/database'

// The aggregator (§3.2-3.3) against real tables: weights, people, holds, spreading, outcomes.

const NOW = new Date('2026-09-25T12:00:00.000Z')
const U = (n: number) => `0190f1d2-0000-7000-8000-0000000000${String(n).padStart(2, '0')}`
const PAYMENT = [{ reason: 'payment_first', detail: 'bank_transfer' }]

let t: TestDatabase
let listing: string
beforeEach(async () => {
  t = await createTestDatabase()
  await setSwitches(t, ALL_ON)
  for (let i = 1; i <= 6; i++) await seedUser(t, U(i), 60, NOW)
  listing = await seedListing(t, '1001')
})
afterEach(async () => {
  await t.close()
})

const run = (listingIds: string[], deps = testDeps()) =>
  t.as('nabvy_pipeline', (q) => aggregate(q, { listingIds }, deps, { now: NOW }))
const payment = async () =>
  (await evidence(t, listing)).find((e) => e.family === 'payment' && e.scope === 'own')

describe('aggregate', () => {
  it('one established reporter makes `single`; two independent people `multiple`', async () => {
    await seedReport(t, {
      listingId: listing,
      userId: U(1),
      createdAt: daysAgo(NOW, 2),
      reasons: PAYMENT,
    })
    await run([listing])
    expect(await payment()).toMatchObject({
      persons: 1,
      weight_sum: 1,
      level: 'single',
      held: false,
    })
    await seedReport(t, {
      listingId: listing,
      userId: U(2),
      createdAt: daysAgo(NOW, 1),
      reasons: PAYMENT,
    })
    await run([listing])
    expect(await payment()).toMatchObject({ persons: 2, weight_sum: 2, level: 'multiple' })
  })

  it('an account under 30 days old and an unverified email add no weight', async () => {
    await seedUser(t, U(1), 29, NOW)
    await seedReport(t, {
      listingId: listing,
      userId: U(1),
      createdAt: daysAgo(NOW, 2),
      reasons: PAYMENT,
    })
    await seedReport(t, {
      listingId: listing,
      userId: U(2),
      createdAt: daysAgo(NOW, 1),
      reasons: PAYMENT,
    })
    await run([listing], testDeps({ unverified: [U(2)] }))
    expect(await payment()).toMatchObject({ persons: 0, level: 'none' })
    const rows = await t.sql(
      `select reporter_user_id::text as u, eligibility, weight::float as w from seller_reply_reports.reports order by u`,
    )
    expect(rows).toEqual([
      { u: U(1), eligibility: 'too_new', w: 0 },
      { u: U(2), eligibility: 'email_unverified', w: 0 },
    ])
  })

  it('withdrawing removes the weight', async () => {
    await seedReport(t, {
      listingId: listing,
      userId: U(1),
      createdAt: daysAgo(NOW, 2),
      reasons: PAYMENT,
      withdrawnAt: daysAgo(NOW, 1),
    })
    await run([listing])
    expect(await payment()).toMatchObject({ persons: 0, level: 'none' })
  })

  it('linked accounts count once, at the lowest weight', async () => {
    await t.sql(
      `insert into seller_reply_reports.reporter_stats (user_id, upheld, not_upheld) values ($1, 0, 3)`,
      [U(2)],
    )
    await seedReport(t, {
      listingId: listing,
      userId: U(1),
      createdAt: daysAgo(NOW, 3),
      reasons: PAYMENT,
    })
    await seedReport(t, {
      listingId: listing,
      userId: U(2),
      createdAt: daysAgo(NOW, 2),
      reasons: PAYMENT,
    })
    await run([listing], testDeps({ groups: { [U(1)]: 'house', [U(2)]: 'house' } }))
    expect(await payment()).toMatchObject({ persons: 1, weight_sum: 0.4, level: 'none' })
  })

  it('holds a burst of 3 reports within 24 hours, and gives them no weight', async () => {
    for (const i of [1, 2, 3])
      await seedReport(t, {
        listingId: listing,
        userId: U(i),
        createdAt: minutesAgo(NOW, 60 * i),
        reasons: PAYMENT,
      })
    await run([listing])
    expect(await payment()).toMatchObject({ held: true, hold_reason: 'burst', level: 'none' })
    const holds = await t.sql(`select scope_key, reason from seller_reply_reports.holds`)
    expect(holds).toEqual([{ scope_key: listing, reason: 'burst' }])
  })

  it('holds 2 reports within 6 hours on a gem candidate', async () => {
    for (const i of [1, 2])
      await seedReport(t, {
        listingId: listing,
        userId: U(i),
        createdAt: minutesAgo(NOW, 60 * i),
        reasons: PAYMENT,
      })
    await run([listing], testDeps({ gems: [listing] }))
    expect(await payment()).toMatchObject({ held: true, hold_reason: 'gem_burst' })
  })

  it('a counter-report holds the level for review and never lowers it', async () => {
    await seedReport(t, {
      listingId: listing,
      userId: U(1),
      createdAt: daysAgo(NOW, 3),
      reasons: PAYMENT,
    })
    await seedReport(t, {
      listingId: listing,
      userId: U(2),
      createdAt: daysAgo(NOW, 2),
      reasons: [{ reason: 'as_listed' }],
    })
    await run([listing])
    expect(await payment()).toMatchObject({
      level: 'single',
      weight_sum: 1,
      counter_weight: 1,
      held: true,
      hold_reason: 'counter_report',
    })
  })

  it('report-then-buy removes the weight and sets outcome `unknown`, except for the item family', async () => {
    await seedReport(t, {
      listingId: listing,
      userId: U(1),
      createdAt: daysAgo(NOW, 3),
      reasons: [...PAYMENT, { reason: 'not_as_described', detail: 'different_model' }],
    })
    await recordVerdictFixture(t, U(1), listing, daysAgo(NOW, 1))
    await run([listing])
    const rows = await evidence(t, listing)
    expect(rows.find((e) => e.family === 'payment')).toMatchObject({ level: 'none' })
    expect(rows.find((e) => e.family === 'item')).toMatchObject({ level: 'single' })
    const [report] = await t.sql(`select outcome, outcome_by from seller_reply_reports.reports`)
    expect(report).toEqual({ outcome: 'unknown', outcome_by: 'report_then_buy' })
  })

  it("a banned reporter's reports are voided", async () => {
    await seedReport(t, {
      listingId: listing,
      userId: U(1),
      createdAt: daysAgo(NOW, 3),
      reasons: PAYMENT,
    })
    await run([listing])
    await t.sql(`insert into account.standing (user_id, status) values ($1, 'banned')`, [U(1)])
    await t.as('nabvy_pipeline', (q) => onStandingChanged(q, [{ userId: U(1) }], testDeps()))
    expect(await payment()).toMatchObject({ level: 'none' })
    const [report] = await t.sql(
      `select outcome, outcome_by, status from seller_reply_reports.reports`,
    )
    expect(report).toEqual({ outcome: 'void', outcome_by: 'ban', status: 'removed_after_check' })
  })

  it('resolve() records outcomes, lowers the reporter accuracy, and is idempotent', async () => {
    const id = await seedReport(t, {
      listingId: listing,
      userId: U(1),
      createdAt: daysAgo(NOW, 3),
      reasons: PAYMENT,
    })
    const first = await t.as('nabvy_pipeline', (q) =>
      resolve(q, { reportIds: [id], outcome: 'not_upheld', by: 'review' }, testDeps(), {
        now: NOW,
      }),
    )
    expect(first.ok && first.value.resolvedIds).toEqual([id])
    const [stats] = await t.sql(
      `select upheld, not_upheld from seller_reply_reports.reporter_stats`,
    )
    expect(stats).toEqual({ upheld: 0, not_upheld: 1 })
    const again = await t.as('nabvy_pipeline', (q) =>
      resolve(q, { reportIds: [id], outcome: 'not_upheld', by: 'review' }, testDeps(), {
        now: NOW,
      }),
    )
    expect(again.ok && again.value.events).toEqual([])
  })

  it('carries nothing across relists: carried_from_relist is never set', async () => {
    await seedReport(t, {
      listingId: listing,
      userId: U(1),
      createdAt: daysAgo(NOW, 3),
      reasons: PAYMENT,
    })
    await run([listing])
    const rows = await t.sql(
      `select count(*)::int as n from seller_reply_reports.listing_evidence where carried_from_relist`,
    )
    expect(rows[0]?.n).toBe(0)
  })
})

describe('spreading across a copy-advert cluster (§3.2)', () => {
  // The owner's example: listed on the Isle of Wight, collection said to be in Manchester.
  const IOW = { lat: 50.69, lng: -1.3 }
  const CHICHESTER = { lat: 50.84, lng: -0.78 }
  const MANCHESTER = { lat: 53.48, lng: -2.24 }

  it('re-measures a location report from each member, and never spreads to the possible original', async () => {
    const chi = await seedListing(t, '2002')
    const man = await seedListing(t, '2003')
    const orig = await seedListing(t, '2004')
    await seedReport(t, {
      listingId: listing,
      userId: U(1),
      createdAt: daysAgo(NOW, 3),
      reasons: [{ reason: 'collection_elsewhere', placeId: 'manchester', secondAnswer: 'no' }],
    })
    const deps = testDeps({
      clusters: [{ key: 'c1', members: [listing, chi, man, orig] }],
      originals: [orig],
      listingPoints: { [listing]: IOW, [chi]: CHICHESTER, [man]: MANCHESTER, [orig]: CHICHESTER },
      placePoints: { manchester: MANCHESTER },
    })
    const out = await run([listing], deps)
    expect(out.changedListingIds.sort()).toEqual([listing, chi, man].sort())
    const all = await evidence(t)
    const loc = (id: string, scope: string) =>
      all.find((e) => e.listing_id === id && e.family === 'location' && e.scope === scope)
    expect(loc(listing, 'own')).toMatchObject({ level: 'single' })
    expect(loc(chi, 'copy')).toMatchObject({ level: 'single' })
    expect(loc(man, 'copy')).toMatchObject({ level: 'none' })
    expect(loc(orig, 'copy')).toBeUndefined()
    const [reason] = await t.sql(
      `select distance_band, counts from seller_reply_reports.report_reasons`,
    )
    expect(reason).toEqual({ distance_band: '100_plus', counts: 'any_path' })
  })
})
