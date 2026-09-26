import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createPickup,
  dueReminders,
  markRemindersSent,
  planDay,
  setStatus,
  updateDefaults,
  updatePickup,
} from '../src/index'
import {
  createTestDatabase,
  DAY,
  deps,
  seedUser,
  setSwitch,
  type TestDatabase,
  U1,
} from './support/database'

// Rule 8 of docs/design/modules/_rules.md: reminders are idempotent on (pickup, kind, due time);
// a due scan returns the same reminder until it is marked sent, and marking twice changes nothing;
// event keys are derived from stored rows.

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await seedUser(db, U1, 'one@example.com')
}, 60_000)
afterAll(() => db?.close())
beforeEach(() => setSwitch(db, 'on'))

const reminders = (pickupId: string) =>
  db.sql(
    `select kind, due_at, sent_at from pickup_routes.pickup_reminders where pickup_id = $1 order by due_at`,
    [pickupId],
  )

describe('idempotency', () => {
  it('re-scheduling the same pickup twice keeps one row per (kind, due time)', async () => {
    const created = await db.as(
      'nabvy_app',
      (q) =>
        createPickup(
          q,
          {
            userId: U1,
            label: 'RTX 3090',
            postcode: 'PO21 1AA',
            day: DAY,
            window: { kind: 'at', start: '10:30' },
          },
          deps(),
        ),
      U1,
    )
    if (!created.ok) throw new Error(created.error.message)
    const id = created.value.pickup.id
    const first = await reminders(id)
    expect(first.map((r) => r.kind)).toEqual(['evening_before', 'leave_by'])
    const updated = await db.as(
      'nabvy_app',
      (q) => updatePickup(q, { userId: U1, pickupId: id, notes: 'same times' }, deps()),
      U1,
    )
    expect(updated.ok).toBe(true)
    expect(await reminders(id)).toEqual(first)

    // A plan moves the leave-by reminder; re-planning to the same answer keeps one row.
    await db.as(
      'nabvy_app',
      (q) => updateDefaults(q, { userId: U1, homePostcode: 'PO19 1AA' }, deps()),
      U1,
    )
    const p1 = await db.as('nabvy_app', (q) => planDay(q, { userId: U1, day: DAY }, deps()), U1)
    const p2 = await db.as('nabvy_app', (q) => planDay(q, { userId: U1, day: DAY }, deps()), U1)
    if (!p1.ok || !p2.ok) throw new Error('plan failed')
    expect(p2.value.plan.version).toBe(p1.value.plan.version + 1)
    expect(p2.value.plan.stops[0]?.leaveAt).toBe(p1.value.plan.stops[0]?.leaveAt)
    const planned = await reminders(id)
    expect(planned).toHaveLength(2)
    expect(planned.find((r) => r.kind === 'leave_by')?.due_at).not.toEqual(first[1]?.due_at)

    // Collected: the reminders go; collected twice: still gone, same event key.
    const s1 = await db.as(
      'nabvy_app',
      (q) => setStatus(q, { userId: U1, pickupId: id, status: 'collected' }, deps()),
      U1,
    )
    const s2 = await db.as(
      'nabvy_app',
      (q) => setStatus(q, { userId: U1, pickupId: id, status: 'collected' }, deps()),
      U1,
    )
    if (!s1.ok || !s2.ok) throw new Error('setStatus failed')
    expect(await reminders(id)).toEqual([])
    expect(s1.value.event.key).toContain(id)
  })

  it('a due reminder is returned until marked sent; marking twice writes once', async () => {
    const created = await db.as(
      'nabvy_app',
      (q) =>
        createPickup(
          q,
          {
            userId: U1,
            label: 'Monitor',
            postcode: 'PO1 1AA',
            day: DAY,
            window: { kind: 'unagreed' },
          },
          deps(),
        ),
      U1,
    )
    if (!created.ok) throw new Error(created.error.message)
    const now = new Date('2026-09-25T19:30:00Z') // after both the 18:00 and 19:00 BST reminders
    const a = await db.as('nabvy_pipeline', (q) => dueReminders(q, { now }))
    const b = await db.as('nabvy_pipeline', (q) => dueReminders(q, { now }))
    expect(a.reminderIds.length).toBeGreaterThanOrEqual(2)
    expect(b.reminderIds).toEqual(a.reminderIds)
    expect(a.events.map((e) => e.key)).toEqual(b.events.map((e) => e.key))
    expect(await db.as('nabvy_pipeline', (q) => markRemindersSent(q, a.reminderIds, now))).toBe(
      a.reminderIds.length,
    )
    expect(await db.as('nabvy_pipeline', (q) => markRemindersSent(q, a.reminderIds, now))).toBe(0)
    expect((await db.as('nabvy_pipeline', (q) => dueReminders(q, { now }))).reminderIds).toEqual([])
  })
})
