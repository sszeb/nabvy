import { z } from 'zod'

// Thresholds of the waitlist module (rule 14 of docs/design/modules/_rules.md).

const rateLimit = z.object({
  max: z.number().int().positive(),
  windowSeconds: z.number().int().positive(),
})

const config = z.object({ submitPerIp: rateLimit }).parse({
  /**
   * Waitlist submissions per IP. Basis: no number is documented for this endpoint
   * (docs/engineering.md, "Rate limits and abuse" lists sign-up, magic-link, scan, hunt, feedback
   * and the public API only); this mirrors `rateLimits.signUpPerIp` from `@nabvy/config`, the
   * closest documented limit for an unauthenticated public endpoint. Status: starting value
   * (docs/questions.md, "waitlist: submission rate limit").
   */
  submitPerIp: { max: 5, windowSeconds: 3600 },
})

export const WAITLIST_SUBMIT_PER_IP = config.submitPerIp
