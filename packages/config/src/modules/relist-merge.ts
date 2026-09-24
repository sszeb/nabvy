import { z } from 'zod'

// Thresholds of the relist-merge module (rule 14 of docs/design/modules/_rules.md), validated
// with Zod like the env groups in ../env.ts.

const relistMergeConfig = z.object({
  windowDays: z.number().int().min(1).max(90),
  minDescriptionChars: z.number().int().min(1).max(2000),
  eventBatchSize: z.number().int().min(1).max(500),
})

const config = relistMergeConfig.parse({
  /**
   * Largest gap, in days, between one listing's last sighting and the other's first (listed time,
   * else first fetch) for a description or photo match to merge them; overlapping listings have a
   * gap of 0. Basis: "within the same city page and 7 days"
   * (fb-scrap-engine/docs/design/SELLER_DATA.md:148-149; the card: "7 days is the brief's value").
   * Status: starting value; only 3 relist pairs were visible in 37 hours (SELLER_DATA.md:66-67).
   */
  windowDays: 7,
  /**
   * Shortest description (characters, whitespace collapsed and trimmed) that may merge on its own.
   * Basis: this module, conservatively: a short stock line ("Collection only", "Works fine") is
   * shared by different items in one town, and a missed merge costs one extra alert while a false
   * one hides an item (the card's "When off"). Status: starting value
   * (docs/questions/relist-merge.md).
   */
  minDescriptionChars: 40,
  /**
   * Listing IDs per `merged` event. Basis: rule 7 (at most 500 listing IDs per event) and
   * CLAUDE.md, "Batches, not items". Status: fixed by the rule.
   */
  eventBatchSize: 500,
})

export const RELIST_MERGE_WINDOW_DAYS = config.windowDays
export const RELIST_MERGE_MIN_DESCRIPTION_CHARS = config.minDescriptionChars
export const RELIST_MERGE_EVENT_BATCH_SIZE = config.eventBatchSize
