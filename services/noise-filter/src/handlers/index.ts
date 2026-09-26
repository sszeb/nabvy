// Event handlers. Each takes a batch of listing IDs, is idempotent (key listing + evidence hash
// + input hash + rule version) and publishes only after its transaction commits (CLAUDE.md).
import { events as listingAssessmentEvents } from '@nabvy/contracts/modules/listing-assessment'
import type { Queryable } from '@nabvy/db'
import { defineHandler, type EventHandler } from '@nabvy/transport'
import { classify } from '../index'

export interface ClassifyHandlerDeps {
  /** Runs `fn` in one pipeline transaction: `withPipeline` in the task file. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
}

/**
 * `listing-assessment.assessed` → `classify` over those listings, in one transaction, with the
 * hop time as the done time (rule 10; kept on replay, since a stored classification is not
 * written again). The `classified` event is published by the wrapper once it succeeds.
 */
export function listingAssessmentAssessedHandler(deps: ClassifyHandlerDeps): EventHandler {
  return defineHandler({
    consumer: 'noise-filter',
    registry: listingAssessmentEvents,
    type: 'listing-assessment.assessed',
    async handle(event, ctx) {
      const result = await deps.transaction((q) =>
        classify(q, { listingIds: event.payload.listingIds, now: new Date(ctx.at) }),
      )
      if (!result.ok) return result
      ctx.emit(...result.value.events)
      return { ok: true, value: undefined }
    },
  })
}
