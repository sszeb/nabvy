// Event handlers. Each takes a batch (1–500 listing IDs), is idempotent (the status row's content
// hash; a replay writes nothing and re-reads the same changed IDs) and publishes only after its
// transaction commits (CLAUDE.md).
import { events as detailEvidenceEvents } from '@nabvy/contracts/modules/detail-evidence'
import { events as listingIngestEvents } from '@nabvy/contracts/modules/listing-ingest'
import type { Queryable } from '@nabvy/db'
import { defineHandler, type EventHandler } from '@nabvy/transport'
import { applyEvent } from '../index'

export interface HandlerDeps {
  /** Runs `fn` in one pipeline transaction: `withPipeline` in the task file. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
}

/**
 * `listing-ingest.card-changed` → the status pass for its listings, keyed on the event's key; the
 * `status-changed` events are published by the wrapper once it succeeds. Listings listing-ingest
 * does not show fail the delivery, which is retried, then dead-lettered. The module is outside the
 * T-stamp chain: each status keeps the time of its evidence (`observed_at`) and its own write time
 * (`changed_at`) (rule 10).
 */
export function cardChangedHandler(deps: HandlerDeps): EventHandler {
  return defineHandler({
    consumer: 'listing-lifecycle',
    registry: listingIngestEvents,
    type: 'listing-ingest.card-changed',
    async handle(event, ctx) {
      const result = await deps.transaction((q) =>
        applyEvent(q, { listingIds: event.payload.listingIds, key: ctx.key }),
      )
      if (!result.ok) return result
      ctx.emit(...result.value.events)
      return { ok: true, value: undefined }
    },
  })
}

/**
 * `detail-evidence.unresolved` → the status pass for its listings: a fetch that could not identify
 * the item makes the listing `unresolved`, never sold.
 */
export function unresolvedHandler(deps: HandlerDeps): EventHandler {
  return defineHandler({
    consumer: 'listing-lifecycle',
    registry: detailEvidenceEvents,
    type: 'detail-evidence.unresolved',
    async handle(event, ctx) {
      const result = await deps.transaction((q) =>
        applyEvent(q, { listingIds: event.payload.listingIds, key: ctx.key }),
      )
      if (!result.ok) return result
      ctx.emit(...result.value.events)
      return { ok: true, value: undefined }
    },
  })
}
