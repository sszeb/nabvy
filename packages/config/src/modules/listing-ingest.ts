import { z } from 'zod'

// Thresholds of the listing-ingest module (rule 14 of docs/design/modules/_rules.md), validated
// with Zod like the env groups in ../env.ts.

const listingIngestConfig = z.object({
  eventBatchSize: z.number().int().min(1).max(500),
})

const config = listingIngestConfig.parse({
  /**
   * Listing IDs per `first-seen` or `card-changed` event. Basis: rule 7 (at most 500 listing IDs
   * per event) and CLAUDE.md, "Batches, not items". Status: fixed by the rule.
   */
  eventBatchSize: 500,
})

export const LISTING_INGEST_EVENT_BATCH_SIZE = config.eventBatchSize
