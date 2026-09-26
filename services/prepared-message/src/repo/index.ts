// Database access. The module owns no tables; it reads listing-assessment's internal views
// v_assessments and v_unknowns as nabvy_pipeline (the only role granted them), both empty while
// listing-assessment is off.

import type { PartsRecordPartType } from '@nabvy/contracts/modules/parts-record'
import { vAssessments, vUnknowns } from '@nabvy/db/schema/listing-assessment'
import { and, inArray } from 'drizzle-orm'

// A type query rather than a separate statement, as in listing-assessment: packages/db's
// conventions test reads each statement up to the next semicolon.
type Queryable = import('@nabvy/db').Queryable

export interface VersionRow {
  listingId: string
  evidenceHash: string
  unknowns: PartsRecordPartType[]
  /** v_assessments.confirmed_parts, in the record's order (only the fields read here). */
  confirmed: { partType: PartsRecordPartType; quote: string }[]
}

type Confirmed = { partType?: unknown; quote?: unknown; seq?: unknown }

/**
 * For each listing, its latest assessed version (latest `assessed_at`, then evidence hash, so
 * the pick is stable), that version's unknowns and its confirmed parts. Listings with no
 * assessment are left out.
 */
export async function selectVersions(q: Queryable, listingIds: string[]): Promise<VersionRow[]> {
  if (listingIds.length === 0) return []
  const rows = await q
    .select({
      listingId: vAssessments.listingId,
      evidenceHash: vAssessments.evidenceHash,
      assessedAt: vAssessments.assessedAt,
      confirmedParts: vAssessments.confirmedParts,
    })
    .from(vAssessments)
    .where(inArray(vAssessments.listingId, listingIds))
  const latest = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    const seen = latest.get(row.listingId)
    const later =
      !seen ||
      new Date(row.assessedAt) > new Date(seen.assessedAt) ||
      (+new Date(row.assessedAt) === +new Date(seen.assessedAt) &&
        row.evidenceHash > seen.evidenceHash)
    if (later) latest.set(row.listingId, row)
  }
  if (latest.size === 0) return []

  const hashes = [...new Set([...latest.values()].map((r) => r.evidenceHash))]
  const unknownRows = await q
    .select({
      listingId: vUnknowns.listingId,
      evidenceHash: vUnknowns.evidenceHash,
      partType: vUnknowns.partType,
    })
    .from(vUnknowns)
    .where(
      and(
        inArray(vUnknowns.listingId, [...latest.keys()]),
        inArray(vUnknowns.evidenceHash, hashes),
      ),
    )

  return [...latest.values()].map((row) => ({
    listingId: row.listingId,
    evidenceHash: row.evidenceHash,
    unknowns: unknownRows
      .filter((u) => u.listingId === row.listingId && u.evidenceHash === row.evidenceHash)
      .map((u) => u.partType as PartsRecordPartType),
    confirmed: (Array.isArray(row.confirmedParts) ? (row.confirmedParts as Confirmed[]) : [])
      .filter((p) => typeof p.partType === 'string' && typeof p.quote === 'string')
      .sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0))
      .map((p) => ({ partType: p.partType as PartsRecordPartType, quote: p.quote as string })),
  }))
}
