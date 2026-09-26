// Event handlers. Each takes a batch (1–500 listing IDs), is idempotent (the drop's own content
// hash; a replay writes nothing new) and publishes only after its transaction commits (CLAUDE.md).
import { events as accountEvents } from '@nabvy/contracts/modules/account'
import { events as listingIngestEvents } from '@nabvy/contracts/modules/listing-ingest'
import { events as relistMergeEvents } from '@nabvy/contracts/modules/relist-merge'
import type { Queryable } from '@nabvy/db'
import { defineHandler, type EventHandler } from '@nabvy/transport'
import { accountDeletedEvent, applyEvent } from '../index'

export interface HandlerDeps {
  /** Runs `fn` in one pipeline transaction: `withPipeline` in the task file. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
}

/**
 * `listing-ingest.card-changed` → the drop check for its listings, keyed on the event's key; the
 * `dropped` events are published by the wrapper once it succeeds.
 */
export function cardChangedHandler(deps: HandlerDeps): EventHandler {
  return defineHandler({
    consumer: 'price-drop-watch',
    registry: listingIngestEvents,
    type: 'listing-ingest.card-changed',
    async handle(event, ctx) {
      const result = await deps.transaction((q) =>
        applyEvent(q, { listingIds: event.payload.listingIds, key: ctx.key }),
      )
      ctx.emit(...result.events)
      return { ok: true, value: undefined }
    },
  })
}

/**
 * `relist-merge.merged` → the drop check for every member of the changed group. Relist-merge only
 * stops the same item alerting twice (README.md, "Decisions"); it never moves a watch to another
 * listing ID.
 */
export function mergedHandler(deps: HandlerDeps): EventHandler {
  return defineHandler({
    consumer: 'price-drop-watch',
    registry: relistMergeEvents,
    type: 'relist-merge.merged',
    async handle(event, ctx) {
      const result = await deps.transaction((q) =>
        applyEvent(q, { listingIds: event.payload.listingIds, key: ctx.key }),
      )
      ctx.emit(...result.events)
      return { ok: true, value: undefined }
    },
  })
}

/**
 * `account.deleted` → removes the account's watches and drops (rule 12: a module holding user
 * rows purges them on `account.deleted` within 24 hours). Runs whatever this module's switch
 * says, like `erase()`.
 */
export function accountDeletedHandler(deps: HandlerDeps): EventHandler {
  return defineHandler({
    consumer: 'price-drop-watch',
    registry: accountEvents,
    type: 'account.deleted',
    async handle(event) {
      await deps.transaction((q) => accountDeletedEvent(q, [event.payload.userId]))
      return { ok: true, value: undefined }
    },
  })
}
