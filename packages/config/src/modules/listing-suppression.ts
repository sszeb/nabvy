import { z } from 'zod'

// Thresholds of the listing-suppression module (rule 14 of docs/design/modules/_rules.md),
// validated with Zod like the env groups in ../env.ts.

const listingSuppressionConfig = z.object({
  lookalikeDays: z.number().int().min(1).max(365),
  addBatchSize: z.number().int().min(1).max(500),
  eventBatchSize: z.number().int().min(1).max(500),
})

const config = listingSuppressionConfig.parse({
  /**
   * Days a look-alike entry (description, or title with price and city page) hides matching
   * listings. Basis: "we also hide, for 90 days, listings that match the named ones"
   * (fb-scrap-engine/docs/design/SELLER_DATA.md:135-138). Status: the brief's value.
   */
  lookalikeDays: 90,
  /**
   * Named listings and seller keys per `add` call. Basis: CLAUDE.md, "Batches, not items"
   * (100–500). Status: fixed by the rule.
   */
  addBatchSize: 500,
  /**
   * Entry IDs per `changed` event. Basis: rule 7 (at most 500 IDs per event). Status: fixed by the
   * rule.
   */
  eventBatchSize: 500,
})

export const LISTING_SUPPRESSION_LOOKALIKE_DAYS = config.lookalikeDays
export const LISTING_SUPPRESSION_ADD_BATCH_SIZE = config.addBatchSize
export const LISTING_SUPPRESSION_EVENT_BATCH_SIZE = config.eventBatchSize
