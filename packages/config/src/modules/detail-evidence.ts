import { z } from 'zod'

// Thresholds of the detail-evidence module (rule 14 of docs/design/modules/_rules.md), validated
// with Zod like the env groups in ../env.ts.

const detailEvidenceConfig = z.object({
  eventBatchSize: z.number().int().min(1).max(500),
  linkLifetimeHours: z.number().int().min(1).max(168),
})

const config = detailEvidenceConfig.parse({
  /**
   * Listing IDs per `changed` or `unresolved` event. Basis: rule 7 (at most 500 listing IDs per
   * event) and CLAUDE.md, "Batches, not items". Status: fixed by the rule.
   */
  eventBatchSize: 500,
  /**
   * Hours after collection that gallery links are assumed to work when no link carries its own
   * `oe` expiry. Basis: links expire 104–108 hours after collection
   * (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:288-289, via docs/fb-actor-reference.md); the low
   * end, so a link is never trusted past its life. Status: starting value.
   */
  linkLifetimeHours: 104,
})

export const DETAIL_EVIDENCE_EVENT_BATCH_SIZE = config.eventBatchSize
export const DETAIL_EVIDENCE_LINK_LIFETIME_HOURS = config.linkLifetimeHours
