import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { onAccountDeleted } from '../src/handlers'
import { createPickup, deletePickup, planDay, purgeExpired, updateDefaults } from '../src/index'
import {
  createTestDatabase,
  DAY,
  deps,
  seedUser,
  setSwitch,
  type TestDatabase,
  U1,
  U2,
} from './support/database'

// Rule 12 of docs/design/modules/_rules.md (purge on account.deleted), §5.6 retention (30 days
// after the day, the interim default) and §7.9 (deleting a pickup deletes its plans and days).

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await seedUser(db, U1, 'one@example.com')
  await seedUser(db, U2, 'two@example.com')
}, 60_000)
afterAll(() => db?.close())
beforeEach(() => setSwitch(db, 'on'))

const counts = async (userId: string) => {
  const out: Record<string, number> = {}
  for (const table of [
    'pickups',
    'pickup_reminders',
    'pickup_days',
    'route_plans',
    'planner_defaults',
  ]) {
    const [row] = (await db.sql(
      `select count(*)::int as n from pickup_routes.${table} where user_id = $1`,
      [userId],
    )) as [{ n: number }]
    out[table] = row.n
  }
  return out
}

const arrange = async (userId: string, label: string, postcode: string, day = DAY) => {
  await db.as(
    'nabvy_app',
    (q) => updateDefaults(q, { userId, homePostcode: 'PO19 1AA' }, deps()),
    userId,
  )
  const outcome = await db.as(
    'nabvy_app',
    (q) =>
      createPickup(
        q,
        { userId, label, postcode, day, window: { kind: 'at', start: '10:30' } },
        deps(),
      ),
    userId,
  )
  if (!outcome.ok) throw new Error(outcome.error.message)
  const planned = await db.as('nabvy_app', (q) => planDay(q, { userId, day }, deps()), userId)
  if (!planned.ok) throw new Error(planned.error.message)
  return outcome.value.pickup.id
}

describe('purges', () => {
  it("account.deleted removes the user's rows in all five tables and leaves other users alone", async () => {
    await arrange(U1, 'RTX 3090', 'PO21 1AA')
    await arrange(U2, 'Monitor', 'PO1 1AA')
    expect((await counts(U1)).route_plans).toBe(1)
    await db.as('nabvy_pipeline', (q) => onAccountDeleted(q, [{ userId: U1 }, { userId: U1 }]))
    expect(await counts(U1)).toEqual({
      pickups: 0,
      pickup_reminders: 0,
      pickup_days: 0,
      route_plans: 0,
      planner_defaults: 0,
    })
    expect((await counts(U2)).pickups).toBe(1)
    expect((await counts(U2)).planner_defaults).toBe(1)
    await expect(
      db.as('nabvy_pipeline', (q) => onAccountDeleted(q, [{ userId: U1 }])),
    ).resolves.not.toThrow()
  })

  it('deleting a pickup deletes its reminders and every plan and day row for its day', async () => {
    const id = await arrange(U1, 'Case', 'BN17 1AA')
    expect((await counts(U1)).route_plans).toBe(1)
    const outcome = await db.as(
      'nabvy_app',
      (q) => deletePickup(q, { userId: U1, pickupId: id }, deps()),
      U1,
    )
    expect(outcome.ok && outcome.value.deleted).toBe(true)
    const after = await counts(U1)
    expect(after.pickups).toBe(0)
    expect(after.pickup_reminders).toBe(0)
    expect(after.pickup_days).toBe(0)
    expect(after.route_plans).toBe(0)
    expect(after.planner_defaults).toBe(1)
    const again = await db.as(
      'nabvy_app',
      (q) => deletePickup(q, { userId: U1, pickupId: id }, deps()),
      U1,
    )
    expect(again.ok && again.value.deleted).toBe(false)
  })

  it('retention deletes pickups, days and plans older than 30 days after their day, and nothing newer', async () => {
    await arrange(U1, 'Old', 'PO21 1AA', '2026-08-01')
    await arrange(U1, 'Recent', 'PO1 1AA', '2026-09-20')
    const result = await db.as('nabvy_pipeline', (q) =>
      purgeExpired(q, { now: new Date('2026-09-25T12:00:00Z') }),
    )
    expect(result).toEqual({ pickups: 1, days: 1 })
    const left = await db.sql(
      `select label, day::text as day from pickup_routes.pickups where user_id = $1`,
      [U1],
    )
    expect(left.map((r) => r.label)).toEqual(['Recent'])
    expect(
      await db.as('nabvy_pipeline', (q) =>
        purgeExpired(q, { now: new Date('2026-09-25T12:00:00Z') }),
      ),
    ).toEqual({ pickups: 0, days: 0 })
    await setSwitch(db, 'off')
    expect(
      await db.as('nabvy_pipeline', (q) =>
        purgeExpired(q, { now: new Date('2027-01-01T12:00:00Z') }),
      ),
    ).toEqual({ pickups: 0, days: 0 })
  })
})
