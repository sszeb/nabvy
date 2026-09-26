import { z } from 'zod'
import { Currency, defineEvents, IsoTimestamp, Uuid } from '../index'

// Contracts of the price-drop-watch module (docs/design/modules/price-drop-watch.md): a user's
// watched listings and the price drops observed on them, within one listing ID each. A watch
// never moves to another listing ID, even across a relist (README.md, "Decisions"; catalogue
// question 21), and this module never infers a sale. Import from
// '@nabvy/contracts/modules/price-drop-watch'. View rows are written here as Zod, as the other
// acquisition-adjacent modules do: drizzle-zod is not a dependency yet.

export const module = 'price-drop-watch'

/** `watch()` input: one listing per call (the user picks it from a listing card). */
export const PriceDropWatchWatchInput = z.strictObject({
  userId: Uuid,
  listingId: Uuid,
})
export type PriceDropWatchWatchInput = z.infer<typeof PriceDropWatchWatchInput>

/** `unwatch()` input. */
export const PriceDropWatchUnwatchInput = z.strictObject({
  userId: Uuid,
  listingId: Uuid,
})
export type PriceDropWatchUnwatchInput = z.infer<typeof PriceDropWatchUnwatchInput>

/** One row of `app.v_price_drop_watch_watches` (user-facing; RLS-scoped to the caller). */
export const PriceDropWatchWatch = z.strictObject({
  id: Uuid,
  listingId: Uuid,
  active: z.boolean(),
  createdAt: IsoTimestamp,
})
export type PriceDropWatchWatch = z.infer<typeof PriceDropWatchWatch>

/**
 * One row of `app.v_price_drop_watch_history` (user-facing; RLS-scoped to the caller). Every
 * point is one of listing-ingest's own observed prices; never the seller's displayed "previous
 * price", and never a row from another listing ID even when relist-merge has grouped it with this
 * one.
 */
export const PriceDropWatchHistoryPoint = z.strictObject({
  listingId: Uuid,
  observedAt: IsoTimestamp,
  priceMinor: z.int().nonnegative(),
  currency: Currency,
})
export type PriceDropWatchHistoryPoint = z.infer<typeof PriceDropWatchHistoryPoint>

/** One recorded drop (internal; `price_drop_watch.drops`), never exposed to users directly. */
export const PriceDropWatchDrop = z.strictObject({
  id: Uuid,
  watchId: Uuid,
  fromMinor: z.int().nonnegative(),
  toMinor: z.int().nonnegative(),
  currency: Currency,
  observedAt: IsoTimestamp,
  cardHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** relist-merge's group ID for the listing at write time; null when ungrouped or off. */
  relistGroupId: Uuid.nullable(),
})
export type PriceDropWatchDrop = z.infer<typeof PriceDropWatchDrop>

/** Watches whose listing dropped in price. Identifiers only; readers load the drop from a batch
 * read of their own watches, never a whole record on the wire (rule 7). */
export const PriceDropWatchDroppedEvent = z.strictObject({
  watchIds: z.array(Uuid).min(1).max(500),
})
export type PriceDropWatchDroppedEvent = z.infer<typeof PriceDropWatchDroppedEvent>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  'price-drop-watch.dropped': { 1: PriceDropWatchDroppedEvent },
})

/** Error codes returned as values. */
export const PriceDropWatchErrorCode = z.enum([
  // watch() named a listing listing-ingest does not show (never ingested, erased, or
  // listing-ingest off)
  'price-drop-watch.listing_not_found',
  // watch()/unwatch() called while this module or the pipeline is off (card: "no watches and no
  // drop alerts" while off — not one of rule 11's named recording exceptions)
  'price-drop-watch.module_off',
])
export type PriceDropWatchErrorCode = z.infer<typeof PriceDropWatchErrorCode>
