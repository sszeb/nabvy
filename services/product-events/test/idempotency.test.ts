import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { InMemoryProductEventsForwarder, track } from '../src/index'
import { createTestDatabase, type TestDatabase } from './support/database'

// CLAUDE.md's idempotency key (source + sourceListingId + contentHash) is for event handlers
// replaying pipeline events. track() has no handlers (module card, "Inputs": track() calls only)
// and no natural idempotency key: two track() calls for the same user and event name are two real
// occurrences (a user opening two alerts is two `alert_opened` events), not a replay to collapse.
// What this module must still guarantee is that calling track() twice is safe to do -- it never
// corrupts state or double-counts a single call -- which this test proves directly.

const userId = '00000000-0000-7000-8000-0000000000e0'

let harness: TestDatabase
beforeAll(async () => {
  harness = await createTestDatabase()
  await harness.sql(
    "insert into switches.switches (name, kind, state) values ('product-events', 'module', 'on')",
  )
}, 60_000)
afterAll(() => harness.close())

describe('track called twice', () => {
  it('records one row per call, each independently, with no shared state corrupted', async () => {
    const input = {
      event: 'hunt_paused',
      properties: { pack: 'gpu-pc', radius: 40, minDealScore: 70 },
    }
    const forwarder = new InMemoryProductEventsForwarder()
    const first = await harness.as(
      'nabvy_app',
      (db) => track(db, userId, input, { state: 'on', forwarder }),
      userId,
    )
    const second = await harness.as(
      'nabvy_app',
      (db) => track(db, userId, input, { state: 'on', forwarder }),
      userId,
    )
    expect(first).toEqual({ ok: true, value: { recorded: true, forwarded: false } })
    expect(second).toEqual({ ok: true, value: { recorded: true, forwarded: false } })

    const rows = await harness.sql(
      'select count(*)::int as count from product_events.events where user_id = $1',
      [userId],
    )
    expect(rows[0]?.count).toBe(2)
  })
})
