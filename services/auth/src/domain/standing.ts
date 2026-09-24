import type { RestrictionPolicy, RestrictionStep } from '@nabvy/contracts/modules/auth'

/**
 * Account standing (docs/decisions.md, "Fair use, suspension and bans"). Better Auth's admin
 * plugin stores a restriction as `banned` plus an optional `banExpires`: with an expiry it is a
 * suspension until that time, without one a permanent ban. `restrictionPolicy` records the policy
 * it was taken under. Pure: the caller passes the clock.
 */
export interface BanFields {
  banned?: boolean | null
  banExpires?: Date | string | null
  restrictionPolicy?: string | null
}

export interface Restriction {
  step: RestrictionStep
  policy: RestrictionPolicy
}

const POLICIES: readonly string[] = ['terms', 'acceptable-use', 'fair-use']

export function isRestricted(user: BanFields, now: Date): boolean {
  if (!user.banned) return false
  if (user.banExpires === null || user.banExpires === undefined) return true
  // A lapsed suspension no longer restricts, as in Better Auth's own sign-in check.
  return new Date(user.banExpires).getTime() > now.getTime()
}

/**
 * The step and policy to name in the notice, or null when the account is not restricted. A
 * restriction set without a policy (for example through Better Auth's admin API) names the Terms
 * of Service, which every other policy is part of.
 */
export function restrictionOf(user: BanFields, now: Date): Restriction | null {
  if (!isRestricted(user, now)) return null
  const policy = POLICIES.includes(user.restrictionPolicy ?? '')
    ? (user.restrictionPolicy as RestrictionPolicy)
    : 'terms'
  return { step: user.banExpires ? 'suspended' : 'banned', policy }
}
