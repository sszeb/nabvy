import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { onAccountDeleted } from '../src/handlers'
import { setPreferences, upsertWant } from '../src/index'
import {
  ALL_ON,
  CHICHESTER,
  createTestDatabase,
  seedCentre,
  seedUser,
  setSwitches,
  type TestDatabase,
  testDeps,
  wantInput,
} from './support/database'

const U1 = '0190f1d2-0000-7000-8000-000000000001'
const U2 = '0190f1d2-0000-7000-8000-000000000002'

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await seedUser(db, U1, 'one@example.com')
  await seedUser(db, U2, 'two@example.com')
  await seedCentre(db, CHICHESTER)
}, 60_000)
afterAll(() => db?.close())
beforeEach(() => setSwitches(db, ALL_ON))

const counts = async (userId: string) => {
  const one = async (table: string) => {
    const [row] = (await db.sql(
      `select count(*)::int as n from want_manager.${table} where user_id = $1`,
      [userId],
    )) as [{ n: number }]
    return row.n
  }
  return {
    wants: await one('wants'),
    criteria: await one('criteria'),
    preferences: await one('preferences'),
  }
}

describe('purge on account.deleted', () => {
  it("removes the deleted user's rows, leaves others alone, and runs twice safely", async () => {
    for (const u of [U1, U2]) {
      await db.as('nabvy_app', (q) => upsertWant(q, wantInput(u), testDeps), u)
      await db.as(
        'nabvy_app',
        (q) =>
          setPreferences(q, {
            userId: u,
            hideNoise: true,
            hideSpam: true,
            hideMultiQuantity: false,
            channels: ['email'],
            quietHours: null,
          }),
        u,
      )
    }
    expect(await counts(U1)).toEqual({ wants: 1, criteria: 2, preferences: 1 })

    await setSwitches(db, { 'want-manager': 'off' }) // a purge is owed whatever the switch says
    await db.as('nabvy_pipeline', (q) => onAccountDeleted(q, [{ userId: U1 }, { userId: U1 }]))
    expect(await counts(U1)).toEqual({ wants: 0, criteria: 0, preferences: 0 })
    expect(await counts(U2)).toEqual({ wants: 1, criteria: 2, preferences: 1 })
    await db.as('nabvy_pipeline', (q) => onAccountDeleted(q, [{ userId: U1 }]))
    expect(await counts(U2)).toEqual({ wants: 1, criteria: 2, preferences: 1 })
  })
})
