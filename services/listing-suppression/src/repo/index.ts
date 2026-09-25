// Database access: this module's own schema, listing_suppression, and the published views it
// reads: listing-ingest's v_listings and v_fingerprints and detail-evidence's v_fingerprints, as
// nabvy_pipeline inside withPipeline.

import type { ListingSuppressionNamedListing } from '@nabvy/contracts/modules/listing-suppression'
import { vFingerprints as vDescriptionFingerprints } from '@nabvy/db/schema/detail-evidence'
import { vFingerprints as vCardFingerprints, vListings } from '@nabvy/db/schema/listing-ingest'
import { entries } from '@nabvy/db/schema/listing-suppression'
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm'
import type { NewEntry } from '../domain'

// A type query rather than a separate statement, as in listing-ingest: packages/db's conventions
// test reads each statement up to the next semicolon.
type Queryable = import('@nabvy/db').Queryable

const rowsOf = <T>(result: unknown): T[] => (result as { rows: T[] }).rows

/** listing-ingest's listing IDs of the named listings found, by `source:sourceListingId`. */
export async function selectListingIds(
  q: Queryable,
  listings: readonly ListingSuppressionNamedListing[],
): Promise<Map<string, string>> {
  if (listings.length === 0) return new Map()
  const bySource = new Map<string, string[]>()
  for (const l of listings)
    bySource.set(l.source, [...(bySource.get(l.source) ?? []), l.sourceListingId])
  const rows = await q
    .select({
      id: vListings.id,
      source: vListings.source,
      sourceListingId: vListings.sourceListingId,
    })
    .from(vListings)
    .where(
      or(
        ...[...bySource].map(([source, ids]) =>
          and(eq(vListings.source, source), inArray(vListings.sourceListingId, ids)),
        ),
      ),
    )
  return new Map(rows.map((r) => [`${r.source}:${r.sourceListingId}`, r.id]))
}

/** Card fingerprints (title, price, city page) of these listings, from listing-ingest. */
export async function selectCardFingerprints(
  q: Queryable,
  listingIds: string[],
): Promise<string[]> {
  if (listingIds.length === 0) return []
  const rows = await q
    .select({ fingerprint: vCardFingerprints.fingerprint })
    .from(vCardFingerprints)
    .where(inArray(vCardFingerprints.listingId, listingIds))
    .orderBy(asc(vCardFingerprints.listingId))
  return rows.map((r) => r.fingerprint)
}

/** Current-description fingerprints of these listings, from detail-evidence. */
export async function selectDescriptionFingerprints(
  q: Queryable,
  listingIds: string[],
): Promise<string[]> {
  if (listingIds.length === 0) return []
  const rows = await q
    .select({ fingerprint: vDescriptionFingerprints.fingerprint })
    .from(vDescriptionFingerprints)
    .where(inArray(vDescriptionFingerprints.listingId, listingIds))
    .orderBy(asc(vDescriptionFingerprints.listingId))
  return rows.map((r) => r.fingerprint)
}

/** Inserts entries not stored for the request yet; an existing `(request, kind, value)` is kept. */
export async function insertEntries(
  q: Queryable,
  requestId: string,
  rows: readonly NewEntry[],
): Promise<number> {
  if (rows.length === 0) return 0
  const inserted = await q
    .insert(entries)
    .values(rows.map((e) => ({ ...e, requestId })))
    .onConflictDoNothing({ target: [entries.requestId, entries.kind, entries.value] })
    .returning({ id: entries.id })
  return inserted.length
}

/** Every entry ID of the request, oldest first. */
export async function selectEntryIds(q: Queryable, requestId: string): Promise<string[]> {
  const rows = await q
    .select({ id: entries.id })
    .from(entries)
    .where(eq(entries.requestId, requestId))
    .orderBy(asc(entries.id))
  return rows.map((r) => r.id)
}

/** The listings among these that `listing_suppression.is_suppressed()` hides now. */
export async function selectSuppressed(q: Queryable, listingIds: string[]): Promise<string[]> {
  if (listingIds.length === 0) return []
  const result = await q.execute(sql`
    select id::text as id
    from unnest(${`{${listingIds.join(',')}}`}::uuid[]) as t (id)
    where listing_suppression.is_suppressed(id)`)
  return rowsOf<{ id: string }>(result).map((r) => r.id)
}
