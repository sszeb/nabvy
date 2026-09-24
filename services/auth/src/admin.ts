import { RestrictionPolicy, Role } from '@nabvy/contracts/modules/auth'
import { audited, databaseOf } from './audited'
import type { Auth } from './auth'
import { getAuth } from './instance'
import { deleteSessions, updateAccount } from './repo/admin'

// Admin actions (docs/security.md: "every role change and admin action writes audit_log"). Each
// one runs in a single transaction on the auth connection (nabvy_auth, the only role that can
// write better_auth): lock the account, change it, and call audit-log's record() with the same
// transaction. If the audit row cannot be written, record() throws AuditLogRefused and the change
// rolls back with it. Better Auth's own admin endpoints that change anything stay refused
// (auth.ts, `roles`), so these functions are the only way to take an admin action.
//
// The caller has already checked that `actorUserId` may act: `requireAdmin` in an admin
// procedure, or the account-integrity module's own rules. The actor must be an existing account
// (the insert policy on audit_log.entries for nabvy_auth checks it).

/** Gives an account the `user` or `admin` role. Records `auth.role-changed`. */
export async function setRole(
  input: { actorUserId: string; userId: string; role: Role; reason?: string },
  auth: Auth = getAuth(),
): Promise<void> {
  const role = Role.parse(input.role)
  await audited(databaseOf(auth), { ...input, action: 'auth.role-changed' }, async (tx, before) => {
    await updateAccount(tx, input.userId, { role })
    return { ...before, role }
  })
}

/**
 * Suspends (with `until`) or bans (without) an account, for the account-integrity module and
 * admin tools: records the policy the notice will name, keeps the reason internal (never returned
 * by any API; it is the audit row's reason), and revokes every session at once. Records
 * `auth.account-restricted`.
 */
export async function restrictAccount(
  input: {
    actorUserId: string
    userId: string
    policy: RestrictionPolicy
    until?: Date | null
    reason: string
  },
  auth: Auth = getAuth(),
): Promise<void> {
  const restriction = {
    banned: true,
    banExpires: input.until ?? null,
    restrictionPolicy: RestrictionPolicy.parse(input.policy),
  }
  await audited(
    databaseOf(auth),
    { ...input, action: 'auth.account-restricted' },
    async (tx, before) => {
      await updateAccount(tx, input.userId, { ...restriction, banReason: input.reason })
      await deleteSessions(tx, input.userId)
      return { ...before, ...restriction }
    },
  )
}

/** Lifts a restriction, e.g. after a review. Records `auth.restriction-lifted`. */
export async function liftRestriction(
  input: { actorUserId: string; userId: string; reason?: string },
  auth: Auth = getAuth(),
): Promise<void> {
  const lifted = { banned: false, banExpires: null, restrictionPolicy: null }
  await audited(
    databaseOf(auth),
    { ...input, action: 'auth.restriction-lifted' },
    async (tx, before) => {
      await updateAccount(tx, input.userId, { ...lifted, banReason: null })
      return { ...before, ...lifted }
    },
  )
}

/** Signs an account out everywhere. Records `auth.sessions-revoked`. */
export async function revokeSessions(
  input: { actorUserId: string; userId: string; reason?: string },
  auth: Auth = getAuth(),
): Promise<void> {
  await audited(
    databaseOf(auth),
    { ...input, action: 'auth.sessions-revoked' },
    async (tx, before) => {
      await deleteSessions(tx, input.userId)
      return before
    },
  )
}
