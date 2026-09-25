import { z } from 'zod'
import { defineEvents, IsoTimestamp, Source } from '../index'

// Contracts of the details-selector module (docs/design/modules/details-selector.md): which newly
// seen listings get a paid detail fetch. Import from '@nabvy/contracts/modules/details-selector'.

export const module = 'details-selector'

/** Facebook's numeric listing ID, kept as a string (one recorded ID has 17 digits). */
export const DetailsSelectorSourceListingId = z.string().regex(/^\d{1,30}$/)
export type DetailsSelectorSourceListingId = z.infer<typeof DetailsSelectorSourceListingId>

/**
 * Why a listing was selected. `in_area`: its city page lies within an active centre's area.
 * `shipped`: it offers shipping and an active want at its centre accepts delivery (soft:
 * want-manager). Never a title or price reason (card: "whatever its price or title").
 */
export const DetailsSelectorReason = z.enum(['in_area', 'shipped'])
export type DetailsSelectorReason = z.infer<typeof DetailsSelectorReason>

/** One row of `details_selector.v_selections` (internal): a listing chosen for a detail fetch. */
export const DetailsSelectorSelection = z.strictObject({
  source: Source,
  sourceListingId: DetailsSelectorSourceListingId,
  /** The card version selected (rule 8's card-stage `contentHash`), from listing-ingest. */
  cardHash: z.string().regex(/^[0-9a-f]{64}$/),
  reason: DetailsSelectorReason,
  /** T2: when this card version was selected. */
  selectedAt: IsoTimestamp,
})
export type DetailsSelectorSelection = z.infer<typeof DetailsSelectorSelection>

/** The batch handed to `select`: listing UUIDs from `listing-ingest.first-seen`. */
export const DetailsSelectorInput = z.strictObject({
  listingIds: z.array(z.uuid()).min(1).max(500),
})
export type DetailsSelectorInput = z.infer<typeof DetailsSelectorInput>

/** Events this module publishes. It publishes none: it only calls `detailsQueue.enqueue()`. */
export const events = defineEvents(module, {})

/** Error codes the module returns as values. */
export const DetailsSelectorErrorCode = z.enum([
  'details-selector.invalid_input', // the batch is empty, too large or holds a non-UUID
])
export type DetailsSelectorErrorCode = z.infer<typeof DetailsSelectorErrorCode>
