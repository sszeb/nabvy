// Event handlers. Each takes a batch, is idempotent (key source + sourceListingId + contentHash,
// here the evidence hash) and publishes only after its transaction commits (CLAUDE.md).
import { events as apifyGatewayEvents } from '@nabvy/contracts/modules/apify-gateway'
import type { Queryable } from '@nabvy/db'
import { defineHandler, type EventHandler } from '@nabvy/transport'
import { record } from '../index'

export interface RunCollectedDeps {
  /** Runs `fn` in one pipeline transaction: `withPipeline` in the task file. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
}

/**
 * `apify-gateway.run-collected` → `record` for that job, in one transaction; the `changed` and
 * `unresolved` events are published by the wrapper once it succeeds. A job the gateway does not
 * show, or whose listings listing-ingest has not stored yet, fails and is retried, then
 * dead-lettered, so no run is dropped silently. The module is outside the T-stamp chain: each
 * fetch keeps its collection time (`fetched_at`) and its own write time (`created_at`) (rule 10).
 */
export function runCollectedHandler(deps: RunCollectedDeps): EventHandler {
  return defineHandler({
    consumer: 'detail-evidence',
    registry: apifyGatewayEvents,
    type: 'apify-gateway.run-collected',
    async handle(event, ctx) {
      const result = await deps.transaction((q) => record(q, { jobId: event.payload.jobId }))
      if (!result.ok) return result
      ctx.emit(...result.value.events)
      return { ok: true, value: undefined }
    },
  })
}
