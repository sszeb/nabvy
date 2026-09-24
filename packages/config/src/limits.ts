/**
 * Rate limits (docs/engineering.md, "Rate limits and abuse"). Configuration, not secrets: the
 * values are the documented ones, enforced with Postgres-backed counters.
 */
export interface RateLimit {
  max: number
  windowSeconds: number
}

export const rateLimits = {
  /** Sign-up and sign-in requests (magic link, Google), per IP. */
  signUpPerIp: { max: 5, windowSeconds: 3600 },
  /** Magic-link emails, per address. */
  magicLinkPerEmail: { max: 5, windowSeconds: 3600 },
  scansPerUser: { max: 30, windowSeconds: 60 },
  huntWritesPerUser: { max: 20, windowSeconds: 60 },
  feedbackPerUser: { max: 60, windowSeconds: 60 },
  publicApiPerKey: { max: 600, windowSeconds: 60 },
} as const satisfies Record<string, RateLimit>
