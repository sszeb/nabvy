// Event handlers. Each takes a batch of group keys from `asking-price-index.updated`, is idempotent
// (a position is rewritten only when its listing's hashes, the group key@as_of or the rule version
// changed, rule 8, so a replay writes nothing and announces nothing), stamps T4 on every position
// it writes (rule 10) and publishes only after its transaction commits (CLAUDE.md).

import type { EventEnvelope, Result } from '@nabvy/contracts'
import { events as askingPriceIndexEvents } from '@nabvy/contracts/modules/asking-price-index'
import type { Queryable } from '@nabvy/db'
import { defineHandler, type EventHandler } from '@nabvy/transport'
import { position } from '../index'

export interface PositionDeps {
  /** Runs `fn` in one pipeline transaction: `withPipeline` in the task file. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
}

async function run(
  deps: PositionDeps,
  groupKeys: string[],
  emit: (...envelopes: EventEnvelope[]) => void,
): Promise<Result<void>> {
  const result = await deps.transaction((q) => position(q, { groupKeys }))
  if (!result.ok) return result
  emit(...result.value.events)
  return { ok: true, value: undefined }
}

/** `asking-price-index.updated` → `position`: these groups' figures changed. */
export function updatedHandler(deps: PositionDeps): EventHandler {
  return defineHandler({
    consumer: 'asking-price-position',
    registry: askingPriceIndexEvents,
    type: 'asking-price-index.updated',
    handle: (event, ctx) => run(deps, event.payload.groupKeys, ctx.emit),
  })
}
