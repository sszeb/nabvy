import type { Queryable } from '@nabvy/db'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { confirmTelegramLink, createTelegramLinkCode, isActive } from '../src'
import { AccountRefused } from '../src/domain'
import { setStandingWith } from '../src/standing'
import { createTestDatabase, type TestDatabase } from './support/database'

const U1 = '00000000-0000-4000-8000-0000000000c1'
const ADMIN = '00000000-0000-4000-8000-0000000000a1'

let db: TestDatabase

/**
 * A fake for @nabvy/auth's admin functions that writes the same `better_auth.user` columns
 * `restrictAccount`/`liftRestriction` do, so `isActive()` (a direct read of that table) proves the
 * round trip without this suite standing up a full Better Auth instance
 * (test/support/database.ts). Runs on the same transaction `tx` as the rest of the call, briefly
 * switching to the migration role (which is how the real `nabvy_auth` connection differs from the
 * caller's) and switching back, rather than opening a second connection: PGlite serves one
 * connection, and a second one opened while this transaction is still open would deadlock.
 */
function fakeAuthOn(tx: Queryable) {
  return {
    restrictAccount: async (input: {
      userId: string
      policy: string
      until?: Date | null
      reason: string
    }) => {
      await tx.execute(sql`set local role postgres`)
      await tx.execute(
        sql`update better_auth."user" set banned = true, ban_expires = ${input.until ?? null}, restriction_policy = ${input.policy} where id = ${input.userId}::uuid`,
      )
      await tx.execute(sql`set local role nabvy_pipeline`)
    },
    liftRestriction: async (input: { userId: string }) => {
      await tx.execute(sql`set local role postgres`)
      await tx.execute(
        sql`update better_auth."user" set banned = false, ban_expires = null, restriction_policy = null where id = ${input.userId}::uuid`,
      )
      await tx.execute(sql`set local role nabvy_pipeline`)
    },
  }
}

beforeAll(async () => {
  db = await createTestDatabase()
  await db.sql(
    `insert into switches.switches (name, kind, state) values ('account', 'module', 'on')`,
  )
}, 60_000)

afterAll(() => db.close())

beforeEach(async () => {
  await db.sql(
    `insert into better_auth."user" (id, name, email) values ($1, 'Test', 'test@example.com')
     on conflict (id) do nothing`,
    [U1],
  )
})

describe('setStanding twice', () => {
  it('leaves the same standing and the same Better Auth state', async () => {
    const input = {
      actorUserId: ADMIN,
      userId: U1,
      status: 'suspended' as const,
      policy: 'fair-use' as const,
      until: '2026-10-24T00:00:00.000Z',
      reason: 'observed abuse',
    }
    const run = () => db.as('nabvy_pipeline', (tx) => setStandingWith(tx, input, fakeAuthOn(tx)))
    const first = await run()
    const second = await run()
    // actionId and at legitimately advance each call (audit_log is append-only, so each call adds
    // its own row); the final state the row and Better Auth carry is what stays the same.
    const stable = ({ userId, status, until, limits }: typeof first.standing) => ({
      userId,
      status,
      until,
      limits,
    })
    expect(stable(first.standing)).toEqual(stable(second.standing))
    expect(await db.as('nabvy_app', (tx) => isActive(tx, U1))).toBe(false)
  })
})

describe('confirmTelegramLink twice', () => {
  it('refuses the second call instead of linking or crashing ambiguously', async () => {
    const { code } = await db.as(
      'nabvy_app',
      (tx) => createTelegramLinkCode(tx, { userId: U1, sessionId: 'session-1' }),
      U1,
    )
    const first = await db.as('nabvy_pipeline', (tx) =>
      confirmTelegramLink(tx, { code, chatId: 'chat-1' }),
    )
    expect(first.event.type).toBe('account.channel-linked')

    await expect(
      db.as('nabvy_pipeline', (tx) => confirmTelegramLink(tx, { code, chatId: 'chat-1' })),
    ).rejects.toThrow(AccountRefused)

    const rows = await db.sql(
      `select count(*)::int as n from account.telegram_links where user_id = $1`,
      [U1],
    )
    expect(rows[0]?.n).toBe(1)
  })
})

describe('suspension until a date (services/account/README.md, "Standing")', () => {
  it('refuses while suspended and allows again once until has passed', async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    await db.as('nabvy_pipeline', (tx) =>
      setStandingWith(
        tx,
        {
          actorUserId: ADMIN,
          userId: U1,
          status: 'suspended',
          policy: 'fair-use',
          until: future,
          reason: 'observed abuse',
        },
        fakeAuthOn(tx),
      ),
    )
    expect(await db.as('nabvy_app', (tx) => isActive(tx, U1))).toBe(false)

    await db.sql(
      `update better_auth."user" set ban_expires = now() - interval '1 minute' where id = $1`,
      [U1],
    )
    expect(await db.as('nabvy_app', (tx) => isActive(tx, U1))).toBe(true)
  })
})
