import { RestrictionPolicy } from '@nabvy/contracts/modules/auth'
import type { Auth } from './auth'

/**
 * Suspends (with `until`) or bans (without) an account, for the account-integrity module and
 * admin tools. Only this module's role can write `better_auth.user`, so every restriction goes
 * through here: it records the policy the notice will name, keeps the reason internal (never
 * returned by any API), and revokes every session at once.
 */
export async function restrictAccount(
  auth: Auth,
  input: { userId: string; policy: RestrictionPolicy; until?: Date | null; reason: string },
): Promise<void> {
  const context = await auth.$context
  await context.internalAdapter.updateUser(input.userId, {
    banned: true,
    banExpires: input.until ?? null,
    banReason: input.reason,
    restrictionPolicy: RestrictionPolicy.parse(input.policy),
  })
  await context.internalAdapter.deleteUserSessions(input.userId)
}

/** Lifts a restriction, e.g. after a review. */
export async function liftRestriction(auth: Auth, userId: string): Promise<void> {
  const context = await auth.$context
  await context.internalAdapter.updateUser(userId, {
    banned: false,
    banExpires: null,
    banReason: null,
    restrictionPolicy: null,
  })
}
