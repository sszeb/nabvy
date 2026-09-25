import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { recordVerdict, setState } from '../src/index'
import {
  ALL_ON,
  createTestDatabase,
  seedUser,
  setSwitches,
  type TestDatabase,
} from './support/database'

// Rule 11 of docs/design/modules/_rules.md. Off: feedback controls are unavailable, nothing is
// written, and both the internal and user-facing views are empty. Shadow: recording still writes
// (the module has no batch work for "off" to stop, and a write is a command, never a read), the
// internal view has rows, and the user-facing view has none.

const U1 = '0190f1d2-0000-7000-8000-000000000001'
const LISTING = '0190f1d2-0000-7000-8000-0000000000a1'
const NOW = new Date('2026-09-24T12:00:00.000Z')

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await seedUser(db, U1, 'one@example.com')
}, 60_000)
afterAll(() => db?.close())
beforeEach(() => setSwitches(db, ALL_ON))

const rows = (result: unknown) => (result as { rows: unknown[] }).rows
const internalCounts = () =>
  db.as('nabvy_pipeline', (q) => q.execute('select * from listing_feedback.v_verdict_counts'))
const userFacing = () =>
  db.as('nabvy_app', (q) => q.execute('select * from listing_feedback.v_listing_feedback_mine'), U1)

describe('switch', () => {
  it('off: refuses recordVerdict and setState, writes nothing, and both views are empty', async () => {
    await setSwitches(db, { 'listing-feedback': 'off' })
    const verdict = await db.as(
      'nabvy_app',
      (q) =>
        recordVerdict(q, { userId: U1, listingId: LISTING, verdict: 'real_deal' }, { now: NOW }),
      U1,
    )
    expect(verdict.ok ? 'ok' : verdict.error.code).toBe('listing-feedback.off')
    const stateOutcome = await db.as(
      'nabvy_app',
      (q) => setState(q, { userId: U1, listingId: LISTING, state: 'saved' }, { now: NOW }),
      U1,
    )
    expect(stateOutcome.ok ? 'ok' : stateOutcome.error.code).toBe('listing-feedback.off')
    const [{ n }] = (await db.sql(
      `select count(*)::int as n from listing_feedback.verdicts where user_id = $1`,
      [U1],
    )) as [{ n: number }]
    expect(n).toBe(0)
    expect(rows(await internalCounts())).toHaveLength(0)
    expect(rows(await userFacing())).toHaveLength(0)
  })

  it('shadow: recording writes, internal view has rows, user-facing view has none', async () => {
    const outcome = await db.as(
      'nabvy_app',
      (q) =>
        recordVerdict(q, { userId: U1, listingId: LISTING, verdict: 'real_deal' }, { now: NOW }),
      U1,
    )
    expect(outcome.ok).toBe(true)
    await setSwitches(db, { 'listing-feedback': 'shadow' })
    const shadowOutcome = await db.as(
      'nabvy_app',
      (q) =>
        recordVerdict(q, { userId: U1, listingId: LISTING, verdict: 'not_a_deal' }, { now: NOW }),
      U1,
    )
    expect(shadowOutcome.ok).toBe(true)
    expect(rows(await internalCounts()).length).toBeGreaterThan(0)
    expect(rows(await userFacing())).toHaveLength(0)
  })

  it('on: the user sees their own feedback', async () => {
    await db.as(
      'nabvy_app',
      (q) =>
        recordVerdict(q, { userId: U1, listingId: LISTING, verdict: 'real_deal' }, { now: NOW }),
      U1,
    )
    expect(rows(await userFacing()).length).toBeGreaterThan(0)
  })
})
