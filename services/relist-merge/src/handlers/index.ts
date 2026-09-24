// Event handlers. Each takes a batch of listing IDs, is idempotent (a listing joins at most one
// group, and event keys come from the stored groups: rule 8's "relist group ID and member-set
// hash") and publishes only after its transaction commits (CLAUDE.md).
import { events as detailEvidenceEvents } from '@nabvy/contracts/modules/detail-evidence'
import { events as listingIngestEvents } from '@nabvy/contracts/modules/listing-ingest'
import type { Queryable } from '@nabvy/db'
import { defineHandler, type EventHandler } from '@nabvy/transport'
import { type MergeEvidence, merge } from '../index'

export interface MergeDeps {
  /** Runs `fn` in one pipeline transaction: `withPipeline` in the task file. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
  /** Optional photo and seller-key evidence; defaults to none (soft edges). */
  evidence?: MergeEvidence
}

/**
 * `listing-ingest.first-seen` → `merge` for those listings. A new listing usually has no detail
 * version yet, so it merges only once `detail-evidence.changed` brings its description; this
 * delivery still catches listings whose details were fetched first (pasted links). The module is
 * outside the T-stamp chain: each membership keeps the listing's T1 (`input_fetched_at`) and its
 * own `merged_at` (rule 10).
 */
export function firstSeenHandler(deps: MergeDeps): EventHandler {
  return defineHandler({
    consumer: 'relist-merge',
    registry: listingIngestEvents,
    type: 'listing-ingest.first-seen',
    async handle(event, ctx) {
      const result = await deps.transaction((q) =>
        merge(q, { listingIds: event.payload.listingIds }, deps.evidence),
      )
      if (!result.ok) return result
      ctx.emit(...result.value.events)
      return { ok: true, value: undefined }
    },
  })
}

/** `detail-evidence.changed` → `merge` for those listings: their current description changed. */
export function detailChangedHandler(deps: MergeDeps): EventHandler {
  return defineHandler({
    consumer: 'relist-merge',
    registry: detailEvidenceEvents,
    type: 'detail-evidence.changed',
    async handle(event, ctx) {
      const result = await deps.transaction((q) =>
        merge(q, { listingIds: event.payload.listingIds }, deps.evidence),
      )
      if (!result.ok) return result
      ctx.emit(...result.value.events)
      return { ok: true, value: undefined }
    },
  })
}
