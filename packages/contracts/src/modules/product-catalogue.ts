import { z } from 'zod'
import { defineEvents, Uuid } from '../index'

// Contracts of the product-catalogue module (services/product-catalogue, docs/design/modules/
// product-catalogue.md): the canonical parts and products catalogue, its aliases, negative
// contexts and codes, and the shape `resolve(text)` returns. Import from
// '@nabvy/contracts/modules/product-catalogue'.

export const module = 'product-catalogue'

/**
 * A canonical catalogue ID: colon-separated kebab-case segments, e.g. `gpu:nvidia:rtx-5080:16gb`
 * or `gpu:nvidia:rtx-5080:mobile`. Shares its shape with `@nabvy/packs`' `DictionaryEntry.productKey`
 * (docs/packs/gpu-pc.md) because desktop items are seeded from that dictionary verbatim.
 */
export const ProductCatalogueId = z
  .string()
  .regex(/^[a-z0-9-]+(:[a-z0-9-]+)+$/)
  .max(200)
export type ProductCatalogueId = z.infer<typeof ProductCatalogueId>

/** What a catalogue item is. A new pack that needs another kind adds it here. */
export const ProductCatalogueKind = z.enum(['gpu', 'cpu'])
export type ProductCatalogueKind = z.infer<typeof ProductCatalogueKind>

export const ProductCatalogueCodeKind = z.enum(['ean', 'cex_box'])
export type ProductCatalogueCodeKind = z.infer<typeof ProductCatalogueCodeKind>

/** Where an alias, negative context or code came from: a pack ID, or `admin`. */
export const ProductCatalogueSource = z
  .string()
  .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*(:[a-z][a-z0-9-]*)*$/)
  .max(100)
export type ProductCatalogueSource = z.infer<typeof ProductCatalogueSource>

/**
 * Suffix marking an alias row as a regex pattern source rather than literal text (services/
 * product-catalogue/README.md, "Decisions"). `aliases` has no separate pattern column; a pattern
 * row's `source` ends with this suffix instead.
 */
export const PRODUCT_CATALOGUE_PATTERN_SUFFIX = ':pattern'
export const isPatternSource = (source: string): boolean =>
  source.endsWith(PRODUCT_CATALOGUE_PATTERN_SUFFIX)

/** One row of `product_catalogue.v_items` (packages/db/src/schema/product-catalogue.ts). */
export const ProductCatalogueItem = z.strictObject({
  catalogueId: ProductCatalogueId,
  kind: ProductCatalogueKind,
  family: z.string().min(1).max(100).nullable(),
  variant: z.string().min(1).max(50).nullable(),
  isMobile: z.boolean(),
  packId: z.string().min(1).max(100).nullable(),
  name: z.string().min(1).max(200),
})
export type ProductCatalogueItem = z.infer<typeof ProductCatalogueItem>

/** One row of `product_catalogue.v_aliases`. */
export const ProductCatalogueAlias = z.strictObject({
  id: Uuid,
  catalogueId: ProductCatalogueId,
  alias: z.string().min(1).max(200),
  source: ProductCatalogueSource,
})
export type ProductCatalogueAlias = z.infer<typeof ProductCatalogueAlias>

/** One row of `product_catalogue.v_negative_contexts`: a pattern that blocks one catalogue ID. */
export const ProductCatalogueNegativeContext = z.strictObject({
  id: Uuid,
  pattern: z.string().min(1).max(200),
  blockedCatalogueId: ProductCatalogueId,
  source: ProductCatalogueSource,
})
export type ProductCatalogueNegativeContext = z.infer<typeof ProductCatalogueNegativeContext>

/** What an admin passes to add one catalogue item; audited (docs/design/modules/product-catalogue.md). */
export const ProductCatalogueAddItemInput = z.strictObject({
  actorUserId: Uuid,
  catalogueId: ProductCatalogueId,
  kind: ProductCatalogueKind,
  family: z.string().min(1).max(100).nullable().default(null),
  variant: z.string().min(1).max(50).nullable().default(null),
  isMobile: z.boolean().default(false),
  packId: z.string().min(1).max(100).nullable().default(null),
  name: z.string().min(1).max(200),
})
export type ProductCatalogueAddItemInput = z.infer<typeof ProductCatalogueAddItemInput>

export const ProductCatalogueAddAliasInput = z.strictObject({
  actorUserId: Uuid,
  catalogueId: ProductCatalogueId,
  alias: z.string().trim().min(1).max(200),
  source: ProductCatalogueSource,
})
export type ProductCatalogueAddAliasInput = z.infer<typeof ProductCatalogueAddAliasInput>

export const ProductCatalogueAddNegativeContextInput = z.strictObject({
  actorUserId: Uuid,
  pattern: z
    .string()
    .min(1)
    .max(200)
    .refine(
      (source) => {
        try {
          return Boolean(new RegExp(source, 'i'))
        } catch {
          return false
        }
      },
      { message: 'must compile as a JavaScript RegExp with the i flag' },
    ),
  blockedCatalogueId: ProductCatalogueId,
  source: ProductCatalogueSource,
})
export type ProductCatalogueAddNegativeContextInput = z.infer<
  typeof ProductCatalogueAddNegativeContextInput
>

export const ProductCatalogueAddCodeInput = z.strictObject({
  actorUserId: Uuid,
  catalogueId: ProductCatalogueId,
  kind: ProductCatalogueCodeKind,
  code: z.string().trim().min(1).max(50),
})
export type ProductCatalogueAddCodeInput = z.infer<typeof ProductCatalogueAddCodeInput>

/**
 * One resolved (or candidate) match from `resolve(text)`: `catalogueId` is null when a family
 * matched but the text does not state which variant (never a guess, docs/packs/gpu-pc.md).
 */
export const ProductCatalogueMatch = z.strictObject({
  family: z.string().min(1),
  catalogueId: ProductCatalogueId.nullable(),
  candidates: z.array(ProductCatalogueId),
  text: z.string(),
  index: z.number().int().nonnegative(),
})
export type ProductCatalogueMatch = z.infer<typeof ProductCatalogueMatch>

export const ProductCatalogueErrorCode = z.enum([
  'product-catalogue.invalid_input',
  'product-catalogue.unknown_item',
])
export type ProductCatalogueErrorCode = z.infer<typeof ProductCatalogueErrorCode>

/** The payload of `product-catalogue.updated`: catalogue IDs that were added or changed. */
export const ProductCatalogueUpdatedEvent = z.strictObject({
  catalogueIds: z.array(ProductCatalogueId).min(1).max(500),
})
export type ProductCatalogueUpdatedEvent = z.infer<typeof ProductCatalogueUpdatedEvent>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  /** Readers load the new items by ID. */
  'product-catalogue.updated': { 1: ProductCatalogueUpdatedEvent },
})
