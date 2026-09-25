// Public API of the details-selector module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/details-selector' only, never from its internals. Chooses
// which newly seen listings get a paid detail fetch (docs/design/modules/details-selector.md) and
// hands them to `detailsQueue.enqueue()`. It never fetches or judges anything itself.

import {
  DETAILS_SELECTOR_EVENT_BATCH_SIZE,
  DETAILS_SELECTOR_IN_CATEGORY_IDS,
  DETAILS_SELECTOR_SHIPPING_DELIVERY_TYPES,
} from '@nabvy/config/modules/details-selector'
import { type AppError, err, ok, type Result } from '@nabvy/contracts'
import type { DetailsQueueEnqueued } from '@nabvy/contracts/modules/details-queue'
import { DetailsSelectorInput } from '@nabvy/contracts/modules/details-selector'
import type { Queryable } from '@nabvy/db'
import { enqueue } from '@nabvy/details-queue'
import { isOn, state } from '@nabvy/switches'
import { chunk, type Selection, selectBatch } from './domain'
import {
  deleteSelectionsOf,
  insertSelections,
  selectAreaFacts,
  selectCandidates,
  selectSourceIdentities,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/details-selector'
export { type AreaFact, type Candidate, categoryAllows, classify, type Selection } from './domain'
export { firstSeenHandler } from './handlers'

const MODULE = 'details-selector'
// details-queue accepts only this source today (DetailsQueueSource); other sources are recorded
// here (the table is source-agnostic, matching the card) but not yet sent for a fetch.
const QUEUEABLE_SOURCE = 'facebook'

/**
 * Optional evidence from want-manager, which is not built yet (soft edge). The default returns no
 * centres, so the `shipped` reason never fires and area membership falls back entirely to
 * city-pages' own `v_area_membership` (docs/questions/details-selector.md).
 */
export interface DetailsSelectorEvidence {
  /** Of these centre IDs, the ones with an active want that accepts delivery. */
  deliveryCentres(q: Queryable, centreIds: string[]): Promise<Set<string>>
}

export const noWantAreas: DetailsSelectorEvidence = {
  deliveryCentres: async () => new Set(),
}

/** What one `select` call did. */
export interface SelectReport {
  /** False while the module or the pipeline is off: nothing was read, written or enqueued. */
  open: boolean
  candidates: number
  selected: Selection[]
  enqueued: DetailsQueueEnqueued
}

const emptyEnqueued: DetailsQueueEnqueued = { queued: 0, alreadyQueued: 0, skipped: 0 }

/**
 * Selects, from a batch of newly seen listings, the ones that get a detail fetch: in area, or
 * offering shipping where an active want at that centre accepts delivery, and in an allowed
 * category (unknown counts as in). Records each selected card version and enqueues it through
 * `detailsQueue.enqueue()`. Records whatever the switch says is not the rule here (rule 11): while
 * off, or while the pipeline is off, this writes nothing and enqueues nothing. Safe to run twice.
 */
export async function select(
  q: Queryable,
  input: { listingIds: string[] },
  evidence: DetailsSelectorEvidence = noWantAreas,
): Promise<Result<SelectReport, AppError>> {
  const parsed = DetailsSelectorInput.safeParse(input)
  if (!parsed.success) {
    return err({ code: 'details-selector.invalid_input', message: parsed.error.message })
  }
  const listingIds = [...new Set(parsed.data.listingIds)].sort()
  const report: SelectReport = { open: false, candidates: 0, selected: [], enqueued: emptyEnqueued }
  if ((await state(q, MODULE)) === 'off' || !(await isOn(q, 'pipeline'))) return ok(report)
  report.open = true

  const candidates = await selectCandidates(q, listingIds)
  report.candidates = candidates.length
  const cityPageIds = candidates.flatMap((c) => (c.cityPageId !== null ? [c.cityPageId] : []))
  const areaOf = await selectAreaFacts(q, cityPageIds)
  const centreIds = [
    ...new Set([...areaOf.values()].flatMap((a) => (a.centreId !== null ? [a.centreId] : []))),
  ]
  const deliveryCentres = await evidence.deliveryCentres(q, centreIds)

  const chosen = selectBatch(
    candidates,
    areaOf,
    deliveryCentres,
    new Set(DETAILS_SELECTOR_IN_CATEGORY_IDS),
    new Set(DETAILS_SELECTOR_SHIPPING_DELIVERY_TYPES),
  )
  const now = new Date()
  const written = await insertSelections(q, chosen, now)
  report.selected = written

  const queueable = written.filter((row) => row.source === QUEUEABLE_SOURCE)
  for (const batch of chunk(queueable, DETAILS_SELECTOR_EVENT_BATCH_SIZE)) {
    const done = await enqueue(q, {
      source: 'facebook',
      sourceListingIds: batch.map((row) => row.sourceListingId),
      priority: 'new-listing',
      lane: 'text',
      reason: 'first-seen',
      requestedBy: MODULE,
    })
    report.enqueued = {
      queued: report.enqueued.queued + done.queued,
      alreadyQueued: report.enqueued.alreadyQueued + done.alreadyQueued,
      skipped: report.enqueued.skipped + done.skipped,
    }
  }
  return ok(report)
}

/**
 * Removes every selection of these listings (rule 12: `seller-rights` erasure). Runs whatever the
 * switch says, as `detailsQueue.enqueue()`'s own erasure does.
 */
export async function erase(q: Queryable, listingIds: string[]): Promise<number> {
  const identities = await selectSourceIdentities(q, listingIds)
  return deleteSelectionsOf(q, identities)
}
