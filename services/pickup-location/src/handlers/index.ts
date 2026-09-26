// Event handlers. Each takes a batch, is idempotent (key listing + pass + evidence hash + rule
// version) and publishes only after its transaction commits (CLAUDE.md).
import { events as detailEvidenceEvents } from '@nabvy/contracts/modules/detail-evidence'
import { events as listingIngestEvents } from '@nabvy/contracts/modules/listing-ingest'
import type { Queryable } from '@nabvy/db'
import { defineHandler, type EventHandler } from '@nabvy/transport'
import { type RunDeps, run } from '../index'

export interface HandlerDeps extends RunDeps {
  /** Runs `fn` in one pipeline transaction: `withPipeline` in the task file. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
}

/**
 * `detail-evidence.changed` → the `detail` pass over those listings, in one transaction; the
 * `resolved` and `changed` events are published by the wrapper once it succeeds. The module is
 * outside the T-stamp chain: each resolution keeps its own `done_at` (rule 10).
 */
export function detailEvidenceChangedHandler(deps: HandlerDeps): EventHandler {
  return defineHandler({
    consumer: 'pickup-location',
    registry: detailEvidenceEvents,
    type: 'detail-evidence.changed',
    async handle(event, ctx) {
      const result = await deps.transaction((q) =>
        run(q, { pass: 'detail', listingIds: event.payload.listingIds }, deps),
      )
      if (!result.ok) return result
      ctx.emit(...result.value.events)
      return { ok: true, value: undefined }
    },
  })
}

/** `listing-ingest.first-seen` → the `card` pass (title and town label, no coordinates). */
export function listingIngestFirstSeenHandler(deps: HandlerDeps): EventHandler {
  return defineHandler({
    consumer: 'pickup-location',
    registry: listingIngestEvents,
    type: 'listing-ingest.first-seen',
    async handle(event, ctx) {
      const result = await deps.transaction((q) =>
        run(q, { pass: 'card', listingIds: event.payload.listingIds }, deps),
      )
      if (!result.ok) return result
      ctx.emit(...result.value.events)
      return { ok: true, value: undefined }
    },
  })
}
