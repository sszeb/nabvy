// Event handlers. Each takes a batch, is idempotent (a run's judgements are keyed by job ID and
// search index) and publishes only after its transaction commits (CLAUDE.md).
import { events as apifyGatewayEvents } from '@nabvy/contracts/modules/apify-gateway'
import type { Queryable } from '@nabvy/db'
import { defineHandler, type EventHandler } from '@nabvy/transport'
import { assess } from '../index'

export interface RunCollectedDeps {
  /** Runs `fn` in one pipeline transaction: `withPipeline` in the task file. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
}

/**
 * `apify-gateway.run-collected` → `assess` for that job, in one transaction; the
 * `search-degraded` event is published by the wrapper once it succeeds. A run whose sightings
 * listing-ingest has not stored yet fails and is retried, so the gap check never reads a run
 * half-ingested. The module stores the T1 of its input (`collected_at`) and its `done_at`
 * (rule 10), not envelope stamps.
 */
export function runCollectedHandler(deps: RunCollectedDeps): EventHandler {
  return defineHandler({
    consumer: 'run-coverage',
    registry: apifyGatewayEvents,
    type: 'apify-gateway.run-collected',
    async handle(event, ctx) {
      const result = await deps.transaction((q) =>
        assess(q, { jobId: event.payload.jobId, kind: event.payload.kind }),
      )
      if (!result.ok) return result
      ctx.emit(...result.value.events)
      return { ok: true, value: undefined }
    },
  })
}
