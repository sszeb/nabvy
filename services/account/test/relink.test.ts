import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { confirmTelegramLink, createTelegramLinkCode } from '../src'
import { createTestDatabase, type TestDatabase } from './support/database'

// The plan re-link cap (services/account/README.md, "Rules and thresholds"; review of PR #33,
// finding 3): counts completed confirmations in the 30-day window, never mere issuance, so an
// expired or mistyped code never locks a user out of their first link, and the short-window
// issuance limit (packages/config/src/modules/account.ts) is a separate, independent check.

const U1 = '00000000-0000-4000-8000-0000000000c1'

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
  await db.sql(
    `insert into better_auth."user" (id, name, email) values ($1, 'Test', 'test@example.com')`,
    [U1],
  )
  await db.sql(
    `insert into switches.switches (name, kind, state) values ('account', 'module', 'on')`,
  )
}, 60_000)

afterAll(() => db.close())

describe('the plan re-link cap (default: 1 completed link per 30 days)', () => {
  it('an expired first code does not use up the cap', async () => {
    const first = await db.as(
      'nabvy_app',
      (tx) => createTelegramLinkCode(tx, { userId: U1, sessionId: 'session-1' }),
      U1,
    )
    // Never confirmed: let it expire, exactly like a mistyped or abandoned code.
    await db.sql(
      `update account.telegram_link_codes set expires_at = now() - interval '1 minute' where user_id = $1`,
      [U1],
    )

    const second = await db.as(
      'nabvy_app',
      (tx) => createTelegramLinkCode(tx, { userId: U1, sessionId: 'session-1' }),
      U1,
    )
    expect(second.code).not.toBe(first.code)
  })

  it('a second link inside 30 days is refused', async () => {
    const { code } = await db.as(
      'nabvy_app',
      (tx) => createTelegramLinkCode(tx, { userId: U1, sessionId: 'session-1' }),
      U1,
    )
    await db.as('nabvy_pipeline', (tx) => confirmTelegramLink(tx, { code, chatId: 'chat-relink' }))

    await expect(
      db.as(
        'nabvy_app',
        (tx) => createTelegramLinkCode(tx, { userId: U1, sessionId: 'session-1' }),
        U1,
      ),
    ).rejects.toMatchObject({ code: 'account.relink_cap_exceeded' })
  })
})
