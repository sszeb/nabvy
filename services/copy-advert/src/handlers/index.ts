// Event handlers. Each takes a batch, is idempotent (a replayed batch's prints already exist, so
// every write is a no-op upsert) and publishes only after its transaction commits. Ready for the
// event-task wiring that arrives with task 1.2 (trigger/README.md): no module has that wiring yet.
import { events as accountEvents } from '@nabvy/contracts/modules/account'
import { events as detailEvidenceEvents } from '@nabvy/contracts/modules/detail-evidence'
import { events as listingIngestEvents } from '@nabvy/contracts/modules/listing-ingest'
import { events as listingSuppressionEvents } from '@nabvy/contracts/modules/listing-suppression'
import type { Queryable } from '@nabvy/db'
import { defineHandler, type EventHandler } from '@nabvy/transport'
import { purgeUserReports, recompute } from '../index'
import { selectAllActiveMemberIds } from '../repo'

export interface CopyAdvertHandlerDeps {
  /** Runs `fn` in one pipeline transaction: `withPipeline` in the task file. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
}

/** `listing-ingest.first-seen` → recompute for the new listings. */
export function firstSeenHandler(deps: CopyAdvertHandlerDeps): EventHandler {
  return defineHandler({
    consumer: 'copy-advert',
    registry: listingIngestEvents,
    type: 'listing-ingest.first-seen',
    async handle(event, ctx) {
      const result = await deps.transaction((q) =>
        recompute(q, { listingIds: event.payload.listingIds, now: new Date(ctx.at) }),
      )
      if (!result.ok) return result
      ctx.emit(...result.value.events)
      return { ok: true, value: undefined }
    },
  })
}

/** `listing-ingest.card-changed` → a title or price change makes a new print; recompute. */
export function cardChangedHandler(deps: CopyAdvertHandlerDeps): EventHandler {
  return defineHandler({
    consumer: 'copy-advert',
    registry: listingIngestEvents,
    type: 'listing-ingest.card-changed',
    async handle(event, ctx) {
      const result = await deps.transaction((q) =>
        recompute(q, { listingIds: event.payload.listingIds, now: new Date(ctx.at) }),
      )
      if (!result.ok) return result
      ctx.emit(...result.value.events)
      return { ok: true, value: undefined }
    },
  })
}

/** `detail-evidence.changed` → new description evidence; resolves candidates and recomputes. */
export function detailEvidenceChangedHandler(deps: CopyAdvertHandlerDeps): EventHandler {
  return defineHandler({
    consumer: 'copy-advert',
    registry: detailEvidenceEvents,
    type: 'detail-evidence.changed',
    async handle(event, ctx) {
      const result = await deps.transaction((q) =>
        recompute(q, { listingIds: event.payload.listingIds, now: new Date(ctx.at) }),
      )
      if (!result.ok) return result
      ctx.emit(...result.value.events)
      return { ok: true, value: undefined }
    },
  })
}

/**
 * `listing-suppression.changed` → recomputes every active cluster's facts, since the event carries
 * entry IDs rather than listing IDs and cluster facts must leave out newly suppressed members
 * (docs 4.8; README.md, "Decisions" — a simplification: this recomputes every active cluster
 * rather than diffing which listings the changed entries touch).
 */
export function suppressionChangedHandler(deps: CopyAdvertHandlerDeps): EventHandler {
  return defineHandler({
    consumer: 'copy-advert',
    registry: listingSuppressionEvents,
    type: 'listing-suppression.changed',
    async handle(_event, ctx) {
      const result = await deps.transaction(async (q) => {
        const listingIds = await selectAllActiveMemberIds(q)
        return recompute(q, { listingIds, now: new Date(ctx.at) })
      })
      if (!result.ok) return result
      ctx.emit(...result.value.events)
      return { ok: true, value: undefined }
    },
  })
}

/** `account.deleted` → purges this user's report rows within 24 hours (here: immediately). */
export function accountDeletedHandler(deps: CopyAdvertHandlerDeps): EventHandler {
  return defineHandler({
    consumer: 'copy-advert',
    registry: accountEvents,
    type: 'account.deleted',
    async handle(event) {
      await deps.transaction((q) => purgeUserReports(q, event.payload.userId))
      return { ok: true, value: undefined }
    },
  })
}
