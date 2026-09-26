import { withUser } from '@nabvy/db'
import { vPickupLocation } from '@nabvy/db/schema/pickup-location'
import { inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { userProcedure } from '../context'

/**
 * `app.v_listing_card` (services/listing-card, PR #81, not merged when this task ran). The
 * module package does not exist on this branch yet, so this queries the documented view by
 * name and shape (README.md, "Outputs") instead of calling `cardsFor()`. Once listing-card
 * merges, this raw query should be replaced by `cardsFor(q, listingIds)` — noted in
 * docs/questions/L1-web.md.
 */
export const ListingCardSchema = z.object({
  listingId: z.string(),
  link: z.string().nullable(),
  title: z.string(),
  priceMinor: z.coerce.number().int(),
  currency: z.string(),
  listedAt: z.coerce.date(),
  townLabel: z.string().nullable(),
  condition: z.string().nullable(),
  availability: z.string().nullable(),
  descriptionStatus: z.string().nullable(),
  possiblyOutdated: z.boolean(),
})
export type ListingCardRow = z.infer<typeof ListingCardSchema>

const FEED_LIMIT = 50

export type Tx = Parameters<Parameters<typeof withUser>[1]>[0]

/**
 * `app.v_listing_card` has no migration on this branch (listing-card, PR #81, has not merged),
 * so the view itself does not exist in the database yet — not just the module package. A bare
 * `select` would throw `relation "app.v_listing_card" does not exist` (Postgres `42P01`) on
 * every real request. Rather than write that migration (out of scope for this task per
 * CLAUDE.md, "No migrations from this task"), this catches exactly that error and degrades to
 * an empty feed, so the app stays usable while listing-card has not shipped. Recorded in
 * docs/questions/L1-web.md.
 */
export async function selectListingCards(tx: Tx, extra = sql``): Promise<ListingCardRow[]> {
  try {
    const result = await tx.execute(sql`
      select
        listing_id as "listingId", link, title, price_minor as "priceMinor", currency,
        listed_at as "listedAt", town_label as "townLabel", condition, availability,
        description_status as "descriptionStatus", possibly_outdated as "possiblyOutdated"
      from app.v_listing_card
      ${extra}
    `)
    return result.rows.map((row) => ListingCardSchema.parse(row))
  } catch (error) {
    if ((error as { code?: string }).code === '42P01') return []
    throw error
  }
}

async function fetchFeed(tx: Tx) {
  const cards = await selectListingCards(tx, sql`order by listed_at desc limit ${FEED_LIMIT}`)
  if (cards.length === 0) return []

  const pickup = await tx
    .select({
      listingId: vPickupLocation.listingId,
      townOrArea: vPickupLocation.townOrArea,
      approximate: vPickupLocation.approximate,
      collection: vPickupLocation.collection,
      postage: vPickupLocation.postage,
    })
    .from(vPickupLocation)
    .where(
      inArray(
        vPickupLocation.listingId,
        cards.map((c) => c.listingId),
      ),
    )
  const pickupByListing = new Map(pickup.map((row) => [row.listingId, row]))

  // Distance and rough time are not shown: neither `location`'s user-origin distance nor
  // `travel-time`/`router-gateway` is wired for this task (docs/questions/L1-web.md). Only
  // pickup-location's own town/area label reaches the card, per the task text ("numbers only";
  // there is no number to show yet).
  return cards.map((card) => ({
    ...card,
    pickup: pickupByListing.get(card.listingId) ?? null,
  }))
}

export type FeedItem = Awaited<ReturnType<typeof fetchFeed>>[number]

/**
 * The results feed for the local run (task L1). There is no `spec-match` module yet (not in the
 * atomic module catalogue's merged waves), so this cannot filter to a user's own wants: it shows
 * the most recently listed cards currently visible to every user, newest first, capped at
 * `FEED_LIMIT` (CLAUDE.md, "Batches, not items"). Recorded in docs/questions/L1-web.md.
 */
export const listFeed = userProcedure.handler(({ context }) => withUser(context.user.id, fetchFeed))
