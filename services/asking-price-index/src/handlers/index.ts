// Event handlers. Each takes a batch of listing IDs, is idempotent (memberships are upserted on
// (group, listing) and figures are rewritten only when they change, so a replay writes nothing and
// announces nothing: rule 8's "index group key and stats as_of") and publishes only after its
// transaction commits (CLAUDE.md). The module is outside the T-stamp chain: each membership keeps
// the ask's `seen_at` and each group's figures their `as_of` (rule 10).
import { events as copyAdvertEvents } from '@nabvy/contracts/modules/copy-advert'
import { events as listingAssessmentEvents } from '@nabvy/contracts/modules/listing-assessment'
import { events as listingIngestEvents } from '@nabvy/contracts/modules/listing-ingest'
import { events as relistMergeEvents } from '@nabvy/contracts/modules/relist-merge'
import type { EventEnvelope, Result } from '@nabvy/contracts'
import type { Queryable } from '@nabvy/db'
import { defineHandler, type EventHandler } from '@nabvy/transport'
import { type IndexEvidence, index } from '../index'

export interface IndexDeps {
  /** Runs `fn` in one pipeline transaction: `withPipeline` in the task file. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
  /** Optional seller-key and promoted evidence; defaults to none (soft edges). */
  evidence?: IndexEvidence
}

async function run(
  deps: IndexDeps,
  listingIds: string[],
  emit: (...envelopes: EventEnvelope[]) => void,
): Promise<Result<void>> {
  const result = await deps.transaction((q) =>
    index(q, { listingIds }, { evidence: deps.evidence }),
  )
  if (!result.ok) return result
  emit(...result.value.events)
  return { ok: true, value: undefined }
}

/** `listing-assessment.assessed` → `index`: the version's form, parts and condition are known. */
export function assessedHandler(deps: IndexDeps): EventHandler {
  return defineHandler({
    consumer: 'asking-price-index',
    registry: listingAssessmentEvents,
    type: 'listing-assessment.assessed',
    handle: (event, ctx) => run(deps, event.payload.listingIds, ctx.emit),
  })
}

/** `listing-ingest.card-changed` → `index`: the ask, availability or currency changed. */
export function cardChangedHandler(deps: IndexDeps): EventHandler {
  return defineHandler({
    consumer: 'asking-price-index',
    registry: listingIngestEvents,
    type: 'listing-ingest.card-changed',
    handle: (event, ctx) => run(deps, event.payload.listingIds, ctx.emit),
  })
}

/** `copy-advert.clustered` → `index`: copy collapse changed for these listings. */
export function clusteredHandler(deps: IndexDeps): EventHandler {
  return defineHandler({
    consumer: 'asking-price-index',
    registry: copyAdvertEvents,
    type: 'copy-advert.clustered',
    handle: (event, ctx) => run(deps, event.payload.listingIds, ctx.emit),
  })
}

/** `relist-merge.merged` → `index`: relist collapse changed for these listings. */
export function mergedHandler(deps: IndexDeps): EventHandler {
  return defineHandler({
    consumer: 'asking-price-index',
    registry: relistMergeEvents,
    type: 'relist-merge.merged',
    handle: (event, ctx) => run(deps, event.payload.listingIds, ctx.emit),
  })
}
