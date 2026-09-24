import { z } from 'zod'
import { defineEvents } from '../index'

// Contracts of the auth module (services/auth): roles and the errors its session helpers raise.
// Import from '@nabvy/contracts/modules/auth'. Samples in fixtures/contracts/auth/.

export const module = 'auth'

/** Roles set through Better Auth's admin plugin (docs/security.md, "Identity and access"). */
export const Role = z.enum(['user', 'admin'])
export type Role = z.infer<typeof Role>

/**
 * The policies a restriction can be taken under (docs/decisions.md, "Fair use, suspension and
 * bans"), and their names as the user sees them.
 */
export const RestrictionPolicy = z.enum(['terms', 'acceptable-use', 'fair-use'])
export type RestrictionPolicy = z.infer<typeof RestrictionPolicy>

export const POLICY_NAMES: Record<RestrictionPolicy, string> = {
  terms: 'Terms of Service',
  'acceptable-use': 'Acceptable Use Policy',
  'fair-use': 'Fair Use Policy',
}

/** A suspension has an end; a ban does not. No date is ever shown. */
export const RestrictionStep = z.enum(['suspended', 'banned'])
export type RestrictionStep = z.infer<typeof RestrictionStep>

/** A restricted user may ask for a review within this many days (docs/decisions.md). */
export const REVIEW_WINDOW_DAYS = 30

/**
 * The notice a restricted user receives: the step and the policy it was taken under, and
 * nothing more. No reason, rule, signal, score or date.
 */
export function accountRestrictedNotice(step: RestrictionStep, policy: RestrictionPolicy): string {
  return `Your account has been ${step} under our ${POLICY_NAMES[policy]}.`
}

/** The review route offered with the notice. */
export const ACCOUNT_REVIEW_OFFER = `You can ask for a review within ${REVIEW_WINDOW_DAYS} days.`

/** Error codes the session helpers raise; the web app maps them to HTTP 401 and 403. */
export const AuthErrorCode = z.enum([
  'auth.unauthenticated',
  'auth.forbidden',
  'auth.account_restricted',
])
export type AuthErrorCode = z.infer<typeof AuthErrorCode>

/**
 * An auth error as it crosses to the browser. The restricted case carries exactly the notice
 * built from its step and policy, and the review window, so no caller can put a reason into it.
 */
export const AuthError = z.discriminatedUnion('code', [
  z.strictObject({ code: z.literal('auth.unauthenticated'), message: z.string().min(1) }),
  z.strictObject({ code: z.literal('auth.forbidden'), message: z.string().min(1) }),
  z
    .strictObject({
      code: z.literal('auth.account_restricted'),
      message: z.string(),
      step: RestrictionStep,
      policy: RestrictionPolicy,
      reviewWithinDays: z.literal(REVIEW_WINDOW_DAYS),
    })
    .refine((error) => error.message === accountRestrictedNotice(error.step, error.policy), {
      message: 'the restricted message must be exactly the notice for its step and policy',
    }),
])
export type AuthError = z.infer<typeof AuthError>

/** The auth module publishes no events yet. */
export const events = defineEvents(module, {})
