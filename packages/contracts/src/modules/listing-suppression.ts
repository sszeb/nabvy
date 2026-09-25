import { z } from 'zod'
import { defineEvents, IsoTimestamp, Source, Uuid } from '../index'

// Contracts of the listing-suppression module (docs/design/modules/listing-suppression.md): the
// suppression list and the listings it hides. Import from
// '@nabvy/contracts/modules/listing-suppression'. The view row is written here as Zod, as
// detail-evidence's are: drizzle-zod is not a dependency yet (services/listing-suppression/README.md,
// "Decisions").

export const module = 'listing-suppression'

/** SHA-256 or HMAC-SHA-256, lowercase hex. Every stored value is one: never a raw ID or text. */
export const ListingSuppressionHash = z.string().regex(/^[0-9a-f]{64}$/)
export type ListingSuppressionHash = z.infer<typeof ListingSuppressionHash>

/**
 * What an entry matches: a hash of a named listing ID (`source:sourceListingId`), a seller key
 * from `seller-key`, or a look-alike fingerprint of a named listing
 * (fb-scrap-engine/docs/design/SELLER_DATA.md:131-138).
 */
export const ListingSuppressionKind = z.enum(['listing_hash', 'seller_key', 'lookalike'])
export type ListingSuppressionKind = z.infer<typeof ListingSuppressionKind>

/**
 * Which fingerprint a look-alike entry holds: `description` (detail-evidence's `v_fingerprints`)
 * or `card` (title, price and city page: listing-ingest's `v_fingerprints`). Null for the other
 * kinds.
 */
export const ListingSuppressionBasis = z.enum(['description', 'card'])
export type ListingSuppressionBasis = z.infer<typeof ListingSuppressionBasis>

/** One entry of the suppression list. Look-alike entries expire; the others never do. */
export const ListingSuppressionEntry = z
  .strictObject({
    id: Uuid,
    kind: ListingSuppressionKind,
    basis: ListingSuppressionBasis.nullable(),
    value: ListingSuppressionHash,
    /** Null: never expires. Set only on look-alike entries. */
    expiresAt: IsoTimestamp.nullable(),
    /** The `seller-rights` request that asked for it. */
    requestId: Uuid,
    createdAt: IsoTimestamp,
  })
  .refine((e) => (e.kind === 'lookalike') === (e.basis !== null), 'basis only on look-alikes')
  .refine((e) => (e.kind === 'lookalike') === (e.expiresAt !== null), 'expiry only on look-alikes')
export type ListingSuppressionEntry = z.infer<typeof ListingSuppressionEntry>

const SourceListingId = z.string().regex(/^[0-9A-Za-z_-]{1,200}$/)

/** A listing named in a request, by the source's own ID (from the link the requester gives). */
export const ListingSuppressionNamedListing = z.strictObject({
  source: Source,
  sourceListingId: SourceListingId,
})
export type ListingSuppressionNamedListing = z.infer<typeof ListingSuppressionNamedListing>

/**
 * Input of `add()`, called by `seller-rights` only. At most 500 named listings and 500 seller
 * keys; at least one of either. Seller keys are `seller-key`'s keys, never a raw seller ID.
 */
export const ListingSuppressionAddInput = z
  .strictObject({
    requestId: Uuid,
    listings: z.array(ListingSuppressionNamedListing).max(500).default([]),
    sellerKeys: z.array(ListingSuppressionHash).max(500).default([]),
  })
  .refine((i) => i.listings.length + i.sellerKeys.length > 0, 'names no listing and no seller key')
export type ListingSuppressionAddInput = z.input<typeof ListingSuppressionAddInput>

/**
 * One row of `listing_suppression.v_suppressed`: a listing an entry hides now, why, and until when
 * (null: no end). A listing hidden by several entries appears once per reason.
 */
export const ListingSuppressionSuppressed = z.strictObject({
  listingId: Uuid,
  reason: ListingSuppressionKind,
  until: IsoTimestamp.nullable(),
})
export type ListingSuppressionSuppressed = z.infer<typeof ListingSuppressionSuppressed>

/** Entries a request added: readers re-check the listings they show (`is_suppressed`). */
export const ListingSuppressionChangedEvent = z.strictObject({
  entryIds: z.array(Uuid).min(1).max(500),
})
export type ListingSuppressionChangedEvent = z.infer<typeof ListingSuppressionChangedEvent>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  'listing-suppression.changed': { 1: ListingSuppressionChangedEvent },
})

/** Error codes the module returns as values. */
export const ListingSuppressionErrorCode = z.enum([
  'listing-suppression.invalid_input', // add() input failed ListingSuppressionAddInput
])
export type ListingSuppressionErrorCode = z.infer<typeof ListingSuppressionErrorCode>
