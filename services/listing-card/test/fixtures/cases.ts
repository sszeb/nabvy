import { readFileSync } from 'node:fs'
import type { ListingCard } from '@nabvy/contracts/modules/listing-card'

export interface CardCase {
  id: string
  listing: {
    source: string
    title: string
    priceMinor: number
    currency: string
    townLabel: string
    availability: string
  }
  detail: { condition: string; descriptionStatus: string; staleFallback: boolean } | null
  suppressed?: boolean
  status?: string
  /** null: the card must not appear. Otherwise a partial match on the card's fields. */
  expected: Partial<ListingCard> | null
}

export const cases: CardCase[] = JSON.parse(
  readFileSync(new URL('./cases.json', import.meta.url), 'utf8'),
).cases
