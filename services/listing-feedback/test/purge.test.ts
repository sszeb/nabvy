import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { onAccountDeleted } from '../src/handlers'
import { recordVerdict, setState } from '../src/index'
import {
  ALL_ON,
  createTestDatabase,
  seedUser,
  setSwitches,
  type TestDatabase,
} from './support/database'

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

const counts = async (userId: string) => {
  const [verdicts] = (await db.sql(
    `select count(*)::int as n from listing_feedback.verdicts where user_id = $1`,
    [userId],
  )) as [{ n: number }]
  const [states] = (await db.sql(
    `select count(*)::int as n from listing_feedback.listing_state where user_id = $1`,
    [userId],
  )) as [{ n: number }]
  return { verdicts: verdicts.n, states: states.n }
}

describe('purge on account.deleted', () => {
  it("removes the deleted user's rows and leaves other users alone", async () => {
    await db.as(
      'nabvy_app',
      (q) =>
        recordVerdict(q, { userId: U1, listingId: LISTING, verdict: 'real_deal' }, { now: NOW }),
      U1,
    )
    await db.as(
      'nabvy_app',
      (q) => setState(q, { userId: U1, listingId: LISTING, state: 'saved' }, { now: NOW }),
      U1,
    )
    await db.as(
      'nabvy_app',
      (q) => recordVerdict(q, { userId: U2, listingId: LISTING, verdict: 'bought' }, { now: NOW }),
      U2,
    )

    await db.as('nabvy_pipeline', (q) => onAccountDeleted(q, [{ userId: U1 }]))

    expect(await counts(U1)).toEqual({ verdicts: 0, states: 0 })
    expect(await counts(U2)).toEqual({ verdicts: 1, states: 0 })
  })

  it('is idempotent: a repeat run finds nothing left to purge', async () => {
    await db.as('nabvy_pipeline', (q) => onAccountDeleted(q, [{ userId: U1 }]))
    await expect(
      db.as('nabvy_pipeline', (q) => onAccountDeleted(q, [{ userId: U1 }])),
    ).resolves.not.toThrow()
    expect(await counts(U1)).toEqual({ verdicts: 0, states: 0 })
  })

  it('de-duplicates a batch of payloads for the same user', async () => {
    await db.as(
      'nabvy_app',
      (q) =>
        recordVerdict(q, { userId: U2, listingId: LISTING, verdict: 'real_deal' }, { now: NOW }),
      U2,
    )
    await db.as('nabvy_pipeline', (q) => onAccountDeleted(q, [{ userId: U2 }, { userId: U2 }]))
    expect(await counts(U2)).toEqual({ verdicts: 0, states: 0 })
  })
})
