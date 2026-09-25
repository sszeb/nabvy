// Event handlers. Each takes a batch, is idempotent (key listing + evidence hash + rule version)
// and publishes only after its transaction commits (CLAUDE.md).
import { events as detailEvidenceEvents } from '@nabvy/contracts/modules/detail-evidence'
import type { Queryable } from '@nabvy/db'
import { defineHandler, type EventHandler } from '@nabvy/transport'
import { run } from '../index'

export interface DetailEvidenceChangedDeps {
  /** Runs `fn` in one pipeline transaction: `withPipeline` in the task file. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
}

/**
 * `detail-evidence.changed` → `run` over those listings, in one transaction; the `ran` event is
 * published by the wrapper once it succeeds. The module is outside the T-stamp chain: each run
 * keeps its own `done_at` (rule 10).
 */
export function detailEvidenceChangedHandler(deps: DetailEvidenceChangedDeps): EventHandler {
  return defineHandler({
    consumer: 'parts-rules',
    registry: detailEvidenceEvents,
    type: 'detail-evidence.changed',
    async handle(event, ctx) {
      const result = await deps.transaction((q) => run(q, { listingIds: event.payload.listingIds }))
      if (!result.ok) return result
      ctx.emit(...result.value.events)
      return { ok: true, value: undefined }
    },
  })
}
