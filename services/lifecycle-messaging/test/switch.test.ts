import { setPreference } from '@nabvy/marketing-consent'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryEmailResolver, run } from '../src'
import { createTestDatabase, type TestDatabase } from './support/database'

const USER = '00000000-0000-4000-8000-0000000000a1'
const NOW = new Date('2026-09-24T12:00:00.000Z')

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.createUser({ userId: USER })
  // A channel-not-linked candidate: hunt_created 3 hours ago (step is due at 2h), no channel_linked.
  await t.insertEvent({
    userId: USER,
    event: 'hunt_created',
    properties: { pack: 'gpu-pc', radius: 10, minDealScore: 0.5 },
    at: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
  })
})
afterEach(async () => {
  await t.close()
})

const emailResolver = () => new InMemoryEmailResolver({ [USER]: 'person@example.com' })

// Rule 11 of docs/design/modules/_rules.md: off acknowledges (returns a result) but writes
// nothing and the internal view returns no rows.

describe('lifecycle-messaging off (no seed row: switches.state reads off for an unknown name)', () => {
  it('run() writes nothing and returns an empty result', async () => {
    const result = await t.as('nabvy_pipeline', (tx) =>
      run(tx, { now: NOW, emailResolver: emailResolver() }),
    )
    expect(result).toEqual({ evaluated: 0, sent: 0, skipped: {} })
    const rows = await t.sql('select count(*)::int as n from lifecycle_messaging.programme_runs')
    expect(Number(rows[0]?.n)).toBe(0)
  })

  it('v_runs returns no rows even if a run exists', async () => {
    await t.sql(
      `insert into lifecycle_messaging.programme_runs (user_id, programme, step, triggered_at, at)
       values ($1, 'channel-not-linked', '2h', $2, $2)`,
      [USER, NOW.toISOString()],
    )
    const rows = await t.sql('select count(*)::int as n from lifecycle_messaging.v_runs')
    expect(Number(rows[0]?.n)).toBe(0)
  })
})

describe('lifecycle-messaging on', () => {
  beforeEach(async () => {
    await t.sql(
      `insert into switches.switches (name, kind, state) values ('lifecycle-messaging', 'module', 'on')`,
    )
    await t.sql(
      `insert into switches.switches (name, kind, state) values ('marketing-consent', 'module', 'on')`,
    )
    await t.sql(
      `insert into switches.switches (name, kind, state) values ('product-events', 'module', 'on')`,
    )
    await t.as(
      'nabvy_app',
      (tx) =>
        setPreference(tx, { userId: USER, category: 'tips', granted: true, source: 'signup' }),
      USER,
    )
  })

  it('sends the due, consented step and records it in v_runs', async () => {
    const result = await t.as('nabvy_pipeline', (tx) =>
      run(tx, { now: NOW, emailResolver: emailResolver() }),
    )
    expect(result.sent).toBe(1)
    const rows = await t.sql(
      `select programme, step from lifecycle_messaging.v_runs where user_id = $1`,
      [USER],
    )
    expect(rows).toEqual([{ programme: 'channel-not-linked', step: '2h' }])
  })
})
