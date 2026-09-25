// Event handlers. Each takes a batch, is idempotent (key listing + evidence hash + prompt
// version) and publishes only after its transaction commits (CLAUDE.md).
import { events as partsRulesEvents } from '@nabvy/contracts/modules/parts-rules'
import type { Queryable } from '@nabvy/db'
import { defineHandler, type EventHandler } from '@nabvy/transport'
import { type PartsAiContext, type PartsAiDeps, run } from '../index'

export interface PartsRulesRanDeps extends PartsAiDeps, PartsAiContext {
  /** Runs `fn` in one pipeline transaction: `withPipeline` in the task file. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
}

/**
 * `parts-rules.ran` → `run` over those listings, in one transaction; the `extracted` event is
 * published by the wrapper once it succeeds. Deferred and failed listings are acknowledged: the
 * sweep picks them up. The module is outside the T-stamp chain: each call keeps its own
 * `done_at` (rule 10).
 */
export function partsRulesRanHandler(deps: PartsRulesRanDeps): EventHandler {
  return defineHandler({
    consumer: 'parts-ai',
    registry: partsRulesEvents,
    type: 'parts-rules.ran',
    async handle(event, ctx) {
      const result = await deps.transaction((q) =>
        run(q, { listingIds: event.payload.listingIds }, deps, { usdGbpRate: deps.usdGbpRate }),
      )
      if (!result.ok) return result
      ctx.emit(...result.value.events)
      return { ok: true, value: undefined }
    },
  })
}
