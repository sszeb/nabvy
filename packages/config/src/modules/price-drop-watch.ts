import { z } from 'zod'

// Thresholds of the price-drop-watch module (rule 14 of docs/design/modules/_rules.md), validated
// with Zod like the env groups in ../env.ts. Every value is a starting value until recorded runs
// calibrate it.

const priceDropWatchConfig = z.object({
  batchSize: z.number().int().min(1).max(500),
})

const config = priceDropWatchConfig.parse({
  /**
   * Listing IDs per handler batch, recheck submission and `dropped` event. Basis: rule 7 (at most
   * 500 listing IDs per event) and CLAUDE.md, "Batches, not items". Fixed by the rule.
   */
  batchSize: 500,
})

export const PRICE_DROP_WATCH_BATCH_SIZE = config.batchSize
