import { z } from 'zod'

// Thresholds of the run-coverage module (rule 14 of docs/design/modules/_rules.md), validated
// with Zod like the env groups in ../env.ts. Figures from the actor's analysis come from about two
// days of mostly "3090" and "gaming pc" searches around Chichester.

const runCoverageConfig = z.object({
  shortFeedMaxPages: z.number().int().min(1),
  shortFeedMinListings: z.number().int().min(1),
  pageOneRanks: z.number().int().min(1),
  eventBatchSize: z.number().int().min(1).max(500),
})

const config = runCoverageConfig.parse({
  /**
   * A complete default-order read that ends at this many pages or fewer is a short feed. Basis:
   * short feeds hold about 90 listings over 4 pages, long ones 750–1,330 over 32–56
   * (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:112,131-134 as cited by the card; README.md:125-128).
   * Status: starting value.
   */
  shortFeedMaxPages: 6,
  /** Or with fewer listings than this. Same basis. Status: starting value. */
  shortFeedMinListings: 150,
  /**
   * Sightings ranked this high or better count as page 1 for the gap check. Basis: about 90
   * listings over 4 pages is about 23 per page; the recorded run read 20 on its one page
   * (run-summary.json:9-14). Status: starting value.
   */
  pageOneRanks: 24,
  /** Search IDs per `search-degraded` event. Basis: rule 7 (at most 500 IDs). Status: fixed. */
  eventBatchSize: 500,
})

export const RUN_COVERAGE_SHORT_FEED_MAX_PAGES = config.shortFeedMaxPages
export const RUN_COVERAGE_SHORT_FEED_MIN_LISTINGS = config.shortFeedMinListings
export const RUN_COVERAGE_PAGE_ONE_RANKS = config.pageOneRanks
export const RUN_COVERAGE_EVENT_BATCH_SIZE = config.eventBatchSize
