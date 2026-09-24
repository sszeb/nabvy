import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { InMemoryProductEventsForwarder, track } from '../src/index'
import { createTestDatabase, type TestDatabase } from './support/database'

// Rule 16 of docs/design/modules/_rules.md: off writes nothing and its view stays empty; shadow
// writes but (module card, "Views": "User-facing: none") has no user-facing rows to hide, so it
// behaves like `on` here (services/product-events/README.md, "Decisions"). "At least one reader's
// fixtures still pass with this module off" does not apply yet: no module declares product-events
// as a dependency (module card, "Depends on" lists what this module reads, not who reads it).

const userId = '00000000-0000-7000-8000-0000000000f0'

let harness: TestDatabase
beforeAll(async () => {
  harness = await createTestDatabase()
}, 60_000)
afterAll(() => harness.close())

describe('product-events switch', () => {
  it('off: track() writes nothing and forwards nothing, without refusing', async () => {
    const forwarder = new InMemoryProductEventsForwarder()
    const outcome = await harness.as(
      'nabvy_app',
      (db) =>
        track(
          db,
          userId,
          {
            event: 'signup_completed',
            properties: { method: 'magic-link', referralOrAffiliatePresent: false },
          },
          { state: 'off', forwarder },
        ),
      userId,
    )
    expect(outcome).toEqual({ ok: true, value: { recorded: false, forwarded: false } })
    expect(forwarder.captured).toHaveLength(0)
    const rows = await harness.sql(
      'select count(*)::int as count from product_events.events where user_id = $1',
      [userId],
    )
    expect(rows[0]?.count).toBe(0)
  })

  it('off: v_events returns no rows even for events written while the switch was on', async () => {
    await harness.sql(
      "insert into switches.switches (name, kind, state) values ('product-events', 'module', 'on')",
    )
    await harness.as(
      'nabvy_app',
      (db) =>
        track(
          db,
          userId,
          {
            event: 'signup_completed',
            properties: { method: 'magic-link', referralOrAffiliatePresent: false },
          },
          { state: 'on' },
        ),
      userId,
    )
    let rows = await harness.as('nabvy_pipeline', (db) =>
      db.execute('select * from product_events.v_events'),
    )
    expect((rows as { rows: unknown[] }).rows.length).toBeGreaterThan(0)

    await harness.sql("update switches.switches set state = 'off' where name = 'product-events'")
    rows = await harness.as('nabvy_pipeline', (db) =>
      db.execute('select * from product_events.v_events'),
    )
    expect((rows as { rows: unknown[] }).rows).toHaveLength(0)
  })

  it('shadow: records and forwards the same as on (no user-facing view to hide rows from)', async () => {
    await harness.sql("update switches.switches set state = 'shadow' where name = 'product-events'")
    await harness.sql(
      'insert into account.user_profiles (user_id, analytics_consent) values ($1, true) on conflict (user_id) do update set analytics_consent = true',
      [userId],
    )
    const forwarder = new InMemoryProductEventsForwarder()
    const outcome = await harness.as(
      'nabvy_app',
      (db) =>
        track(
          db,
          userId,
          {
            event: 'signup_completed',
            properties: { method: 'magic-link', referralOrAffiliatePresent: false },
          },
          { state: 'shadow', forwarder },
        ),
      userId,
    )
    expect(outcome).toEqual({ ok: true, value: { recorded: true, forwarded: true } })
    expect(forwarder.captured).toHaveLength(1)
  })
})
