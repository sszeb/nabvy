import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { recordVerdict } from '../src/index'
import {
  ALL_ON,
  createTestDatabase,
  seedListing,
  seedUser,
  setSwitches,
  suppressListing,
  type TestDatabase,
} from './support/database'

// Card: "a user cannot read another user's verdicts; v_verdict_counts carries no user ID." Rule 5
// of docs/design/modules/_rules.md: a view that shows listings leaves out suppressed listings.

const U1 = '0190f1d2-0000-7000-8000-000000000001'
const U2 = '0190f1d2-0000-7000-8000-000000000002'
const LISTING = '0190f1d2-0000-7000-8000-0000000000a1'
const NOW = new Date('2026-09-24T12:00:00.000Z')

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await seedUser(db, U1, 'one@example.com')
  await seedUser(db, U2, 'two@example.com')
}, 60_000)
afterAll(() => db?.close())
beforeEach(() => setSwitches(db, ALL_ON))

const rows = (result: unknown) => (result as { rows: unknown[] }).rows

describe('row-level security', () => {
  it('a user cannot read, update or insert as another user', async () => {
    const outcome = await db.as(
      'nabvy_app',
      (q) =>
        recordVerdict(q, { userId: U1, listingId: LISTING, verdict: 'real_deal' }, { now: NOW }),
      U1,
    )
    if (!outcome.ok) throw new Error('recordVerdict failed')

    const asU2 = await db.as(
      'nabvy_app',
      (q) =>
        q.execute(
          `select * from listing_feedback.verdicts where id = '${outcome.value.verdictId}'`,
        ),
      U2,
    )
    expect(rows(asU2)).toHaveLength(0)

    await expect(
      db.as(
        'nabvy_app',
        (q) =>
          q.execute(
            `update listing_feedback.verdicts set verdict = 'bought' where id = '${outcome.value.verdictId}'`,
          ),
        U2,
      ),
    ).resolves.not.toThrow() // RLS silently matches zero rows; assert nothing actually changed
    const [row] = await db.sql(`select verdict from listing_feedback.verdicts where id = $1`, [
      outcome.value.verdictId,
    ])
    expect(row?.verdict).toBe('real_deal')

    await expect(
      db.as(
        'nabvy_app',
        (q) =>
          q.execute(
            `insert into listing_feedback.verdicts (user_id, listing_id, verdict, at)
             values ('${U2}', '${LISTING}', 'bought', now()) returning id`,
          ),
        U1,
      ),
    ).rejects.toThrow() // WITH CHECK refuses a row for another user even as U1
  })

  it('v_verdict_counts carries no user ID', async () => {
    await db.as(
      'nabvy_app',
      (q) =>
        recordVerdict(q, { userId: U1, listingId: LISTING, verdict: 'real_deal' }, { now: NOW }),
      U1,
    )
    const [row] = rows(
      await db.as('nabvy_pipeline', (q) =>
        q.execute('select * from listing_feedback.v_verdict_counts'),
      ),
    ) as Record<string, unknown>[]
    expect(row).toBeDefined()
    expect(Object.keys(row ?? {})).not.toContain('user_id')
    expect(Object.keys(row ?? {})).not.toContain('userId')
  })

  it('a suppressed listing never reaches v_listing_feedback_mine', async () => {
    const sourceListingId = 'fb-suppressed-1'
    const listingId = await seedListing(db, { sourceListingId })
    const outcome = await db.as(
      'nabvy_app',
      (q) => recordVerdict(q, { userId: U1, listingId, verdict: 'real_deal' }, { now: NOW }),
      U1,
    )
    expect(outcome.ok).toBe(true)
    const mine = (id: string) =>
      db.as(
        'nabvy_app',
        (q) =>
          q.execute(
            `select * from listing_feedback.v_listing_feedback_mine where listing_id = '${id}'`,
          ),
        U1,
      )
    expect(rows(await mine(listingId)).length).toBeGreaterThan(0)

    await suppressListing(db, '0190f1d2-0000-7000-8000-0000000000c1', 'facebook', sourceListingId)
    expect(rows(await mine(listingId))).toHaveLength(0)
  })
})
