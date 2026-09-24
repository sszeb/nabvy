import {
  type AuthDatabase,
  createAuth,
  createRecordingMagicLinkSender,
  ForbiddenError,
  liftRestriction,
  restrictAccount,
} from '@nabvy/auth'
import type { Queryable } from '@nabvy/db'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setStandingWith } from '../src/standing'
import { createTestDatabase, type TestDatabase } from './support/database'

// setStandingWith through the REAL @nabvy/auth restrictAccount/liftRestriction (never a fake),
// proving the admin-role check inside auth's own audited() actually refuses a non-admin actor —
// the check the old public setStanding() let a caller skip by injecting replacement functions
// (review of PR #33, finding 2). `createAuth` registers `tx` as the auth database, wrapped so the
// nested transaction audited() opens runs as `nabvy_auth` (the only role better_auth.user grants
// write access to) and switches back to `nabvy_pipeline` after, all on the SAME PGlite connection:
// no second connection is opened, avoiding the deadlock idempotency.test.ts documents.

const U1 = '00000000-0000-4000-8000-0000000000c1'
const NONADMIN = '00000000-0000-4000-8000-0000000000c9'

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
  await db.sql(
    `insert into better_auth."user" (id, name, email) values
       ($1, 'Target', 'target@example.com'),
       ($2, 'Not An Admin', 'nonadmin@example.com')`,
    [U1, NONADMIN],
  )
  await db.sql(
    `insert into switches.switches (name, kind, state) values ('account', 'module', 'on')`,
  )
}, 60_000)

afterAll(() => db.close())

function roleSwitchedForAuth(tx: Queryable): Queryable {
  return new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop === 'transaction') {
        return (cb: (t: Queryable) => Promise<unknown>) =>
          (
            target as unknown as {
              transaction: (fn: (t: Queryable) => Promise<unknown>) => Promise<unknown>
            }
          ).transaction(async (savepointTx) => {
            const inner = savepointTx as Queryable
            await inner.execute(sql`set local role nabvy_auth`)
            try {
              return await cb(inner)
            } finally {
              await inner.execute(sql`set local role nabvy_pipeline`)
            }
          })
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as Queryable
}

function realAuthOn(tx: Queryable) {
  const auth = createAuth({
    db: roleSwitchedForAuth(tx) as unknown as AuthDatabase,
    baseURL: 'http://localhost:3000',
    secret: 'test-only-secret-that-is-at-least-32-characters-long',
    adminEmails: [],
    magicLinkSender: createRecordingMagicLinkSender(),
    turnstile: { secretKey: 'test-only-turnstile-secret' },
    quiet: true,
  })
  return {
    restrictAccount: (input: Parameters<typeof restrictAccount>[0]) => restrictAccount(input, auth),
    liftRestriction: (input: Parameters<typeof liftRestriction>[0]) => liftRestriction(input, auth),
  }
}

describe('setStandingWith through the real auth functions', () => {
  it('refuses a non-admin actor and writes nothing', async () => {
    const input = {
      actorUserId: NONADMIN,
      userId: U1,
      status: 'suspended' as const,
      policy: 'fair-use' as const,
      until: new Date(Date.now() + 60_000).toISOString(),
      reason: 'attempted self-service restriction',
    }

    await expect(
      db.as('nabvy_pipeline', (tx) => setStandingWith(tx, input, realAuthOn(tx))),
    ).rejects.toBeInstanceOf(ForbiddenError)

    const standingRows = await db.sql(
      `select count(*)::int as n from account.standing where user_id = $1`,
      [U1],
    )
    expect(standingRows[0]?.n).toBe(0)

    const userRow = await db.sql(`select banned from better_auth."user" where id = $1`, [U1])
    expect(userRow[0]?.banned).toBe(false)

    const auditRows = await db.sql(
      `select count(*)::int as n from audit_log.entries where action = 'account.standing-changed'`,
    )
    expect(auditRows[0]?.n).toBe(0)
  })
})
