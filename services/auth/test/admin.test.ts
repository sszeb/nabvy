import { AuditLogRefused } from '@nabvy/audit-log'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { liftRestriction, restrictAccount, revokeSessions, setRole } from '../src/admin'
import { ForbiddenError, UnknownAccountError } from '../src/domain'
import { createHarness, FOUNDER, type Harness, signInByMagicLink } from './support/harness'

// Every admin action writes exactly one audit_log row in the transaction that makes the change,
// on the nabvy_auth connection, and rolls back when the row cannot be written (docs/security.md;
// README.md, "Admin actions"). Real better_auth and audit_log migrations on PGlite.

let harness: Harness
let founderId: string

beforeAll(async () => {
  harness = await createHarness()
  await signInByMagicLink(harness, FOUNDER)
  founderId = await idOf(FOUNDER)
}, 60_000)

afterAll(async () => {
  await harness.close()
})

async function idOf(email: string): Promise<string> {
  const [row] = await harness.database.sql('select id from better_auth."user" where email = $1', [
    email,
  ])
  return row?.id as string
}

async function account(id: string) {
  const [row] = await harness.database.sql(
    `select role, banned, ban_reason, restriction_policy,
       (select count(*)::int from better_auth.session s where s.user_id = u.id) as sessions
     from better_auth."user" u where id = $1`,
    [id],
  )
  return row
}

async function auditRows(userId: string) {
  return harness.database.sql(
    'select actor_user_id, action, target, before, after, reason from audit_log.entries where target = $1 order by at, id',
    [`user:${userId}`],
  )
}

/** A signed-in account with the `user` role and one session. */
async function member(email: string): Promise<string> {
  await signInByMagicLink(harness, email)
  return idOf(email)
}

/** Makes every insert into audit_log.entries fail while `fn` runs. */
async function withAuditWritesFailing(fn: () => Promise<void>): Promise<void> {
  await harness.database.sql(`
    create function audit_log.test_refuse_insert() returns trigger language plpgsql as $$
    begin raise exception 'audit store unavailable'; end; $$`)
  await harness.database.sql(`
    create trigger test_refuse_insert before insert on audit_log.entries
      for each row execute function audit_log.test_refuse_insert()`)
  try {
    await fn()
  } finally {
    await harness.database.sql('drop trigger test_refuse_insert on audit_log.entries')
    await harness.database.sql('drop function audit_log.test_refuse_insert()')
  }
}

const actions = {
  'set a role': (userId: string) =>
    setRole({ actorUserId: founderId, userId, role: 'admin', reason: 'new staff' }, harness.auth),
  'restrict an account': (userId: string) =>
    restrictAccount(
      { actorUserId: founderId, userId, policy: 'fair-use', reason: 'internal evidence' },
      harness.auth,
    ),
  'lift a restriction': (userId: string) =>
    liftRestriction({ actorUserId: founderId, userId, reason: 'review upheld' }, harness.auth),
  'revoke sessions': (userId: string) =>
    revokeSessions({ actorUserId: founderId, userId }, harness.auth),
} as const

