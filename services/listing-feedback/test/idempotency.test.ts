import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { recordVerdict, setState } from '../src/index'
import {
  ALL_ON,
  createTestDatabase,
  seedUser,
  setSwitches,
  type TestDatabase,
} from './support/database'

const U1 = '0190f1d2-0000-7000-8000-000000000001'
const LISTING = '0190f1d2-0000-7000-8000-0000000000a1'
const ALERT = '0190f1d2-0000-7000-8000-0000000000b1'
const NOW = new Date('2026-09-24T12:00:00.000Z')

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await seedUser(db, U1, 'one@example.com')
}, 60_000)
afterAll(() => db?.close())
beforeEach(() => setSwitches(db, ALL_ON))

const verdictRows = async () =>
  (
    (await db.sql(`select count(*)::int as n from listing_feedback.verdicts where user_id = $1`, [
      U1,
    ])) as [{ n: number }]
  )[0].n
const stateRows = async () =>
  (
    (await db.sql(
      `select count(*)::int as n from listing_feedback.listing_state where user_id = $1`,
      [U1],
    )) as [{ n: number }]
  )[0].n

describe('idempotency', () => {
  it('the same verdict sent twice writes one row and republishes the same event key', async () => {
    const input = { userId: U1, listingId: LISTING, verdict: 'real_deal' as const }
    const first = await db.as('nabvy_app', (q) => recordVerdict(q, input, { now: NOW }), U1)
    const second = await db.as('nabvy_app', (q) => recordVerdict(q, input, { now: NOW }), U1)
    if (!first.ok || !second.ok) throw new Error('recordVerdict failed')
    expect(first.value.created).toBe(true)
    expect(second.value.created).toBe(false)
    expect(second.value.event.key).toBe(first.value.event.key)
    expect(second.value.verdictId).toBe(first.value.verdictId)
    expect(await verdictRows()).toBe(1)
  })

  it('a changed verdict for the same listing and alert replaces the row', async () => {
    const base = { userId: U1, listingId: LISTING, alertId: ALERT }
    const first = await db.as(
      'nabvy_app',
      (q) => recordVerdict(q, { ...base, verdict: 'real_deal' }, { now: NOW }),
      U1,
    )
    const changed = await db.as(
      'nabvy_app',
      (q) => recordVerdict(q, { ...base, verdict: 'not_a_deal' }, { now: NOW }),
      U1,
    )
    if (!first.ok || !changed.ok) throw new Error('recordVerdict failed')
    expect(changed.value.verdictId).toBe(first.value.verdictId)
    expect(changed.value.event.key).not.toBe(first.value.event.key)
    const [row] = await db.sql(`select verdict from listing_feedback.verdicts where id = $1`, [
      first.value.verdictId,
    ])
    expect(row?.verdict).toBe('not_a_deal')
  })

  it('a verdict with an alert and one without are separate rows for the same listing', async () => {
    await db.as(
      'nabvy_app',
      (q) =>
        recordVerdict(q, { userId: U1, listingId: LISTING, verdict: 'real_deal' }, { now: NOW }),
      U1,
    )
    await db.as(
      'nabvy_app',
      (q) =>
        recordVerdict(
          q,
          { userId: U1, listingId: LISTING, alertId: ALERT, verdict: 'bought' },
          { now: NOW },
        ),
      U1,
    )
    expect(await verdictRows()).toBe(2)
  })

  it('the same state sent twice writes one row', async () => {
    const input = { userId: U1, listingId: LISTING, state: 'saved' as const }
    const first = await db.as('nabvy_app', (q) => setState(q, input, { now: NOW }), U1)
    const second = await db.as('nabvy_app', (q) => setState(q, input, { now: NOW }), U1)
    if (!first.ok || !second.ok) throw new Error('setState failed')
    expect(first.value.created).toBe(true)
    expect(second.value.created).toBe(false)
    expect(await stateRows()).toBe(1)
  })

  it('dismissing after saving replaces the state, one row', async () => {
    await db.as(
      'nabvy_app',
      (q) => setState(q, { userId: U1, listingId: LISTING, state: 'saved' }, { now: NOW }),
      U1,
    )
    await db.as(
      'nabvy_app',
      (q) => setState(q, { userId: U1, listingId: LISTING, state: 'dismissed' }, { now: NOW }),
      U1,
    )
    expect(await stateRows()).toBe(1)
    const [row] = await db.sql(
      `select state from listing_feedback.listing_state where user_id = $1`,
      [U1],
    )
    expect(row?.state).toBe('dismissed')
  })
})
