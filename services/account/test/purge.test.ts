import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTelegramLinkCode, purgeDueDeletions, requestDeletion } from '../src'
import { createTestDatabase, type TestDatabase } from './support/database'

// purgeDueDeletions (review of PR #33, finding 4): a batch, idempotent sweep of every deletion
// request whose purge_by is due, erasing this module's own rows and returning one account.deleted
// envelope per user purged.

const U1 = '00000000-0000-4000-8000-0000000000c1'
const U2 = '00000000-0000-4000-8000-0000000000c2'
const NOT_DUE = '00000000-0000-4000-8000-0000000000c3'

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
  await db.sql(
    `insert into better_auth."user" (id, name, email) values
       ($1, 'One', 'one@example.com'),
       ($2, 'Two', 'two@example.com'),
       ($3, 'Later', 'later@example.com')`,
    [U1, U2, NOT_DUE],
  )
  await db.sql(
    `insert into switches.switches (name, kind, state) values ('account', 'module', 'on')`,
  )
}, 60_000)

afterAll(() => db.close())

describe('purgeDueDeletions', () => {
  it('erases a batch of due users, leaves an un-due one, and is idempotent', async () => {
    for (const userId of [U1, U2, NOT_DUE]) {
      await db.as('nabvy_app', (tx) => requestDeletion(tx, { userId }), userId)
      await db.as(
        'nabvy_app',
        (tx) => createTelegramLinkCode(tx, { userId, sessionId: 'session-1' }),
        userId,
      )
    }
    // Back-date U1 and U2's requests so the sweep finds them due; NOT_DUE stays in the future.
    await db.sql(
      `update account.deletion_requests set purge_by = now() - interval '1 hour'
                   where user_id in ($1, $2)`,
      [U1, U2],
    )

    const now = new Date()
    const first = await db.as('nabvy_pipeline', (tx) => purgeDueDeletions(tx, now))
    expect(first.events.map((e) => e.type)).toEqual(['account.deleted', 'account.deleted'])
    expect(new Set(first.events.map((e) => e.payload.userId))).toEqual(new Set([U1, U2]))

    const remaining = await db.sql(
      `select user_id from account.telegram_link_codes order by user_id`,
    )
    expect(remaining.map((r) => r.user_id)).toEqual([NOT_DUE])
    const remainingRequests = await db.sql(`select user_id from account.deletion_requests`)
    expect(remainingRequests.map((r) => r.user_id)).toEqual([NOT_DUE])

    // Idempotent: running again finds nothing left to purge for U1/U2.
    const second = await db.as('nabvy_pipeline', (tx) => purgeDueDeletions(tx, now))
    expect(second.events).toEqual([])
  })
})
