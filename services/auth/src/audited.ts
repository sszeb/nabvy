import { record } from '@nabvy/audit-log'
import { Uuid } from '@nabvy/contracts'
import type { Queryable } from '@nabvy/db'
import type { Auth, AuthDatabase } from './auth'
import { UnknownAccountError } from './domain'
import { type AccountState, lockAccount, updateAccount } from './repo/admin'

// The transaction every admin action runs in (admin.ts). Kept apart from admin.ts so that
// auth.ts can use it for founder bootstrap without importing the instance.

const databases = new WeakMap<object, AuthDatabase>()

/** Called by `createAuth`, so admin actions run on the same connection as the instance. */
export function registerAuthDatabase(auth: object, db: AuthDatabase): void {
  databases.set(auth, db)
}

export function databaseOf(auth: Auth): Queryable {
  const db = databases.get(auth)
  if (!db) throw new Error('auth instance was not made by createAuth')
  return db as unknown as Queryable
}

const target = (userId: string) => `user:${userId}`

/**
 * Locks the account, runs `change`, and records one audit row in the same transaction. `change`
 * returns the state after the action, or `null` when there was nothing to do (nothing is
 * recorded then; only founder bootstrap uses this). Throws `UnknownAccountError` (nothing written) for an
 * unknown account and `AuditLogRefused` (the change rolled back) if the row cannot be written.
 */
export async function audited(
  db: Queryable,
  input: { actorUserId: string; userId: string; action: string; reason?: string | undefined },
  change: (tx: Queryable, before: AccountState) => Promise<AccountState | null>,
): Promise<void> {
  const actorUserId = Uuid.parse(input.actorUserId)
  const userId = Uuid.parse(input.userId)
  await db.transaction(async (tx) => {
    const before = await lockAccount(tx, userId)
    if (!before) throw new UnknownAccountError(userId)
    const after = await change(tx, before)
    if (!after) return
    await record(tx, {
      actorUserId,
      action: input.action,
      target: target(userId),
      before: state(before),
      after: state(after),
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    })
  })
}

/** The audit row's JSON form of an account state. */
function state(account: AccountState) {
  return { ...account, banExpires: account.banExpires?.toISOString() ?? null }
}

/**
 * Founder bootstrap (ADMIN_EMAILS): gives the account the admin role, recorded as a role change
 * by the founder themselves. Does nothing, and records nothing, if it already has the role.
 */
export async function promoteFounder(db: AuthDatabase, userId: string): Promise<void> {
  await audited(
    db as unknown as Queryable,
    {
      actorUserId: userId,
      userId,
      action: 'auth.role-changed',
      reason: 'Founder address in ADMIN_EMAILS',
    },
    async (tx, before) => {
      if (before.role === 'admin') return null
      await updateAccount(tx, userId, { role: 'admin' })
      return { ...before, role: 'admin' }
    },
  )
}
