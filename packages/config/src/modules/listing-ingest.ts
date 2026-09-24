import { z } from 'zod'

// Thresholds of the listing-ingest module (rule 14 of docs/design/modules/_rules.md), validated
// with Zod like the env groups in ../env.ts.

const listingIngestConfig = z.object({
  jobBatchSize: z.number().int().min(1).max(50),
  eventBatchSize: z.number().int().min(1).max(500),
})

const config = listingIngestConfig.parse({
  /**
   * Collected jobs one `ingest` call reads. Basis: a search run returns up to a few hundred cards
   * and a details run at most about 200 (actor-integration.md 2.3), so ten jobs stay inside a
   * batch of a few thousand rows. Status: starting value; the handler passes one job per event.
   */
  jobBatchSize: 10,
  /**
   * Listing IDs per `first-seen` or `card-changed` event. Basis: rule 7 (at most 500 listing IDs
   * per event) and CLAUDE.md, "Batches, not items". Status: fixed by the rule.
   */
  eventBatchSize: 500,
})

export const LISTING_INGEST_JOB_BATCH_SIZE = config.jobBatchSize
export const LISTING_INGEST_EVENT_BATCH_SIZE = config.eventBatchSize
