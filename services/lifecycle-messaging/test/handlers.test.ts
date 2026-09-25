import { createEvent } from '@nabvy/contracts'
import { events as accountEvents } from '@nabvy/contracts/modules/account'
import { createMemoryPublisher } from '@nabvy/transport'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { accountDeletedHandler } from '../src/handlers'
import { createTestDatabase, type TestDatabase } from './support/database'

const attempt = { attempt: 1, maxAttempts: 3, firstAttemptAt: '2026-09-24T00:00:00.000Z' }

let t: TestDatabase
beforeEach(async () => {
  t = await createTestDatabase()
})
afterEach(async () => {
  await t.close()
})

describe('accountDeletedHandler', () => {
  it('purges the deleted user’s programme_runs rows', async () => {
    const userId = '00000000-0000-4000-8000-0000000000c1'
    await t.createUser({ userId })
    await t.sql(
      `insert into lifecycle_messaging.programme_runs (user_id, programme, step, triggered_at, at)
       values ($1, 'channel-not-linked', '2h', now(), now())`,
      [userId],
    )
    const before = await t.sql(
      `select count(*)::int as n from lifecycle_messaging.programme_runs where user_id = $1`,
      [userId],
    )
    expect(Number(before[0]?.n)).toBe(1)

    const handler = accountDeletedHandler({ transaction: (fn) => t.as('nabvy_pipeline', fn) })
    const envelope = createEvent(
      accountEvents,
      'account.deleted',
      1,
      { userId },
      { key: `user:${userId}` },
    )
    const deps = { publisher: createMemoryPublisher(), deadLetters: { record: async () => ({}) } }
    expect((await handler.run(envelope, attempt, deps)).status).toBe('handled')

    const rows = await t.sql(
      `select count(*)::int as n from lifecycle_messaging.programme_runs where user_id = $1`,
      [userId],
    )
    expect(Number(rows[0]?.n)).toBe(0)
  })

  it('is idempotent: a replay finds nothing left to purge', async () => {
    const userId = '00000000-0000-4000-8000-0000000000c2'
    await t.createUser({ userId })
    await t.sql(
      `insert into lifecycle_messaging.programme_runs (user_id, programme, step, triggered_at, at)
       values ($1, 'channel-not-linked', '2h', now(), now())`,
      [userId],
    )
    const handler = accountDeletedHandler({ transaction: (fn) => t.as('nabvy_pipeline', fn) })
    const envelope = createEvent(
      accountEvents,
      'account.deleted',
      1,
      { userId },
      { key: `user:${userId}` },
    )
    const deps = { publisher: createMemoryPublisher(), deadLetters: { record: async () => ({}) } }
    expect((await handler.run(envelope, attempt, deps)).status).toBe('handled')
    expect((await handler.run(envelope, attempt, deps)).status).toBe('handled')

    const rows = await t.sql(
      `select count(*)::int as n from lifecycle_messaging.programme_runs where user_id = $1`,
      [userId],
    )
    expect(Number(rows[0]?.n)).toBe(0)
  })
})
