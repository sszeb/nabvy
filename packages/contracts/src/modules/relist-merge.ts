import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'

// Contracts of the relist-merge module (docs/design/modules/relist-merge.md): internal groups of
// listing IDs that are the same item listed again, so the index counts it once and users get one
// alert per item. Nothing here is ever shown to users (fb-scrap-engine SELLER_DATA.md:153-155).
// Import from '@nabvy/contracts/modules/relist-merge'. The view row is written here as Zod, as
// detail-evidence's are: drizzle-zod is not a dependency yet (services/relist-merge/README.md).

export const module = 'relist-merge'

/**
 * Why a listing is in its group: `origin` is the earlier listing a group was opened on;
 * `description` and `photo` name the evidence that linked a later member to `matchedListingId`.
 * The seller key is never a basis: it only breaks ties and blocks merges.
 */
export const RelistMergeBasis = z.enum(['origin', 'description', 'photo'])
export type RelistMergeBasis = z.infer<typeof RelistMergeBasis>

/** One row of `relist_merge.v_groups`: one member of one relist group (internal only). */
export const RelistMergeGroup = z.strictObject({
  groupId: Uuid,
  listingId: Uuid,
  basis: RelistMergeBasis,
  /** The member this listing was matched to; null for the group's origin. */
  matchedListingId: Uuid.nullable(),
  /** T1 of the listing when it was merged (listing-ingest's `first_fetched_at`). */
  inputFetchedAt: IsoTimestamp,
  /** When the module merged it (its `doneAt`, server time). */
  mergedAt: IsoTimestamp,
  groupCreatedAt: IsoTimestamp,
})
export type RelistMergeGroup = z.infer<typeof RelistMergeGroup>

const ListingIds = z.array(Uuid).min(1).max(500)

/**
 * Listings in groups that this call changed: every member of each affected group, so a reader
 * (the index, the notifier) reloads the whole group from `v_groups`. Identifiers only.
 */
export const RelistMergeMergedEvent = z.strictObject({ listingIds: ListingIds })
export type RelistMergeMergedEvent = z.infer<typeof RelistMergeMergedEvent>

/** The batch handed to `merge`: listing IDs from `first-seen` or `detail-evidence.changed`. */
export const RelistMergeInput = z.strictObject({ listingIds: ListingIds })
export type RelistMergeInput = z.infer<typeof RelistMergeInput>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  'relist-merge.merged': { 1: RelistMergeMergedEvent },
})

/** Error codes the module returns as values. */
export const RelistMergeErrorCode = z.enum([
  'relist-merge.invalid_input', // the batch is empty, too large or holds a non-UUID
])
export type RelistMergeErrorCode = z.infer<typeof RelistMergeErrorCode>
