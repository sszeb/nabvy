import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'

// Contracts of the asking-price-index module (docs/design/modules/asking-price-index.md): current
// asks grouped into comparable groups, and each group's figures. Import from
// '@nabvy/contracts/modules/asking-price-index'. The view rows are written here as Zod, as
// relist-merge's are: drizzle-zod is not a dependency yet (services/asking-price-index/README.md).
// Nothing here says "worth" or "fair", and no row carries a seller key (nabvy/docs/decisions.md:15).

export const module = 'asking-price-index'

/**
 * Where the catalogue item is offered: on its own, inside a PC, or in a bundle of parts. Bundle
 * asks are kept apart from PC asks (the card).
 */
export const AskingPriceIndexContext = z.enum(['standalone', 'in_pc', 'bundle'])
export type AskingPriceIndexContext = z.infer<typeof AskingPriceIndexContext>

/** The Condition attribute's machine value (detail-evidence), lowered when the text disagrees. */
export const AskingPriceIndexCondition = z.enum(['new', 'used_like_new', 'used_good', 'used_fair'])
export type AskingPriceIndexCondition = z.infer<typeof AskingPriceIndexCondition>

/** ISO 3166-1 alpha-2 country of the centre the listing belongs to. */
export const AskingPriceIndexCountry = z.string().regex(/^[A-Z]{2}$/)

/** Asks are never converted between currencies (PARTS_INTELLIGENCE.md:287-288). */
export const AskingPriceIndexCurrency = z.enum(['GBP', 'EUR'])
export type AskingPriceIndexCurrency = z.infer<typeof AskingPriceIndexCurrency>

/** Whether the search that found the listing aimed at this catalogue item. */
export const AskingPriceIndexSampleOrigin = z.enum(['on_target', 'by_catch'])
export type AskingPriceIndexSampleOrigin = z.infer<typeof AskingPriceIndexSampleOrigin>

/**
 * Why a member's ask is not counted. `relist` and `copy` are collapse (another member of the same
 * relist group or copy cluster counts); `seller` is one ask per seller key; `outlier` is outside
 * the IQR fences. The rest keep the listing out of the index altogether.
 */
export const AskingPriceIndexExclusion = z.enum([
  'noise',
  'zero_price',
  'money_kind',
  'sold',
  'unverified_binding',
  'promoted',
  'suppressed',
  'stale',
  'relist',
  'copy',
  'seller',
  'outlier',
])
export type AskingPriceIndexExclusion = z.infer<typeof AskingPriceIndexExclusion>

/**
 * A group key: catalogue item × context × condition × country and currency × window days
 * (PARTS_INTELLIGENCE.md:262-263). `format` gives its stable string form.
 */
export const AskingPriceIndexGroupKey = z.strictObject({
  catalogueId: z.string().min(1).max(200),
  context: AskingPriceIndexContext,
  condition: AskingPriceIndexCondition,
  country: AskingPriceIndexCountry,
  currency: AskingPriceIndexCurrency,
  windowDays: z.number().int().min(1).max(90),
})
export type AskingPriceIndexGroupKey = z.infer<typeof AskingPriceIndexGroupKey>

/** The string form stored in `group_key`: `<catalogue>|<context>|<condition>|<country>|<currency>|<n>d`. */
export const AskingPriceIndexGroupKeyString = z
  .string()
  .regex(/^[^|]+\|[a-z_]+\|[a-z_]+\|[A-Z]{2}\|[A-Z]{3}\|\d+d$/)

/**
 * One group's figures (`asking_price_index.stats`, published in `v_groups`), in minor units of the
 * group's currency. Null figures mean no counted ask. `thin` is internal: one seller key supplied
 * more than the set share. `copyCollapse` is false while copy-advert is off ("copy collapse
 * unavailable", copy-advert.md section 3).
 */
export const AskingPriceIndexStats = z.strictObject({
  groupKey: AskingPriceIndexGroupKeyString,
  n: z.number().int().min(0),
  median: z.number().int().nullable(),
  mad: z.number().int().nullable(),
  p25: z.number().int().nullable(),
  p75: z.number().int().nullable(),
  min: z.number().int().nullable(),
  max: z.number().int().nullable(),
  thin: z.boolean(),
  copyCollapse: z.boolean(),
  asOf: IsoTimestamp,
})
export type AskingPriceIndexStats = z.infer<typeof AskingPriceIndexStats>

/** One row of the user-facing `app.v_asking_price_index_bands` (n≥10 only; no position). */
export const AskingPriceIndexBand = z.strictObject({
  groupKey: AskingPriceIndexGroupKeyString,
  label: z.string().min(1),
  n: z.number().int().min(10),
  median: z.number().int(),
  rangeLow: z.number().int(),
  rangeHigh: z.number().int(),
  currency: AskingPriceIndexCurrency,
})
export type AskingPriceIndexBand = z.infer<typeof AskingPriceIndexBand>

const ListingIds = z.array(Uuid).min(1).max(500)

/** Group keys whose stats changed. Identifiers only; readers reload `v_groups` (rule 7). */
export const AskingPriceIndexUpdatedEvent = z.strictObject({
  groupKeys: z.array(AskingPriceIndexGroupKeyString).min(1).max(500),
})
export type AskingPriceIndexUpdatedEvent = z.infer<typeof AskingPriceIndexUpdatedEvent>

/** The batch handed to `index`: listing IDs from any consumed event. */
export const AskingPriceIndexInput = z.strictObject({ listingIds: ListingIds })
export type AskingPriceIndexInput = z.infer<typeof AskingPriceIndexInput>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  'asking-price-index.updated': { 1: AskingPriceIndexUpdatedEvent },
})

/** Error codes the module returns as values. */
export const AskingPriceIndexErrorCode = z.enum([
  'asking-price-index.invalid_input', // the batch is empty, too large or holds a non-UUID
])
export type AskingPriceIndexErrorCode = z.infer<typeof AskingPriceIndexErrorCode>
