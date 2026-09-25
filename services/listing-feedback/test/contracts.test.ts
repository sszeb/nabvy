import { parseEvent } from '@nabvy/contracts'
import {
  events,
  ListingFeedbackBoughtForReport,
  ListingFeedbackMine,
  ListingFeedbackVerdictCount,
} from '@nabvy/contracts/modules/listing-feedback'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { recordVerdict, setState } from '../src/index'
import {
  ALL_ON,
  createTestDatabase,
  seedListing,
  seedUser,
  setSwitches,
  type TestDatabase,
} from './support/database'

const U1 = '0190f1d2-0000-7000-8000-000000000001'
const NOW = new Date('2026-09-24T12:00:00.000Z')

let db: TestDatabase
let listingId: string
beforeAll(async () => {
  db = await createTestDatabase()
  await seedUser(db, U1, 'one@example.com')
  listingId = await seedListing(db, { sourceListingId: 'fb-1' })
}, 60_000)
afterAll(() => db?.close())
beforeEach(() => setSwitches(db, ALL_ON))

const rows = (result: unknown) => (result as { rows: unknown[] }).rows

describe('contracts', () => {
  it('the recorded event parses with the payload schema', async () => {
    const outcome = await db.as(
      'nabvy_app',
      (q) => recordVerdict(q, { userId: U1, listingId, verdict: 'bought' }, { now: NOW }),
      U1,
    )
    if (!outcome.ok) throw new Error('recordVerdict failed')
    expect(outcome.value.event.type).toBe('listing-feedback.recorded')
    parseEvent(events, outcome.value.event)
  })

  it('every v_verdict_counts row parses', async () => {
    await db.as(
      'nabvy_app',
      (q) => recordVerdict(q, { userId: U1, listingId, verdict: 'real_deal' }, { now: NOW }),
      U1,
    )
    const result = rows(
      await db.as('nabvy_pipeline', (q) =>
        q.execute('select * from listing_feedback.v_verdict_counts'),
      ),
    ) as Record<string, unknown>[]
    for (const row of result) {
      ListingFeedbackVerdictCount.parse({
        alertId: row.alert_id,
        day: String(row.day),
        verdict: row.verdict,
        n: Number(row.n),
      })
    }
  })

  it('every v_bought_for_reports row parses and carries no seller-like column', async () => {
    await db.as(
      'nabvy_app',
      (q) => recordVerdict(q, { userId: U1, listingId, verdict: 'bought' }, { now: NOW }),
      U1,
    )
    const result = rows(
      await db.as('nabvy_pipeline', (q) =>
        q.execute('select * from listing_feedback.v_bought_for_reports'),
      ),
    ) as Record<string, unknown>[]
    expect(result.length).toBeGreaterThan(0)
    for (const row of result) {
      ListingFeedbackBoughtForReport.parse({
        userId: row.user_id,
        listingId: row.listing_id,
        at: new Date(String(row.at)).toISOString(),
      })
      expect(Object.keys(row)).not.toEqual(expect.arrayContaining(['seller_name', 'profile_url']))
    }
  })

  it('every v_listing_feedback_mine row parses', async () => {
    await db.as(
      'nabvy_app',
      (q) => setState(q, { userId: U1, listingId, state: 'saved' }, { now: NOW }),
      U1,
    )
    const result = rows(
      await db.as(
        'nabvy_app',
        (q) => q.execute('select * from listing_feedback.v_listing_feedback_mine'),
        U1,
      ),
    ) as Record<string, unknown>[]
    expect(result.length).toBeGreaterThan(0)
    for (const row of result) {
      ListingFeedbackMine.parse({
        listingId: row.listing_id,
        alertId: row.alert_id,
        verdict: row.verdict,
        state: row.state,
        at: new Date(String(row.at)).toISOString(),
      })
    }
  })
})
