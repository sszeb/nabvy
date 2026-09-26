import { Uuid } from '@nabvy/contracts'
import { withUser } from '@nabvy/db'
import { vPickupLocation } from '@nabvy/db/schema/pickup-location'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { userProcedure } from '../context'
import { selectListingCards } from './feed'

const GetListingInput = z.object({ listingId: Uuid })

/** One listing's card plus pickup-location's area, for the listing page (task L1). See
 * `feed.ts` for why this reads `app.v_listing_card` through `selectListingCards()` rather than
 * `cardsFor()`. */
export const getListing = userProcedure
  .input(GetListingInput)
  .handler(async ({ input, context }) => {
    return withUser(context.user.id, async (tx) => {
      const [card] = await selectListingCards(tx, sql`where listing_id = ${input.listingId}`)
      if (!card) return null
      const [pickup] = await tx
        .select({
          listingId: vPickupLocation.listingId,
          townOrArea: vPickupLocation.townOrArea,
          approximate: vPickupLocation.approximate,
          collection: vPickupLocation.collection,
          postage: vPickupLocation.postage,
        })
        .from(vPickupLocation)
        .where(eq(vPickupLocation.listingId, input.listingId))
      return { ...card, pickup: pickup ?? null }
    })
  })

/**
 * The prepared message (services/prepared-message, PR #70/w2, not merged when this task ran).
 * The module package does not exist on this branch, so this is the stub the task text asks for:
 * always `null`, behind the same procedure shape `build()` has (README.md: "build(q, listingId):
 * one listing's PreparedMessage, or null"). Swap for a call to `@nabvy/prepared-message` once it
 * merges. Recorded in docs/questions/L1-web.md.
 */
type PreparedMessageStub = {
  text: string
  checklist: Array<{ kind: 'ask' | 'check'; partType: string; text: string }>
}

export const getPreparedMessage = userProcedure
  .input(GetListingInput)
  .handler(async (): Promise<PreparedMessageStub | null> => null)

type WatchHistoryStub = { at: string; ask: { amountMinor: number; currency: 'GBP' | 'EUR' } }

/**
 * price-drop-watch (PR #70, in review, not merged when this task ran). No table exists yet to
 * store a watch, so this cannot honestly say a listing is watched: it reports `available: false`
 * rather than accepting a watch it cannot keep. Swap for `@nabvy/price-drop-watch`'s `watch()` /
 * `unwatch()` once it merges. Recorded in docs/questions/L1-web.md.
 */
export const getWatch = userProcedure.input(GetListingInput).handler(
  async (): Promise<{ available: boolean; watching: boolean; history: WatchHistoryStub[] }> => ({
    available: false,
    watching: false,
    history: [],
  }),
)

export const watchListing = userProcedure
  .input(GetListingInput)
  .handler(async () => ({ available: false as const }))

export const unwatchListing = userProcedure
  .input(GetListingInput)
  .handler(async () => ({ available: false as const }))
