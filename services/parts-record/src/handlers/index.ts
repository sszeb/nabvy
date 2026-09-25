// Event handlers. Each takes a batch of listing IDs, is idempotent (key listing + evidence hash
// + extractor versions) and publishes only after its transaction commits (CLAUDE.md).
import { events as partsAiEvents } from '@nabvy/contracts/modules/parts-ai'
import { events as partsRulesEvents } from '@nabvy/contracts/modules/parts-rules'
import type { Queryable } from '@nabvy/db'
import { defineHandler, type EventHandler } from '@nabvy/transport'
import { type PartsRecordDeps, record } from '../index'

export interface RecordHandlerDeps extends PartsRecordDeps {
  /** Runs `fn` in one pipeline transaction: `withPipeline` in the task file. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
}

/**
 * `parts-rules.ran` → `record` over those listings, in one transaction; the `recorded` event is
 * published by the wrapper once it succeeds. The module is outside the T-stamp chain: each record
 * keeps its own `recorded_at` (rule 10).
 */
export function partsRulesRanHandler(deps: RecordHandlerDeps): EventHandler {
  return defineHandler({
    consumer: 'parts-record',
    registry: partsRulesEvents,
    type: 'parts-rules.ran',
    async handle(event, ctx) {
      const result = await deps.transaction((q) =>
        record(q, { listingIds: event.payload.listingIds }, deps),
      )
      if (!result.ok) return result
      ctx.emit(...result.value.events)
      return { ok: true, value: undefined }
    },
  })
}

/** `parts-ai.extracted` → the same merge: the AI rows join the record of the version. */
export function partsAiExtractedHandler(deps: RecordHandlerDeps): EventHandler {
  return defineHandler({
    consumer: 'parts-record',
    registry: partsAiEvents,
    type: 'parts-ai.extracted',
    async handle(event, ctx) {
      const result = await deps.transaction((q) =>
        record(q, { listingIds: event.payload.listingIds }, deps),
      )
      if (!result.ok) return result
      ctx.emit(...result.value.events)
      return { ok: true, value: undefined }
    },
  })
}
