import { setPreference } from '@nabvy/marketing-consent'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryEmailResolver, purgeUser, run } from '../src'
import { createTestDatabase, type TestDatabase } from './support/database'

const USER = '00000000-0000-4000-8000-0000000000b1'
const NOW = new Date('2026-09-24T12:00:00.000Z')

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
  await t.createUser({ userId: USER })
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
    (tx) => setPreference(tx, { userId: USER, category: 'tips', granted: true, source: 'signup' }),
    USER,
  )
})
afterEach(async () => {
  await t.close()
})

const emailResolver = () => new InMemoryEmailResolver({ [USER]: 'person@example.com' })

describe('idempotency', () => {
  it('run() called twice for the same batch sends the step once', async () => {
    await t.insertEvent({
      userId: USER,
      event: 'hunt_created',
      properties: { pack: 'gpu-pc', radius: 10, minDealScore: 0.5 },
      at: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
    })
    const first = await t.as('nabvy_pipeline', (tx) =>
      run(tx, { now: NOW, emailResolver: emailResolver() }),
    )
    const second = await t.as('nabvy_pipeline', (tx) =>
      run(tx, { now: NOW, emailResolver: emailResolver() }),
    )
    expect(first.sent).toBe(1)
    expect(second.sent).toBe(0)
    expect(second.skipped['already-sent']).toBe(1)
    const rows = await t.sql(
      `select count(*)::int as n from lifecycle_messaging.programme_runs where user_id = $1`,
      [USER],
    )
    expect(Number(rows[0]?.n)).toBe(1)
  })

  it('a later trigger occurrence for the same programme can send again (a new triggeredAt)', async () => {
    await t.insertEvent({
      userId: USER,
      event: 'hunt_created',
      properties: { pack: 'gpu-pc', radius: 10, minDealScore: 0.5 },
      at: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
    })
    await t.as('nabvy_pipeline', (tx) => run(tx, { now: NOW, emailResolver: emailResolver() }))

    const laterNow = new Date(NOW.getTime() + 10 * 24 * 60 * 60 * 1000)
    await t.insertEvent({
      userId: USER,
      event: 'hunt_created',
      properties: { pack: 'gpu-pc', radius: 10, minDealScore: 0.5 },
      at: new Date(laterNow.getTime() - 3 * 60 * 60 * 1000),
    })
    const second = await t.as('nabvy_pipeline', (tx) =>
      run(tx, { now: laterNow, emailResolver: emailResolver() }),
    )
    expect(second.sent).toBe(1)
    const rows = await t.sql(
      `select count(*)::int as n from lifecycle_messaging.programme_runs where user_id = $1`,
      [USER],
    )
    expect(Number(rows[0]?.n)).toBe(2)
  })

  it('purgeUser is idempotent: a replay finds nothing left to purge', async () => {
    await t.insertEvent({
      userId: USER,
      event: 'hunt_created',
      properties: { pack: 'gpu-pc', radius: 10, minDealScore: 0.5 },
      at: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
    })
    await t.as('nabvy_pipeline', (tx) => run(tx, { now: NOW, emailResolver: emailResolver() }))
    await t.as('nabvy_pipeline', (tx) => purgeUser(tx, USER))
    await t.as('nabvy_pipeline', (tx) => purgeUser(tx, USER))
    const rows = await t.sql(
      `select count(*)::int as n from lifecycle_messaging.programme_runs where user_id = $1`,
      [USER],
    )
    expect(Number(rows[0]?.n)).toBe(0)
  })
})
