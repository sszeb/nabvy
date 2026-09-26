import { parseEvent } from '@nabvy/contracts'
import {
  events,
  PickupRoutesPickupInput,
  PickupRoutesPlan,
  PickupRoutesReminderText,
  PickupRoutesWindow,
} from '@nabvy/contracts/modules/pickup-routes'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createPickup, dueReminders, planDay, reminderText, updateDefaults } from '../src/index'
import {
  createTestDatabase,
  DAY,
  deps,
  seedUser,
  setSwitch,
  type TestDatabase,
  U1,
} from './support/database'

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await seedUser(db, U1, 'one@example.com')
  await setSwitch(db, 'on')
  await db.as(
    'nabvy_app',
    (q) => updateDefaults(q, { userId: U1, homePostcode: 'PO19 1AA' }, deps()),
    U1,
  )
}, 60_000)
afterAll(() => db?.close())
beforeEach(() => setSwitch(db, 'on'))

describe('contracts', () => {
  it('bounds every input: a window needs the right ends, texts and numbers have limits', () => {
    expect(PickupRoutesWindow.safeParse({ kind: 'at' }).success).toBe(false)
    expect(
      PickupRoutesWindow.safeParse({ kind: 'between', start: '14:00', end: '13:00' }).success,
    ).toBe(false)
    expect(PickupRoutesWindow.safeParse({ kind: 'unagreed', start: '10:00' }).success).toBe(false)
    expect(PickupRoutesWindow.safeParse({ kind: 'after', start: '10:00' }).success).toBe(true)
    const base = {
      userId: U1,
      label: 'x',
      postcode: 'PO21 1AA',
      day: DAY,
      window: { kind: 'unagreed' },
    }
    expect(PickupRoutesPickupInput.safeParse({ ...base, label: 'x'.repeat(81) }).success).toBe(
      false,
    )
    expect(PickupRoutesPickupInput.safeParse({ ...base, notes: 'n'.repeat(1001) }).success).toBe(
      false,
    )
    expect(PickupRoutesPickupInput.safeParse({ ...base, priceMinor: -1 }).success).toBe(false)
    expect(PickupRoutesPickupInput.safeParse({ ...base, day: '26/09/2026' }).success).toBe(false)
    expect(PickupRoutesPickupInput.safeParse({ ...base, pastedText: 'hello' }).success).toBe(false)
    expect(
      PickupRoutesPickupInput.safeParse({ ...base, createdAt: '2026-01-01T00:00:00Z' }).success,
    ).toBe(false)
  })

  it('the changed, planned and reminder-due events parse and carry identifiers and times only', async () => {
    const created = await db.as(
      'nabvy_app',
      (q) =>
        createPickup(
          q,
          {
            userId: U1,
            label: 'RTX 3090',
            postcode: 'PO21 1AA',
            addressText: '12 Sea Road',
            day: DAY,
            window: { kind: 'at', start: '10:30' },
          },
          deps(),
        ),
      U1,
    )
    if (!created.ok) throw new Error(created.error.message)
    parseEvent(events, created.value.event)
    expect(JSON.stringify(created.value.event)).not.toMatch(/Sea Road|PO21|50\.78/)

    const planned = await db.as(
      'nabvy_app',
      (q) => planDay(q, { userId: U1, day: DAY }, deps()),
      U1,
    )
    if (!planned.ok) throw new Error(planned.error.message)
    parseEvent(events, planned.value.event)
    PickupRoutesPlan.parse(planned.value.plan)
    expect(planned.value.plan.basis).toBe('estimate')
    expect(planned.value.plan.costMinor).toBeNull()
    expect(JSON.stringify(planned.value.event)).not.toMatch(/Sea Road|PO21|50\.78/)
    const [stored] = await db.sql(
      `select stops::text as stops, unassigned::text as unassigned from pickup_routes.route_plans where id = $1`,
      [planned.value.plan.id],
    )
    expect(`${stored?.stops}${stored?.unassigned}`).not.toMatch(/Sea Road|PO21|50\.78|-0\.67/)

    const due = await db.as('nabvy_pipeline', (q) =>
      dueReminders(q, { now: new Date('2027-01-01T00:00:00Z') }),
    )
    expect(due.events.length).toBeGreaterThan(0)
    for (const event of due.events) parseEvent(events, event)
    const text = await db.as(
      'nabvy_app',
      (q) => reminderText(q, { userId: U1, pickupId: created.value.pickup.id, kind: 'leave_by' }),
      U1,
    )
    if (!text.ok) throw new Error(text.error.message)
    PickupRoutesReminderText.parse(text.value)
    expect(text.value.text).toMatch(/^Leave by \d\d:\d\d for 'RTX 3090' at 10:30$/)
  })
})
