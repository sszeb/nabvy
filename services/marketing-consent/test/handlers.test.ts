import { createEvent } from '@nabvy/contracts'
import { events as accountEvents } from '@nabvy/contracts/modules/account'
import { createMemoryPublisher } from '@nabvy/transport'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPreferences, setPreference } from '../src'
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
  it('purges the deleted user’s marketing_consents rows', async () => {
    const userId = '00000000-0000-4000-8000-0000000000d1'
    await t.createUser({ userId })
    await t.as(
      'nabvy_app',
      (tx) => setPreference(tx, { userId, category: 'tips', granted: true, source: 'signup' }),
      userId,
    )
    expect(
      (await t.as('nabvy_app', (tx) => getPreferences(tx, userId), userId)).preferences,
    ).toContainEqual({ category: 'tips', granted: true })

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
      `select count(*)::int as n from marketing_consent.marketing_consents where user_id = $1`,
      [userId],
    )
    expect(Number(rows[0]?.n)).toBe(0)
  })

  it('is idempotent: a replay finds nothing left to purge', async () => {
    const userId = '00000000-0000-4000-8000-0000000000d2'
    await t.createUser({ userId })
    await t.as(
      'nabvy_app',
      (tx) => setPreference(tx, { userId, category: 'tips', granted: true, source: 'signup' }),
      userId,
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
      `select count(*)::int as n from marketing_consent.marketing_consents where user_id = $1`,
      [userId],
    )
    expect(Number(rows[0]?.n)).toBe(0)
  })
})
