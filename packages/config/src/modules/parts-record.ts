import { z } from 'zod'

// Thresholds of the parts-record module (rule 14 of docs/design/modules/_rules.md), validated
// with Zod like the env groups in ../env.ts. No prices here: the record prices nothing.

const partsRecordConfig = z.object({
  eventBatchSize: z.int().min(1).max(500),
})

const config = partsRecordConfig.parse({
  /**
   * Listing IDs per handled batch and per `parts-record.recorded` event. Basis: rule 7 (at most
   * 500 listing IDs per event) and CLAUDE.md, "Batches, not items". Status: fixed by the rule.
   */
  eventBatchSize: 500,
})

export const PARTS_RECORD_EVENT_BATCH_SIZE = config.eventBatchSize
