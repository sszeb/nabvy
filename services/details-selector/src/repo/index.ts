// Database access: this module's own schema, details_selector, and the published views it reads:
// listing-ingest's v_listings and city-pages' v_area_membership, as nabvy_pipeline inside
// withPipeline.
import { vAreaMembership } from '@nabvy/db/schema/city-pages'
import { selections } from '@nabvy/db/schema/details-selector'
import { vListings } from '@nabvy/db/schema/listing-ingest'
import { and, eq, inArray } from 'drizzle-orm'
import type { AreaFact, Candidate, Selection } from '../domain'

type Queryable = import('@nabvy/db').Queryable

/** listing-ingest's card facts for these listing UUIDs (missing ones — off, or not found — are left out). */
export async function selectCandidates(q: Queryable, listingIds: string[]): Promise<Candidate[]> {
  if (listingIds.length === 0) return []
  const rows = await q
    .select({
      source: vListings.source,
      sourceListingId: vListings.sourceListingId,
      cardHash: vListings.cardHash,
      cityPageId: vListings.cityPageId,
      categoryId: vListings.categoryId,
      deliveryTypes: vListings.deliveryTypes,
    })
    .from(vListings)
    .where(inArray(vListings.id, listingIds))
  return rows
}

/** city-pages' area membership for these city pages (missing ones — off, or unknown — are left out). */
export async function selectAreaFacts(
  q: Queryable,
  cityPageIds: string[],
): Promise<Map<string, AreaFact>> {
  const ids = [...new Set(cityPageIds)]
  if (ids.length === 0) return new Map()
  const rows = await q
    .select({
      cityPageId: vAreaMembership.cityPageId,
      centreId: vAreaMembership.centreId,
      inArea: vAreaMembership.inArea,
    })
    .from(vAreaMembership)
    .where(inArray(vAreaMembership.cityPageId, ids))
  return new Map(
    rows.map((row) => [row.cityPageId, { centreId: row.centreId, inArea: row.inArea }]),
  )
}

/** Writes the selections; returns only the ones newly written (rule 8: a replay writes nothing). */
export async function insertSelections(
  q: Queryable,
  rows: Selection[],
  selectedAt: Date,
): Promise<Selection[]> {
  if (rows.length === 0) return []
  const inserted = await q
    .insert(selections)
    .values(
      rows.map((row) => ({
        source: row.source,
        sourceListingId: row.sourceListingId,
        cardHash: row.cardHash,
        reason: row.reason,
        selectedAt,
      })),
    )
    .onConflictDoNothing({
      target: [selections.source, selections.sourceListingId, selections.cardHash],
    })
    .returning({
      source: selections.source,
      sourceListingId: selections.sourceListingId,
      cardHash: selections.cardHash,
      reason: selections.reason,
    })
  return inserted.map((row) => ({ ...row, reason: row.reason as Selection['reason'] }))
}

/** listing-ingest's (source, sourceListingId) pairs for these listing UUIDs (for `erase`). */
export async function selectSourceIdentities(
  q: Queryable,
  listingIds: string[],
): Promise<{ source: string; sourceListingId: string }[]> {
  if (listingIds.length === 0) return []
  return q
    .select({ source: vListings.source, sourceListingId: vListings.sourceListingId })
    .from(vListings)
    .where(inArray(vListings.id, listingIds))
}

/** Removes every selection of these (source, sourceListingId) pairs (rule 12: seller-rights erasure). */
export async function deleteSelectionsOf(
  q: Queryable,
  identities: { source: string; sourceListingId: string }[],
): Promise<number> {
  let removed = 0
  for (const { source, sourceListingId } of identities) {
    const rows = await q
      .delete(selections)
      .where(and(eq(selections.source, source), eq(selections.sourceListingId, sourceListingId)))
      .returning({ id: selections.id })
    removed += rows.length
  }
  return removed
}
