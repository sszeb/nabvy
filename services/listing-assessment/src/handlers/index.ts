// Event handlers. Each takes a batch of listing IDs, is idempotent (key listing + evidence hash
// + card hash + record hash + rule version) and publishes only after its transaction commits
// (CLAUDE.md).
import { events as partsRecordEvents } from '@nabvy/contracts/modules/parts-record'
import type { Queryable } from '@nabvy/db'
import { defineHandler, type EventHandler } from '@nabvy/transport'
import { assess } from '../index'

export interface AssessHandlerDeps {
  /** Runs `fn` in one pipeline transaction: `withPipeline` in the task file. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
}

/**
 * `parts-record.recorded` → `assess` over those listings, in one transaction, with the hop time
 * as T3 (rule 10; kept on replay, since a stored assessment is never rewritten). The `assessed`
 * event is published by the wrapper once it succeeds.
 */
export function partsRecordRecordedHandler(deps: AssessHandlerDeps): EventHandler {
  return defineHandler({
    consumer: 'listing-assessment',
    registry: partsRecordEvents,
    type: 'parts-record.recorded',
    stamp: 't3Extracted',
    async handle(event, ctx) {
      const result = await deps.transaction((q) =>
        assess(q, { listingIds: event.payload.listingIds, now: new Date(ctx.at) }),
      )
      if (!result.ok) return result
      ctx.emit(...result.value.events)
      return { ok: true, value: undefined }
    },
  })
}
