// Event handlers. Each takes a batch of listing IDs (or index group keys), is idempotent (key
// listing + evidence hash + card hash + input hash + rule version) and publishes only after its
// transaction commits (CLAUDE.md).
import { events as askingPriceIndexEvents } from '@nabvy/contracts/modules/asking-price-index'
import { events as detailEvidenceEvents } from '@nabvy/contracts/modules/detail-evidence'
import { events as listingAssessmentEvents } from '@nabvy/contracts/modules/listing-assessment'
import type { Queryable } from '@nabvy/db'
import { defineHandler, type EventHandler } from '@nabvy/transport'
import { evaluate, evaluateGroups } from '../index'

export interface EvaluateHandlerDeps {
  /** Runs `fn` in one pipeline transaction: `withPipeline` in the task file. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
}

/**
 * `detail-evidence.changed` → `evaluate` over those listings, in one transaction, with the hop
 * time as the done time (rule 10; kept on replay, since a stored evaluation is not written
 * again). The `found` events are published by the wrapper once it succeeds.
 */
export function detailEvidenceChangedHandler(deps: EvaluateHandlerDeps): EventHandler {
  return defineHandler({
    consumer: 'warning-signs',
    registry: detailEvidenceEvents,
    type: 'detail-evidence.changed',
    async handle(event, ctx) {
      const result = await deps.transaction((q) =>
        evaluate(q, { listingIds: event.payload.listingIds, now: new Date(ctx.at) }),
      )
      if (!result.ok) return result
      ctx.emit(...result.value.events)
      return { ok: true, value: undefined }
    },
  })
}

/** `listing-assessment.assessed` → `evaluate` (cautions and exclusions changed). */
export function listingAssessmentAssessedHandler(deps: EvaluateHandlerDeps): EventHandler {
  return defineHandler({
    consumer: 'warning-signs',
    registry: listingAssessmentEvents,
    type: 'listing-assessment.assessed',
    async handle(event, ctx) {
      const result = await deps.transaction((q) =>
        evaluate(q, { listingIds: event.payload.listingIds, now: new Date(ctx.at) }),
      )
      if (!result.ok) return result
      ctx.emit(...result.value.events)
      return { ok: true, value: undefined }
    },
  })
}

/**
 * `asking-price-index.updated` → `evaluateGroups`: every listing whose ask is a member of those
 * groups, in batches of 500, in one transaction.
 */
export function askingPriceIndexUpdatedHandler(deps: EvaluateHandlerDeps): EventHandler {
  return defineHandler({
    consumer: 'warning-signs',
    registry: askingPriceIndexEvents,
    type: 'asking-price-index.updated',
    async handle(event, ctx) {
      const result = await deps.transaction((q) =>
        evaluateGroups(q, { groupKeys: event.payload.groupKeys, now: new Date(ctx.at) }),
      )
      if (!result.ok) return result
      ctx.emit(...result.value.events)
      return { ok: true, value: undefined }
    },
  })
}
