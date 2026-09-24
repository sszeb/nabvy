import { z } from 'zod'
import { defineEvents } from '../index'

// Contracts of the auth module (services/auth): roles and the errors its session helpers raise.
// Import from '@nabvy/contracts/modules/auth'. Samples in fixtures/contracts/auth/.

export const module = 'auth'

/** Roles set through Better Auth's admin plugin (docs/security.md, "Identity and access"). */
export const Role = z.enum(['user', 'admin'])
export type Role = z.infer<typeof Role>

/**
 * The only thing a restricted (suspended or banned) user is told, whatever the reason or length
 * (docs/decisions.md, "Fair use, suspension and bans"): no reason, rule, signal, score or date.
 */
export const ACCOUNT_RESTRICTED_MESSAGE = 'Your account has been restricted under our terms.'

/** Error codes the session helpers raise; the web app maps them to HTTP 401 and 403. */
export const AuthErrorCode = z.enum([
  'auth.unauthenticated',
  'auth.forbidden',
  'auth.account_restricted',
])
export type AuthErrorCode = z.infer<typeof AuthErrorCode>

/**
 * An auth error as it crosses to the browser. The restricted case carries exactly the vague
 * notice, so no caller can put a reason into it.
 */
export const AuthError = z.discriminatedUnion('code', [
  z.strictObject({ code: z.literal('auth.unauthenticated'), message: z.string().min(1) }),
  z.strictObject({ code: z.literal('auth.forbidden'), message: z.string().min(1) }),
  z.strictObject({
    code: z.literal('auth.account_restricted'),
    message: z.literal(ACCOUNT_RESTRICTED_MESSAGE),
  }),
])
export type AuthError = z.infer<typeof AuthError>

/** The auth module publishes no events yet. */
export const events = defineEvents(module, {})
