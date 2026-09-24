// Pure logic of listing-ingest: read one actor row into card facts, hash the card, and decide
// what a batch of cards does to the stored listings. No I/O.
import { createHash } from 'node:crypto'
import type { Currency, Source } from '@nabvy/contracts'
import type {
  ListingIngestAvailability,
  ListingIngestSightingKind,
} from '@nabvy/contracts/modules/listing-ingest'

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Walks a path of object keys; anything missing or of the wrong type reads as undefined. */
function at(value: unknown, ...path: string[]): unknown {
  let current = value
  for (const key of path) {
    if (!isObject(current)) return undefined
    current = current[key]
  }
  return current
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null

/** IDs arrive as strings; a number is accepted only while it is a safe integer. */
const idText = (value: unknown): string | null => {
  if (typeof value === 'string' && /^\d+$/.test(value)) return value
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value)
  return null
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

const PRICED_CURRENCIES: readonly string[] = ['GBP', 'EUR']

/** A money object's amount, only for a `fixed` ask in GBP or EUR (actor-integration.md 2.7). */
export function askOf(money: unknown): { priceMinor: number; currency: Currency } | null {
  if (!isObject(money)) return null
  const { kind, currency, amountMinor } = money
  if (kind !== 'fixed') return null
  if (typeof currency !== 'string' || !PRICED_CURRENCIES.includes(currency)) return null
  if (typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    return null
  }
  return { priceMinor: amountMinor, currency: currency as Currency }
}

/** Folds the actor's `availability` flags: sold, then pending, then hidden, then live. */
export function availabilityOf(flags: unknown): ListingIngestAvailability {
  if (!isObject(flags)) return 'unknown'
  if (flags.sold === true) return 'sold'
  if (flags.pending === true) return 'pending'
  if (flags.hidden === true) return 'hidden'
  if (flags.live === true) return 'live'
  return 'unknown'
}

/**
 * The card's city page: `sourceFields.search.location.reverse_geocode.city_page.id` first, then
 * `locationDetails`, because after details `locationDetails` holds coordinates only.
 */
export function cityPageOf(row: Json): string | null {
  return (
    idText(at(row, 'sourceFields', 'search', 'location', 'reverse_geocode', 'city_page', 'id')) ??
    idText(at(row, 'locationDetails', 'reverse_geocode', 'city_page', 'id')) ??
    null
  )
}

/** The card's primary photo: the search card's `primary_listing_photo`, then the first photo. */
export function primaryPhotoOf(row: Json): string | null {
  const card = idText(at(row, 'sourceFields', 'search', 'primary_listing_photo', 'id'))
  if (card) return card
  const photos = row.photos
  return Array.isArray(photos) ? idText(at(photos[0], 'id')) : null
}

/** The Facebook city page a search URL is centred on (`/marketplace/<id>/search`). */
export function centreOfUrl(url: string | null): string | null {
  const match = url?.match(/\/marketplace\/(\d+)\/search/)
  return match?.[1] ?? null
}

/** Title normalisation for the card hash: NFKC, lower case, whitespace collapsed, trimmed. */
export function normaliseTitle(title: string): string {
  return title.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
}

export interface CardHashInput {
  title: string
  priceMinor: number | null
  currency: string | null
  availability: ListingIngestAvailability
  primaryPhotoId: string | null
}

/**
 * Rule 8: SHA-256 of the normalised title, `priceMinor`, currency, availability and primary photo
 * ID. Not the thumbnail URL: one photo ID arrives under two URLs in one recorded row.
 */
export function cardHash(card: CardHashInput): string {
  const parts = [
    normaliseTitle(card.title),
    card.priceMinor,
    card.currency,
    card.availability,
    card.primaryPhotoId,
  ]
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

/** The facts one `listing` row gives, in the shape of the module's tables. */
export interface Card {
  source: Source
  sourceListingId: string
  seq: number
  cardHash: string
  priceMinor: number | null
  currency: Currency | null
  moneyKind: string | null
  title: string
  listedAt: string | null
  seenAt: string
  cityPageId: string | null
  townLabel: string | null
  availability: ListingIngestAvailability
  categoryId: string | null
  deliveryTypes: string[]
  primaryPhotoId: string | null
  displayedPreviousMinor: number | null
  binding: string | null
  foundByTerms: string[]
  /** The search URL that returned the card (first of `sourceUrls`); null for details rows. */
  sourceUrl: string | null
}

const iso = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * Reads one stored actor row. Returns null for anything that is not a usable listing row: another
 * record type (`sourceOutcome`), or a row without a listing ID. `fallbackSeenAt` is the run's
 * collection time, used when the row carries none.
 */
export function readCard(item: unknown, seq: number, fallbackSeenAt: string): Card | null {
  if (!isObject(item) || item.recordType !== 'listing') return null
  const sourceListingId = idText(item.listingId)
  if (!sourceListingId) return null

  const ask = askOf(item.money)
  const title = text(item.title) ?? ''
  const availability = availabilityOf(item.availability)
  const primaryPhotoId = primaryPhotoOf(item)
  const sourceUrl = strings(item.sourceUrls)[0] ?? null
  const bindings = item.sourceBindings
  const binding =
    sourceUrl && isObject(bindings) ? text(bindings[sourceUrl]) : text(item.sourceBinding)
  const listedAt = typeof item.listedAt === 'number' ? iso(item.listedAt * 1000) : null
  const previous = at(item, 'displayedPreviousPrice')
  const previousMinor =
    isObject(previous) &&
    typeof previous.amountMinor === 'number' &&
    Number.isSafeInteger(previous.amountMinor) &&
    previous.amountMinor >= 0
      ? previous.amountMinor
      : null

  return {
    source: 'facebook',
    sourceListingId,
    seq,
    cardHash: cardHash({
      title,
      priceMinor: ask?.priceMinor ?? null,
      currency: ask?.currency ?? null,
      availability,
      primaryPhotoId,
    }),
    priceMinor: ask?.priceMinor ?? null,
    currency: ask?.currency ?? null,
    moneyKind: text(at(item, 'money', 'kind')),
    title,
    listedAt,
    seenAt: iso(item.collectedAt) ?? fallbackSeenAt,
    cityPageId: cityPageOf(item),
    townLabel: text(item.location),
    availability,
    categoryId: idText(item.categoryId),
    deliveryTypes: strings(item.deliveryTypes),
    primaryPhotoId,
    displayedPreviousMinor: previousMinor,
    binding,
    foundByTerms: strings(item.foundBySearchTerms),
    sourceUrl,
  }
}

/** A sighting to write for one card, before the listing ID is known. */
export interface Observation {
  sourceListingId: string
  seq: number
  kind: ListingIngestSightingKind
  term: string | null
  centreId: string | null
  rank: number | null
}

/**
 * One observation per card per run (question 4): the first row of each listing ID wins. A search
 * run gives `search` sightings ranked by row order within their search URL; a details run gives
 * `detail` observations with no term, centre or rank.
 */
export function observationsOf(
  cards: readonly Card[],
  runKind: 'search' | 'details',
): Observation[] {
  const seen = new Set<string>()
  const rankInUrl = new Map<string, number>()
  const out: Observation[] = []
  for (const card of [...cards].sort((a, b) => a.seq - b.seq)) {
    const urlKey = card.sourceUrl ?? ''
    const rank = (rankInUrl.get(urlKey) ?? 0) + 1
    rankInUrl.set(urlKey, rank)
    if (seen.has(card.sourceListingId)) continue
    seen.add(card.sourceListingId)
    out.push(
      runKind === 'search'
        ? {
            sourceListingId: card.sourceListingId,
            seq: card.seq,
            kind: 'search',
            term: card.foundByTerms[0] ?? null,
            centreId: centreOfUrl(card.sourceUrl),
            rank,
          }
        : {
            sourceListingId: card.sourceListingId,
            seq: card.seq,
            kind: 'detail',
            term: null,
            centreId: null,
            rank: null,
          },
    )
  }
  return out
}

/** The stored listing values a new card is compared with. */
export interface StoredCard {
  cardHash: string
  title: string
  primaryPhotoId: string | null
  lastSeenAt: string
}

/**
 * What a detail observation contributes: price, currency, money kind and availability only.
 * The card's title and primary photo stay, so a details fetch never changes them (fresh card
 * fields win), and the hash is recomputed over the stored title and photo.
 */
export function detailUpdate(card: Card, stored: StoredCard): Card {
  const merged = { ...card, title: stored.title, primaryPhotoId: stored.primaryPhotoId }
  return { ...merged, cardHash: cardHash(merged) }
}

/**
 * Whether a card replaces the stored values: it must be at least as recent as the last
 * observation (an older run replayed late never overwrites a newer card), and differ.
 */
export function isChange(card: Card, stored: StoredCard): boolean {
  return (
    card.cardHash !== stored.cardHash &&
    new Date(card.seenAt).getTime() >= new Date(stored.lastSeenAt).getTime()
  )
}

/** Splits IDs into event-sized batches (rule 7: at most 500 per event). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Event key for one job's batch: the job ID is the natural key (rule 8), plus the batch index. */
export function eventKey(type: string, jobId: number, index: number): string {
  return `${type}:${jobId}:${index}`
}
