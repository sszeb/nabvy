// Event handlers. Thin: parse, call the module's functions, return (rule 2). No events are
// published, so there is nothing to emit.
import { ok } from '@nabvy/contracts'
import { events as listingIngestEvents } from '@nabvy/contracts/modules/listing-ingest'
import type { Queryable } from '@nabvy/db'
import { defineHandler, type EventHandler } from '@nabvy/transport'
import { type DetailsSelectorEvidence, select } from '../index'

export interface SelectDeps {
  /** Runs `fn` in one pipeline transaction: `withPipeline` in the task file. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
  /** Optional want-manager evidence; defaults to none (soft edge). */
  evidence?: DetailsSelectorEvidence
}

/**
 * `listing-ingest.first-seen` → `select` for those listings: chooses which of them get a detail
 * fetch and enqueues them through `detailsQueue.enqueue()`. Stamps T2 (rule 10). Safe to run twice:
 * a replayed batch writes no new selection row and enqueues nothing further, since
 * `detailsQueue.enqueue()` itself deduplicates.
 */
export function firstSeenHandler(deps: SelectDeps): EventHandler {
  return defineHandler({
    consumer: 'details-selector',
    registry: listingIngestEvents,
    type: 'listing-ingest.first-seen',
    async handle(event) {
      const result = await deps.transaction((q) =>
        select(q, { listingIds: event.payload.listingIds }, deps.evidence),
      )
      return result.ok ? ok(undefined) : result
    },
  })
}
