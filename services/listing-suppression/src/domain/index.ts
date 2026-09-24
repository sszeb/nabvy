// Pure logic of the listing-suppression module: the listing hash, the entries a request asks for,
// look-alike expiry, batching and event keys. No I/O.
import { createHash } from 'node:crypto'
import type {
  ListingSuppressionBasis,
  ListingSuppressionKind,
  ListingSuppressionNamedListing,
} from '@nabvy/contracts/modules/listing-suppression'

/**
 * SHA-256 of `source:sourceListingId`, lowercase hex: how a named listing is stored. The same
 * function as `listing_suppression.listing_hash()` in SQL, which resolves it (a test checks both).
 */
export function listingHash(source: string, sourceListingId: string): string {
  return createHash('sha256').update(`${source}:${sourceListingId}`, 'utf8').digest('hex')
}

/** When a look-alike entry made at `now` stops matching: `days` later, to the millisecond. */
export function lookalikeExpiry(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
}

/** Whether an entry matches at `at`: look-alikes until they expire (exclusive), others always. */
export function isActive(expiresAt: Date | null, at: Date): boolean {
  return expiresAt === null || expiresAt.getTime() > at.getTime()
}

/** One entry to insert. `basis` and `expiresAt` are set on look-alikes only. */
export interface NewEntry {
  kind: ListingSuppressionKind
  basis: ListingSuppressionBasis | null
  value: string
  expiresAt: Date | null
}

/** Named listings with duplicates removed, in first-seen order. */
export function uniqueListings(
  listings: readonly ListingSuppressionNamedListing[],
): ListingSuppressionNamedListing[] {
  const seen = new Set<string>()
  return listings.filter((l) => {
    const key = `${l.source}:${l.sourceListingId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * The entries a request asks for: a hash of each named listing, each seller key as given, and a
 * look-alike entry for each fingerprint of a named listing found (card and description), expiring
 * `days` after `now`. Duplicates removed; order is stable, so a replay builds the same list.
 */
export function buildEntries(input: {
  listings: readonly ListingSuppressionNamedListing[]
  sellerKeys: readonly string[]
  cardFingerprints: readonly string[]
  descriptionFingerprints: readonly string[]
  now: Date
  days: number
}): NewEntry[] {
  const expiresAt = lookalikeExpiry(input.now, input.days)
  const out: NewEntry[] = []
  const seen = new Set<string>()
  const push = (entry: NewEntry) => {
    const key = `${entry.kind}:${entry.value}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(entry)
  }
  for (const l of uniqueListings(input.listings)) {
    push({
      kind: 'listing_hash',
      basis: null,
      value: listingHash(l.source, l.sourceListingId),
      expiresAt: null,
    })
  }
  for (const value of input.sellerKeys) {
    push({ kind: 'seller_key', basis: null, value, expiresAt: null })
  }
  for (const value of input.cardFingerprints) {
    push({ kind: 'lookalike', basis: 'card', value, expiresAt })
  }
  for (const value of input.descriptionFingerprints) {
    push({ kind: 'lookalike', basis: 'description', value, expiresAt })
  }
  return out
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * The `changed` event key: the request, the number of its entries (they only grow, so a retry
 * that adds look-alikes publishes anew) and the batch, so a replay publishes the same keys
 * (rule 8: natural ID plus its version).
 */
export const eventKey = (requestId: string, entries: number, batch: number) =>
  `listing-suppression.changed:${requestId}@${entries}:${batch}`
