// Public API of the relist-merge module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/relist-merge' only, never from its internals. It recognises,
// internally only, when an item comes back under a new listing ID, so the index counts it once
// and users get one alert per item (README.md). Nothing it holds is ever shown to users.

import {
  RELIST_MERGE_EVENT_BATCH_SIZE,
  RELIST_MERGE_MIN_DESCRIPTION_CHARS,
  RELIST_MERGE_WINDOW_DAYS,
} from '@nabvy/config/modules/relist-merge'
import {
  type AppError,
  createEvent,
  type EventEnvelope,
  err,
  ok,
  type Result,
} from '@nabvy/contracts'
import { events, RelistMergeInput } from '@nabvy/contracts/modules/relist-merge'
import type { Queryable } from '@nabvy/db'
import { isOn, state } from '@nabvy/switches'
import { chunk, type Evidence, groupsVersion, plan, type SellerKey } from './domain'
import {
  applySteps,
  deleteGroupsOf,
  lockMerges,
  selectDescriptionEvidence,
  selectFacts,
  selectGroups,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/relist-merge'
export { blocked, type Evidence, onePerGroup, type SellerKey, withinReach } from './domain'
export { detailChangedHandler, firstSeenHandler } from './handlers'

const MODULE = 'relist-merge'

/**
 * Optional evidence from modules that are not built yet (soft edges). Each default returns none,
 * so listings merge on description alone and nothing is ever blocked or tie-broken by a seller
 * key (docs/questions/relist-merge.md).
 */
export interface MergeEvidence {
  /**
   * Photo matches (`photo-review`'s `v_photo_hashes`: listings sharing a photo sha256 with one of
   * `listingIds`). Default: no photo evidence, since photo matching waits for photo-review.
   */
  photoMatches(q: Queryable, listingIds: string[]): Promise<Evidence[]>
  /**
   * Seller keys of these listings (`seller-key`'s `restricted_listing_keys`: key, key type, run),
   * used in memory for tie-breaks and blocks only, never stored. Default: no keys (seller-key is
   * gated).
   */
  sellerKeys(q: Queryable, listingIds: string[]): Promise<Map<string, SellerKey[]>>
}

export const noEvidence: MergeEvidence = {
  photoMatches: async () => [],
  sellerKeys: async () => new Map(),
}

/** What one `merge` call did. */
export interface MergeReport {
  /** False while the module or the pipeline is off: nothing was read, written or announced. */
  open: boolean
  listings: number
  groupsOpened: number
  membersWritten: number
  /** Every member of every group that holds a listing of the batch. */
  merged: string[]
  /** `merged` envelopes for the caller to publish after commit. */
  events: EventEnvelope[]
}

/**
 * Merges a batch of listings (a `first-seen` or `detail-evidence.changed` payload) into relist
 * groups: finds description (and, once photo-review exists, photo) matches on the same city page
 * within the window, drops those a seller key blocks, and joins or opens one group per listing.
 * A listing already in a group is never moved. Safe to run twice: the second run writes nothing
 * and returns the same event keys, derived from the stored groups, which the transport drops.
 */
export async function merge(
  q: Queryable,
  input: { listingIds: string[] },
  evidence: MergeEvidence = noEvidence,
): Promise<Result<MergeReport, AppError>> {
  const parsed = RelistMergeInput.safeParse(input)
  if (!parsed.success) {
    return err({ code: 'relist-merge.invalid_input', message: parsed.error.message })
  }
  const listingIds = [...new Set(parsed.data.listingIds)].sort()
  const report: MergeReport = {
    open: false,
    listings: listingIds.length,
    groupsOpened: 0,
    membersWritten: 0,
    merged: [],
    events: [],
  }
  if ((await state(q, MODULE)) === 'off' || !(await isOn(q, 'pipeline'))) return ok(report)
  report.open = true
  await lockMerges(q)

  const found = [
    ...(await selectDescriptionEvidence(q, listingIds, RELIST_MERGE_MIN_DESCRIPTION_CHARS)),
    ...(await evidence.photoMatches(q, listingIds)),
  ]
  const candidates = [...new Set(found.flatMap((e) => [e.listingId, e.otherListingId]))]
  const { groupOf, membersOf } = await selectGroups(q, [...new Set([...listingIds, ...candidates])])
  const involved = [...new Set([...listingIds, ...candidates, ...groupOf.keys()])].sort()
  const steps = plan({
    arriving: listingIds,
    facts: await selectFacts(q, involved),
    evidence: found,
    groupOf,
    membersOf,
    keysOf: found.length > 0 ? await evidence.sellerKeys(q, involved) : new Map(),
    windowDays: RELIST_MERGE_WINDOW_DAYS,
  })
  report.groupsOpened = steps.filter((s) => s.kind === 'open').length
  report.membersWritten = await applySteps(q, steps)

  // One event per group, keyed by the group and its member set (rule 8): a batch that names an
  // unchanged group again repeats a key the transport has already seen.
  const stored = await selectGroups(q, listingIds)
  report.merged = [...stored.membersOf.values()].flat()
  report.events = [...stored.membersOf].flatMap(([groupId, members]) => {
    const version = groupsVersion(new Map([[groupId, members]]))
    return chunk(members, RELIST_MERGE_EVENT_BATCH_SIZE).map((batch, i) =>
      createEvent(
        events,
        'relist-merge.merged',
        1,
        { listingIds: batch },
        { key: `relist-merge.merged:${groupId}@${version}:${i}` },
      ),
    )
  }) as EventEnvelope[]
  return ok(report)
}

/**
 * Removes every group that holds one of these listings (rule 12: `seller-rights` erasure). The
 * group's other listings stand alone again. Runs whatever the switch says. Returns how many groups
 * were removed.
 */
export async function erase(q: Queryable, listingIds: string[]): Promise<number> {
  let removed = 0
  for (const batch of chunk([...new Set(listingIds)], RELIST_MERGE_EVENT_BATCH_SIZE)) {
    removed += await deleteGroupsOf(q, batch)
  }
  return removed
}
