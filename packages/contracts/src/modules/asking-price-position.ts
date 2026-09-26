import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'
import { AskingPriceIndexCurrency, AskingPriceIndexGroupKeyString } from './asking-price-index'

// Contracts of the asking-price-position module (docs/design/modules/asking-price-position.md):
// where a listing's ask sits among the asks of its asking-price-index group. Import from
// '@nabvy/contracts/modules/asking-price-position'. Users see rank, n, median and range only, at
// n>=10 (nabvy/docs/decisions.md:15); percentile and robust z stay internal (no score). Nothing
// here says "worth", "fair" or "sale price" (PARTS_INTELLIGENCE.md:365-367).

export const module = 'asking-price-position'

/**
 * One row of `asking_price_position.positions`, published in `v_positions`: a listing's ask
 * against the counted asks of one group, in minor units of the group's currency. `rank` is 1 for
 * the lowest ask (ties share a rank); `percentile` is the mid-rank percentile (asks below plus half
 * the equal asks, over n); `robustZ` is (ask − median) / (1.4826·MAD). The three are null when the
 * group has no counted ask. `newMedian` and `newN` are the same item's new-condition group, as
 * context, when that group has n≥10 and this one is not new. `positionedAt` is T4.
 */
export const AskingPricePosition = z.strictObject({
  listingId: Uuid,
  groupKey: AskingPriceIndexGroupKeyString,
  askMinor: z.number().int().min(0),
  rank: z.number().int().min(1).nullable(),
  n: z.number().int().min(0),
  percentile: z.number().min(0).max(100).nullable(),
  robustZ: z.number().nullable(),
  label: z.string().min(1),
  median: z.number().int().nullable(),
  rangeLow: z.number().int().nullable(),
  rangeHigh: z.number().int().nullable(),
  currency: AskingPriceIndexCurrency,
  newMedian: z.number().int().nullable(),
  newN: z.number().int().min(0).nullable(),
  statsAsOf: IsoTimestamp,
  positionedAt: IsoTimestamp,
})
export type AskingPricePosition = z.infer<typeof AskingPricePosition>

/** One row of the user-facing `app.v_asking_price_position` (n≥10 only; no score). */
export const AskingPricePositionShown = z.strictObject({
  listingId: Uuid,
  label: z.string().min(1),
  rank: z.number().int().min(1),
  n: z.number().int().min(10),
  median: z.number().int(),
  rangeLow: z.number().int(),
  rangeHigh: z.number().int(),
  currency: AskingPriceIndexCurrency,
})
export type AskingPricePositionShown = z.infer<typeof AskingPricePositionShown>

/** Listings whose position was written or removed. Identifiers only; readers reload (rule 7). */
export const AskingPricePositionPositionedEvent = z.strictObject({
  listingIds: z.array(Uuid).min(1).max(500),
})
export type AskingPricePositionPositionedEvent = z.infer<typeof AskingPricePositionPositionedEvent>

/** The batch handed to `position`: group keys from `asking-price-index.updated`. */
export const AskingPricePositionInput = z.strictObject({
  groupKeys: z.array(AskingPriceIndexGroupKeyString).min(1).max(500),
})
export type AskingPricePositionInput = z.infer<typeof AskingPricePositionInput>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  'asking-price-position.positioned': { 1: AskingPricePositionPositionedEvent },
})

/** Error codes the module returns as values. */
export const AskingPricePositionErrorCode = z.enum([
  'asking-price-position.invalid_input', // the batch is empty, too large or holds a bad group key
])
export type AskingPricePositionErrorCode = z.infer<typeof AskingPricePositionErrorCode>
