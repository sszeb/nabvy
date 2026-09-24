import type { Queryable } from '@nabvy/db'
import { session, user } from '@nabvy/db/schema/better-auth'
import { eq } from 'drizzle-orm'

/** The fields an admin action may change, as the audit row's before and after record them. */
export interface AccountState {
  role: string | null
  banned: boolean
  banExpires: Date | null
  restrictionPolicy: string | null
}

/**
 * Locks one account row for the rest of the transaction and returns its state, or `null` for an
 * unknown user. The ban reason is left out: it goes to the audit row's `reason`, not its states.
 */
export async function lockAccount(q: Queryable, userId: string): Promise<AccountState | null> {
  const [row] = await q
    .select({
      role: user.role,
      banned: user.banned,
      banExpires: user.banExpires,
      restrictionPolicy: user.restrictionPolicy,
    })
    .from(user)
    .where(eq(user.id, userId))
    .for('update')
  return row ? { ...row, banned: row.banned === true } : null
}

export async function updateAccount(
  q: Queryable,
  userId: string,
  fields: Partial<AccountState> & { banReason?: string | null },
): Promise<void> {
  await q
    .update(user)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(user.id, userId))
}

/** Deletes every session of one account, so its cookies stop working; returns how many. */
export async function deleteSessions(q: Queryable, userId: string): Promise<number> {
  const deleted = await q
    .delete(session)
    .where(eq(session.userId, userId))
    .returning({ id: session.id })
  return deleted.length
}
