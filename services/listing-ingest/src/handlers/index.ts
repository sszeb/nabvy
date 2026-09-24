// Event handlers. Each takes a batch, is idempotent (key source + sourceListingId + contentHash,
// here the card hash) and publishes only after its transaction commits (CLAUDE.md).
import { events as apifyGatewayEvents } from '@nabvy/contracts/modules/apify-gateway'
import type { Queryable } from '@nabvy/db'
import { defineHandler, type EventHandler } from '@nabvy/transport'
import { ingest } from '../index'

export interface RunCollectedDeps {
  /** Runs `fn` in one pipeline transaction: `withPipeline` in the task file. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
}

/**
 * `apify-gateway.run-collected` → `ingest` for that job, in one transaction; the `first-seen` and
 * `card-changed` events are published by the wrapper once it succeeds. A job the gateway does not
 * show (not collected, or the gateway off) fails and is retried, then dead-lettered, so no run is
 * dropped silently. T0 and T1 are columns of `listings` (rule 10), not envelope stamps.
 */
export function runCollectedHandler(deps: RunCollectedDeps): EventHandler {
  return defineHandler({
    consumer: 'listing-ingest',
    registry: apifyGatewayEvents,
    type: 'apify-gateway.run-collected',
    async handle(event, ctx) {
      const result = await deps.transaction((q) =>
        ingest(q, { jobId: event.payload.jobId, kind: event.payload.kind }),
      )
      if (!result.ok) return result
      ctx.emit(...result.value.events)
      return { ok: true, value: undefined }
    },
  })
}
