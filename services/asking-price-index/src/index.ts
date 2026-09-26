// Public API of the asking-price-index module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/asking-price-index' only, never from its internals. It groups
// current asks into comparable groups and computes each group's figures (README.md). It shows no
// position and never says "worth" or "fair" (nabvy/docs/decisions.md:15).

import { createHash } from 'node:crypto'
import {
  ASKING_PRICE_INDEX_EVENT_BATCH_SIZE,
  ASKING_PRICE_INDEX_IQR_FENCE,
  ASKING_PRICE_INDEX_ONE_PER_SELLER_KEY,
  ASKING_PRICE_INDEX_THIN_SHARE,
  ASKING_PRICE_INDEX_WINDOW_DAYS,
} from '@nabvy/config/modules/asking-price-index'
import {
  type AppError,
  createEvent,
  type EventEnvelope,
  err,
  ok,
  type Result,
} from '@nabvy/contracts'
import { AskingPriceIndexInput, events } from '@nabvy/contracts/modules/asking-price-index'
import type { Queryable } from '@nabvy/db'
import { isOn, state } from '@nabvy/switches'
import {
  chunk,
  collapseKeyOf,
  exclusionOf,
  figures,
  formatGroupKey,
  groupKeysOf,
  isStale,
  labelOf,
  sameFigures,
  sampleOriginOf,
} from './domain'
import {
  deleteEmptyGroups,
  deleteMembersOf,
  type GroupRow,
  lockIndex,
  type MemberRow,
  ownExclusion,
  selectCatalogue,
  selectFacts,
  selectMembers,
  selectStats,
  setOutcomes,
  upsertGroups,
  upsertStats,
  writeMembers,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/asking-price-index'
export {
  figures,
  formatGroupKey,
  groupCondition,
  groupContext,
  groupKeysOf,
  splitHalfStable,
} from './domain'
export {
  assessedHandler,
  cardChangedHandler,
  clusteredHandler,
  mergedHandler,
} from './handlers'

const MODULE = 'asking-price-index'

/**
 * Optional evidence from modules that are not built yet (soft edges). Each default returns none,
 * so every listing counts on its own account and no group is marked thin
 * (docs/questions/asking-price-index.md).
 */
export interface IndexEvidence {
  /**
   * Seller keys of these listings (`seller-key`'s `restricted_listing_keys`), used in memory for
   * one ask per key and the thin mark only, never stored. Default: no keys.
   */
  sellerKeys(q: Queryable, listingIds: string[]): Promise<Map<string, string>>
  /** Listings shown as "Promoted" (`seller-boosts`' `v_promoted`). Default: none. */
  promoted(q: Queryable, listingIds: string[]): Promise<Set<string>>
}

export const noEvidence: IndexEvidence = {
  sellerKeys: async () => new Map(),
  promoted: async () => new Set(),
}

export interface IndexOptions {
  evidence?: IndexEvidence
  /** The time figures are computed at; defaults to now. Tests pin it. */
  now?: Date
}

/** What one `index` call did. */
export interface IndexReport {
  /** False while the module or the pipeline is off: nothing was read, written or announced. */
  open: boolean
  listings: number
  /** Group keys whose figures changed (or were first written). */
  updated: string[]
  /** `updated` envelopes for the caller to publish after commit. */
  events: EventEnvelope[]
}

/**
 * Indexes a batch of listings: puts each current ask into its groups (one per offered catalogue
 * item), marks why an ask does not count, and recomputes the figures of every group the batch
 * touches. Safe to run twice: the second run writes nothing and announces nothing.
 */
export async function index(
  q: Queryable,
  input: { listingIds: string[] },
  options: IndexOptions = {},
): Promise<Result<IndexReport, AppError>> {
  const parsed = AskingPriceIndexInput.safeParse(input)
  if (!parsed.success) {
    return err({ code: 'asking-price-index.invalid_input', message: parsed.error.message })
  }
  const evidence = options.evidence ?? noEvidence
  const asOf = options.now ?? new Date()
  const listingIds = [...new Set(parsed.data.listingIds)].sort()
  const report: IndexReport = { open: false, listings: listingIds.length, updated: [], events: [] }
  if ((await state(q, MODULE)) === 'off' || !(await isOn(q, 'pipeline'))) return ok(report)
  report.open = true
  await lockIndex(q)

  const facts = await selectFacts(q, listingIds)
  const promoted = await evidence.promoted(q, listingIds)
  const catalogue = await selectCatalogue(q, [...new Set(facts.flatMap((f) => f.offered))])
  const groupRows = new Map<string, GroupRow>()
  const memberRows: MemberRow[] = []
  for (const f of facts) {
    const listing = { ...f, promoted: promoted.has(f.listingId) }
    if (listing.evidenceHash === null || listing.priceMinor === null) continue
    const excluded = exclusionOf(listing)
    for (const key of groupKeysOf(listing, ASKING_PRICE_INDEX_WINDOW_DAYS)) {
      const groupKey = formatGroupKey(key)
      const item = catalogue.get(key.catalogueId)
      groupRows.set(groupKey, {
        groupKey,
        ...key,
        label: labelOf(item?.name ?? key.catalogueId, key),
      })
      memberRows.push({
        groupKey,
        listingId: listing.listingId,
        askMinor: listing.priceMinor,
        sampleOrigin: sampleOriginOf(listing.foundByTerms, item),
        collapseKey: collapseKeyOf(listing),
        cityPageId: listing.cityPageId,
        seenAt: listing.lastSeenAt,
        cardHash: listing.cardHash,
        evidenceHash: listing.evidenceHash,
        counted: false,
        excluded,
      })
    }
  }
  await upsertGroups(q, [...groupRows.values()])
  const touched = await writeMembers(
    q,
    facts.map((f) => f.listingId),
    memberRows,
  )
  const keys = [...new Set([...touched, ...memberRows.map((m) => m.groupKey)])].sort()
  report.updated = await recompute(q, keys, asOf, evidence)
  await deleteEmptyGroups(q, [...touched])
  report.events = updatedEvents(report.updated, asOf)
  return ok(report)
}

/** Recomputes these groups' figures; returns the keys whose figures changed. */
async function recompute(
  q: Queryable,
  groupKeys: string[],
  asOf: Date,
  evidence: IndexEvidence,
): Promise<string[]> {
  if (groupKeys.length === 0) return []
  const all = await selectMembers(q, groupKeys)
  const sellerKeys =
    all.length > 0
      ? await evidence.sellerKeys(q, [...new Set(all.map((m) => m.listingId))])
      : new Map<string, string>()
  const previous = await selectStats(q, groupKeys)
  // "Copy collapse unavailable" while copy-advert is off (copy-advert.md section 3).
  const copyCollapse = (await state(q, 'copy-advert')) !== 'off'
  const changed: string[] = []
  for (const groupKey of groupKeys) {
    const rows = all.filter((m) => m.groupKey === groupKey)
    if (rows.length === 0) continue
    const decided = figures(
      rows.map((m) => {
        const own = ownExclusion(m.excluded)
        return {
          listingId: m.listingId,
          askMinor: m.askMinor,
          excluded:
            own ?? (isStale(m.seenAt, asOf, ASKING_PRICE_INDEX_WINDOW_DAYS) ? 'stale' : null),
          collapseKey: m.collapseKey,
          seenAt: m.seenAt,
          sellerKey: sellerKeys.get(m.listingId) ?? null,
        }
      }),
      {
        iqrFence: ASKING_PRICE_INDEX_IQR_FENCE,
        thinShare: ASKING_PRICE_INDEX_THIN_SHARE,
        onePerSellerKey: ASKING_PRICE_INDEX_ONE_PER_SELLER_KEY,
      },
    )
    await setOutcomes(q, groupKey, decided.outcomes)
    const next = { ...decided.figures, copyCollapse }
    const before = previous.get(groupKey)
    if (before && sameFigures(before, next)) continue
    await upsertStats(q, { groupKey, ...next, asOf })
    changed.push(groupKey)
  }
  return changed
}

function updatedEvents(groupKeys: string[], asOf: Date): EventEnvelope[] {
  return chunk(groupKeys, ASKING_PRICE_INDEX_EVENT_BATCH_SIZE).map((batch) => {
    // Keyed by the group keys and their `as_of` (rule 8: group key@as_of).
    const version = createHash('sha256')
      .update(`${batch.join('\n')}@${asOf.toISOString()}`)
      .digest('hex')
      .slice(0, 16)
    return createEvent(
      events,
      'asking-price-index.updated',
      1,
      { groupKeys: batch },
      { key: `asking-price-index.updated:${version}` },
    )
  }) as EventEnvelope[]
}

/**
 * Removes these listings from every group and recomputes those groups (rule 12: `seller-rights`
 * erasure). Runs whatever the switch says. Returns how many groups changed.
 */
export async function erase(
  q: Queryable,
  listingIds: string[],
  options: IndexOptions = {},
): Promise<number> {
  const touched: string[] = []
  for (const batch of chunk([...new Set(listingIds)], ASKING_PRICE_INDEX_EVENT_BATCH_SIZE)) {
    touched.push(...(await deleteMembersOf(q, batch)))
  }
  const keys = [...new Set(touched)].sort()
  await recompute(q, keys, options.now ?? new Date(), options.evidence ?? noEvidence)
  await deleteEmptyGroups(q, keys)
  return keys.length
}
