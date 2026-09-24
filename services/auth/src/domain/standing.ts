/**
 * Account standing (docs/decisions.md, "Fair use, suspension and bans"). Better Auth's admin
 * plugin stores a restriction as `banned` plus an optional `banExpires`: with an expiry it is a
 * suspension until that time, without one a permanent ban. The account-integrity module sets
 * these fields; this module only reads them. Pure: the caller passes the clock.
 */
export interface BanFields {
  banned?: boolean | null
  banExpires?: Date | string | null
}

export function isRestricted(user: BanFields, now: Date): boolean {
  if (!user.banned) return false
  if (user.banExpires === null || user.banExpires === undefined) return true
  // A lapsed suspension no longer restricts, as in Better Auth's own sign-in check.
  return new Date(user.banExpires).getTime() > now.getTime()
}
