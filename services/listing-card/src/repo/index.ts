// Database access. Own tables from '@nabvy/db/schema/listing-card'; other modules' data only through
// their v_ views (packages/db/README.md). User rows only inside withUser.

import { Uuid } from '@nabvy/contracts'
import { ListingCard } from '@nabvy/contracts/modules/listing-card'
import { vListingCard } from '@nabvy/db/schema/listing-card'
import { inArray } from 'drizzle-orm'
import { z } from 'zod'
import { chunk } from '../domain'

type Queryable = import('@nabvy/db').Queryable

/** Rule 9 of docs/design/modules/_rules.md: batches, never one query per listing, at most 500. */
const CARDS_FOR_BATCH_SIZE = 500

const iso = (value: Date | string | null): string | null =>
  value === null ? null : new Date(value).toISOString()

async function selectCards(q: Queryable, listingIds: string[]): Promise<ListingCard[]> {
  const rows = await q
    .select()
    .from(vListingCard)
    .where(inArray(vListingCard.listingId, listingIds))
  return rows.map((row) => ListingCard.parse({ ...row, listedAt: iso(row.listedAt) }))
}

/**
 * The visible cards for these listing IDs, in `app.v_listing_card`'s own row shape (module card,
 * "Outputs: its view"). A listing that is off-switch, suppressed or missing is simply absent from
 * the result, never an error: the caller (an oRPC procedure) shows nothing for it. Takes any number
 * of IDs, checked 500 at a time (as `listing_suppression.suppressed` does).
 */
export async function cardsFor(
  q: Queryable,
  listingIds: readonly string[],
): Promise<ListingCard[]> {
  const ids = z.array(Uuid).parse(listingIds)
  const out: ListingCard[] = []
  for (const batch of chunk([...new Set(ids)], CARDS_FOR_BATCH_SIZE)) {
    out.push(...(await selectCards(q, batch)))
  }
  return out
}
