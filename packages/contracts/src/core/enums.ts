import { z } from 'zod'

/** Marketplaces and price sources (docs/contracts.md, "Enumerations"). */
export const Source = z.enum(['ebay', 'facebook', 'gumtree', 'vinted', 'cex'])
export type Source = z.infer<typeof Source>

export const DeliveryMethod = z.enum(['collection', 'posted', 'both', 'unknown'])
export type DeliveryMethod = z.infer<typeof DeliveryMethod>

/** How exactly `listedAt` is known: eBay and the Facebook actor give exact times. */
export const ListedAtPrecision = z.enum(['exact', 'minute', 'hour', 'day'])
export type ListedAtPrecision = z.infer<typeof ListedAtPrecision>
