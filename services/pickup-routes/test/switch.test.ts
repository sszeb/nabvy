import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createPickup, dueReminders, listForDay, planDay, reminderText } from '../src/index'
import {
  createTestDatabase,
  DAY,
  deps,
  seedUser,
  setSwitch,
  type TestDatabase,
  U1,
} from './support/database'

// Rule 11 of docs/design/modules/_rules.md and the card's "When off": the pickups pages and "Plan
// my day" are hidden (every user-facing function refuses), records are kept and reminders paused
// (the due scan returns nothing). No view exists, so shadow has nothing to hide; writes still run.

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await seedUser(db, U1, 'one@example.com')
}, 60_000)
afterAll(() => db?.close())
beforeEach(() => setSwitch(db, 'on'))

const input = {
  userId: U1,
  label: 'RTX 3090',
  postcode: 'PO21 1AA',
  day: DAY,
  window: { kind: 'at' as const, start: '10:30' },
}

describe('switch', () => {
  it('off: refuses reads, writes and planning, writes nothing, and pauses reminders', async () => {
    const on = await db.as('nabvy_app', (q) => createPickup(q, input, deps()), U1)
    if (!on.ok) throw new Error(on.error.message)
    await setSwitch(db, 'off')
    const created = await db.as(
      'nabvy_app',
      (q) => createPickup(q, { ...input, label: 'Off' }, deps()),
      U1,
    )
    expect(created.ok ? 'ok' : created.error.code).toBe('pickup-routes.off')
    const listed = await db.as(
      'nabvy_app',
      (q) => listForDay(q, { userId: U1, day: DAY }, deps()),
      U1,
    )
    expect(listed.ok ? 'ok' : listed.error.code).toBe('pickup-routes.off')
    const planned = await db.as(
      'nabvy_app',
      (q) => planDay(q, { userId: U1, day: DAY }, deps()),
      U1,
    )
    expect(planned.ok ? 'ok' : planned.error.code).toBe('pickup-routes.off')
    const text = await db.as(
      'nabvy_app',
      (q) => reminderText(q, { userId: U1, pickupId: on.value.pickup.id, kind: 'evening_before' }),
      U1,
    )
    expect(text.ok ? 'ok' : text.error.code).toBe('pickup-routes.off')
    const [{ n }] = (await db.sql(`select count(*)::int as n from pickup_routes.pickups`)) as [
      { n: number },
    ]
    expect(n).toBe(1) // kept, not added to
    const due = await db.as('nabvy_pipeline', (q) =>
      dueReminders(q, { now: new Date('2027-01-01T00:00:00Z') }),
    )
    expect(due.reminderIds).toEqual([])
  })

  it('shadow: writes and reads run (there is no user-facing view to hide)', async () => {
    await setSwitch(db, 'shadow')
    const created = await db.as(
      'nabvy_app',
      (q) => createPickup(q, { ...input, label: 'Shadow' }, deps()),
      U1,
    )
    expect(created.ok).toBe(true)
    const listed = await db.as(
      'nabvy_app',
      (q) => listForDay(q, { userId: U1, day: DAY }, deps()),
      U1,
    )
    expect(listed.ok && listed.value.some((p) => p.label === 'Shadow')).toBe(true)
  })

  it('a suspended account is refused', async () => {
    await db.sql(`update better_auth."user" set banned = true where id = $1`, [U1])
    const created = await db.as(
      'nabvy_app',
      (q) => createPickup(q, { ...input, label: 'Banned' }, deps()),
      U1,
    )
    expect(created.ok ? 'ok' : created.error.code).toBe('pickup-routes.account_restricted')
    await db.sql(`update better_auth."user" set banned = false where id = $1`, [U1])
  })
})
