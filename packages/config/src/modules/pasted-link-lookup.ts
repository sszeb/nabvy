import { z } from 'zod'

// Thresholds of the pasted-link-lookup module (rule 14 of docs/design/modules/_rules.md),
// validated with Zod like the env groups in ../env.ts. Every value is a starting value until the
// module's fixtures, or the owner's tier limits (docs/questions/pasted-link-lookup.md),
// calibrate it. No prices here.

const pastedLinkLookupConfig = z.object({
  dailyLimit: z.number().int().positive(),
  requestTtlDays: z.number().int().min(1).max(90),
  settleBatchSize: z.number().int().min(1).max(500),
  eventBatchSize: z.number().int().min(1).max(500),
})

const config = pastedLinkLookupConfig.parse({
  /**
   * Distinct listings one user may ask for in a rolling 24 hours, counted from the module's own
   * `requests` table on server time. Basis: each request may cost one paid detail fetch, and a
   * free account is bounded at £2 a day across every paid action (docs/security.md, "Abuse and
   * cost exploits"); the module card calls its per-user limit "a starting value". Whether the
   * limit differs per tier is the owner's (question in docs/questions/pasted-link-lookup.md).
   * Starting value.
   */
  dailyLimit: 20,
  /**
   * Days a queued request waits for its card before it is closed as failed. Basis: the details
   * queue defers work past its daily cap to the next day rather than dropping it
   * (`CONTAINER_LISTINGS.md:172-173`), so a request must outlive a few deferrals; a week bounds
   * how long a broken or removed listing is retried. Starting value.
   */
  requestTtlDays: 7,
  /** Queued requests one settle tick reads (rule 9: batches of 100-500). */
  settleBatchSize: 500,
  /** Request IDs per `pasted-link-lookup.ready` envelope (rule 7: at most 500). */
  eventBatchSize: 500,
})

export const PASTED_LINK_LOOKUP_DAILY_LIMIT = config.dailyLimit
export const PASTED_LINK_LOOKUP_REQUEST_TTL_DAYS = config.requestTtlDays
export const PASTED_LINK_LOOKUP_SETTLE_BATCH_SIZE = config.settleBatchSize
export const PASTED_LINK_LOOKUP_EVENT_BATCH_SIZE = config.eventBatchSize
