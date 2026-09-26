// Event handlers. Each takes a batch of IDs, is idempotent (key want + listing + input hash + rule
// version) and publishes only after its transaction commits (CLAUDE.md). The matched event is
// published by the transport wrapper once the handler succeeds.
import { events as accountEvents } from '@nabvy/contracts/modules/account'
import { events as copyAdvertEvents } from '@nabvy/contracts/modules/copy-advert'
import { events as listingAssessmentEvents } from '@nabvy/contracts/modules/listing-assessment'
import { events as noiseFilterEvents } from '@nabvy/contracts/modules/noise-filter'
import { events as wantManagerEvents } from '@nabvy/contracts/modules/want-manager'
import type { Queryable } from '@nabvy/db'
import { defineHandler, type EventHandler } from '@nabvy/transport'
import { matchListings, matchWants, onAccountDeleted, type SpecMatchDeps } from '../index'

export interface SpecMatchHandlerDeps extends SpecMatchDeps {
  /** Runs `fn` in one pipeline transaction: `withPipeline` in the task file. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
}

/**
 * `listing-assessment.assessed`, `noise-filter.classified` and `copy-advert.clustered` →
 * `matchListings` over those listings, with the hop time as T5 (rule 10; a stored verdict is
 * not written again on replay, so the stamp stays).
 */
export function listingEventHandlers(deps: SpecMatchHandlerDeps): EventHandler[] {
  const handle = async (listingIds: string[], at: string) => {
    const result = await deps.transaction((q) =>
      matchListings(q, { listingIds, now: new Date(at) }, deps),
    )
    return result
  }
  return [
    defineHandler({
      consumer: 'spec-match',
      registry: listingAssessmentEvents,
      type: 'listing-assessment.assessed',
      stamp: 't5Matched',
      async handle(event, ctx) {
        const result = await handle(event.payload.listingIds, ctx.at)
        if (!result.ok) return result
        ctx.emit(...result.value.events)
        return { ok: true, value: undefined }
      },
    }),
    defineHandler({
      consumer: 'spec-match',
      registry: noiseFilterEvents,
      type: 'noise-filter.classified',
      stamp: 't5Matched',
      async handle(event, ctx) {
        const result = await handle(event.payload.listingIds, ctx.at)
        if (!result.ok) return result
        ctx.emit(...result.value.events)
        return { ok: true, value: undefined }
      },
    }),
    defineHandler({
      consumer: 'spec-match',
      registry: copyAdvertEvents,
      type: 'copy-advert.clustered',
      stamp: 't5Matched',
      async handle(event, ctx) {
        const result = await handle(event.payload.listingIds, ctx.at)
        if (!result.ok) return result
        ctx.emit(...result.value.events)
        return { ok: true, value: undefined }
      },
    }),
  ]
}

/** `want-manager.changed` → `matchWants`: the backfill over the last seven days' listings. */
export function wantManagerChangedHandler(deps: SpecMatchHandlerDeps): EventHandler {
  return defineHandler({
    consumer: 'spec-match',
    registry: wantManagerEvents,
    type: 'want-manager.changed',
    stamp: 't5Matched',
    async handle(event, ctx) {
      const result = await deps.transaction((q) =>
        matchWants(q, { wantIds: event.payload.wantIds, now: new Date(ctx.at) }, deps),
      )
      if (!result.ok) return result
      ctx.emit(...result.value.events)
      return { ok: true, value: undefined }
    },
  })
}

/** `account.deleted` → every match of that user removed (rule 12). */
export function accountDeletedHandler(deps: SpecMatchHandlerDeps): EventHandler {
  return defineHandler({
    consumer: 'spec-match',
    registry: accountEvents,
    type: 'account.deleted',
    async handle(event) {
      await deps.transaction((q) => onAccountDeleted(q, [event.payload]))
      return { ok: true, value: undefined }
    },
  })
}