describe('each admin action writes exactly one audit row', () => {
  it('setRole records the role change', async () => {
    const id = await member('role.change@example.com')
    await actions['set a role'](id)
    expect((await account(id))?.role).toBe('admin')
    const rows = await auditRows(id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      actor_user_id: founderId,
      action: 'auth.role-changed',
      target: `user:${id}`,
      before: { role: 'user', banned: false },
      after: { role: 'admin', banned: false },
      reason: 'new staff',
    })
  })

  it('restrictAccount records the restriction, its policy and the reason, and revokes sessions', async () => {
    const id = await member('restrict.audit@example.com')
    const until = new Date('2030-01-01T00:00:00.000Z')
    await restrictAccount(
      {
        actorUserId: founderId,
        userId: id,
        policy: 'fair-use',
        until,
        reason: 'internal evidence',
      },
      harness.auth,
    )
    expect(await account(id)).toMatchObject({ banned: true, sessions: 0 })
    const rows = await auditRows(id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      action: 'auth.account-restricted',
      before: { banned: false, banExpires: null, restrictionPolicy: null },
      after: { banned: true, banExpires: until.toISOString(), restrictionPolicy: 'fair-use' },
      reason: 'internal evidence',
    })
  })

  it('liftRestriction records the lift', async () => {
    const id = await member('lift.audit@example.com')
    await actions['restrict an account'](id)
    await actions['lift a restriction'](id)
    expect(await account(id)).toMatchObject({ banned: false, ban_reason: null })
    const rows = await auditRows(id)
    expect(rows.map((row) => row.action)).toEqual([
      'auth.account-restricted',
      'auth.restriction-lifted',
    ])
    expect(rows[1]).toMatchObject({
      before: { banned: true, restrictionPolicy: 'fair-use' },
      after: { banned: false, restrictionPolicy: null },
    })
  })

  it('revokeSessions records the revoke', async () => {
    const id = await member('revoke.audit@example.com')
    await actions['revoke sessions'](id)
    expect((await account(id))?.sessions).toBe(0)
    const rows = await auditRows(id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ actor_user_id: founderId, action: 'auth.sessions-revoked' })
  })

  it('founder bootstrap records the promotion once, as the founder themselves', async () => {
    const email = 'audited.founder@example.com'
    const auth = harness.withAdminEmails([FOUNDER, email])
    const local = { ...harness, auth, routes: { GET: auth.handler, POST: auth.handler } }
    await signInByMagicLink(local, email)
    await signInByMagicLink(local, email)
    const id = await idOf(email)
    expect((await account(id))?.role).toBe('admin')
    const rows = await auditRows(id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      actor_user_id: id,
      action: 'auth.role-changed',
      before: { role: 'user' },
      after: { role: 'admin' },
      reason: 'Founder address in ADMIN_EMAILS',
    })
  })

  it('an unknown account changes nothing and records nothing', async () => {
    const unknown = '00000000-0000-4000-8000-000000000001'
    await expect(actions['set a role'](unknown)).rejects.toBeInstanceOf(UnknownAccountError)
    expect(await auditRows(unknown)).toHaveLength(0)
  })
})

describe('an action rolls back when its audit row cannot be written', () => {
  it.each(Object.keys(actions) as (keyof typeof actions)[])('%s', async (name) => {
    const id = await member(`rollback.${name.replaceAll(' ', '-')}@example.com`)
    if (name === 'lift a restriction') await actions['restrict an account'](id)
    const before = await account(id)
    const rowsBefore = (await auditRows(id)).length

    await withAuditWritesFailing(async () => {
      await expect(actions[name](id)).rejects.toBeInstanceOf(AuditLogRefused)
    })

    expect(await account(id)).toEqual(before)
    expect(await auditRows(id)).toHaveLength(rowsBefore)
  })

  it('founder bootstrap: no promotion, and no session, without its audit row', async () => {
    const email = 'unaudited.founder@example.com'
    const auth = harness.withAdminEmails([FOUNDER, email])
    const local = { ...harness, auth, routes: { GET: auth.handler, POST: auth.handler } }
    await withAuditWritesFailing(async () => {
      await expect(signInByMagicLink(local, email)).rejects.toThrow('sign-in failed')
    })
    const id = await idOf(email)
    expect(await account(id)).toMatchObject({ role: 'user', sessions: 0 })
    expect(await auditRows(id)).toHaveLength(0)
  })

  it('an actor that is not an account, or not an admin, is refused, and nothing changes', async () => {
    const id = await member('forged.actor@example.com')
    const plain = await member('plain.actor@example.com')
    for (const actorUserId of ['00000000-0000-4000-8000-000000000002', plain, id]) {
      await expect(
        setRole({ actorUserId, userId: id, role: 'admin' }, harness.auth),
      ).rejects.toBeInstanceOf(ForbiddenError)
      await expect(
        restrictAccount({ actorUserId, userId: plain, policy: 'terms', reason: 'x' }, harness.auth),
      ).rejects.toBeInstanceOf(ForbiddenError)
    }
    expect(await account(id)).toMatchObject({ role: 'user', banned: false })
    expect(await account(plain)).toMatchObject({ role: 'user', banned: false })
    expect(await auditRows(id)).toHaveLength(0)
    expect(await auditRows(plain)).toHaveLength(0)
  })
})
