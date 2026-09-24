import { z } from 'zod'
import { DeliveryMethod, ListedAtPrecision, Source } from './enums'
import { Money } from './money'
import { IsoTimestamp } from './time'

/**
 * What a provider adapter returns per listing from a watch (docs/providers.md, "Stub fields
 * required"; docs/contracts.md, `ProviderAdapter.watch`), before the listing registry assigns an
 * ID, content hash and status. `raw` carries the provider's whole row, unredacted: actor data is
 * kept in full (docs/decisions.md, "Actor data kept in full"). Seller fields (`sellerId`, and
 * anything inside `raw`) are internal only and never reach a user-facing view.
 */
export const PriceKind = z.enum(['fixed', 'free', 'unknown', 'ambiguous'])
export type PriceKind = z.infer<typeof PriceKind>

export const ListingStub = z.strictObject({
  source: Source,
  /** The marketplace's own ID, as text: Facebook IDs exceed JavaScript's safe integers. */
  sourceListingId: z.string().min(1).max(200),
  url: z.url({ protocol: /^https$/ }),
  title: z.string(),
  /** Null unless the ask is a fixed or free price in GBP or EUR; `raw` keeps what was shown. */
  price: Money.nullable(),
  priceKind: PriceKind,
  locationText: z.string().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  thumbnailUrl: z.url().optional(),
  /** T0. */
  listedAt: IsoTimestamp.optional(),
  listedAtPrecision: ListedAtPrecision,
  /** T1: when the adapter received the row. */
  fetchedAt: IsoTimestamp,
  isSold: z.boolean().nullable().optional(),
  isPending: z.boolean().nullable().optional(),
  deliveryMethod: DeliveryMethod,
  categoryId: z.string().optional(),
  /** The marketplace's public seller ID. Internal only: never shown to users. */
  sellerId: z.string().optional(),
  /** The provider's full row, as received. */
  raw: z.unknown(),
})
export type ListingStub = z.infer<typeof ListingStub>
