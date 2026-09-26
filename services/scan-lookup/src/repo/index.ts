// Database access: this module's own schema, scan_lookup, and the published views it reads as
// nabvy_pipeline inside withPipeline: scan-recognition's v_scans (the identified catalogue item)
// and asking-price-index's v_groups (the Facebook asking-price figures).
import { vGroups } from '@nabvy/db/schema/asking-price-index'
import { lookups } from '@nabvy/db/schema/scan-lookup'
import { vScans } from '@nabvy/db/schema/scan-recognition'
import { and, eq } from 'drizzle-orm'
import type { GroupFigures } from '../domain'

type Queryable = import('@nabvy/db').Queryable

export interface ScanRow {
  id: string
  userId: string
  identified: string | null
  status: string
}

/** The scan-recognition scan this lookup prices, if any (a missing row reads as unidentified). */
export async function selectScan(q: Queryable, scanId: string): Promise<ScanRow | null> {
  const rows = await q
    .select({
      id: vScans.id,
      userId: vScans.userId,
      identified: vScans.identified,
      status: vScans.status,
    })
    .from(vScans)
    .where(eq(vScans.id, scanId))
    .limit(1)
  return rows[0] ?? null
}

/** Every asking-price-index group for this catalogue item, country and currency. */
export async function selectGroups(
  q: Queryable,
  catalogueId: string,
  country: string,
  currency: string,
): Promise<GroupFigures[]> {
  return q
    .select({
      context: vGroups.context,
      condition: vGroups.condition,
      currency: vGroups.currency,
      label: vGroups.label,
      n: vGroups.n,
      median: vGroups.median,
      p25: vGroups.p25,
      p75: vGroups.p75,
    })
    .from(vGroups)
    .where(
      and(
        eq(vGroups.catalogueId, catalogueId),
        eq(vGroups.country, country),
        eq(vGroups.currency, currency),
      ),
    ) as unknown as Promise<GroupFigures[]>
}

export interface LookupRow {
  scanId: string
  userId: string
  catalogueId: string
  status: string
  sources: string[]
  bands: unknown
  cost: number
  latencyMs: number
  at: Date
}

/** The stored lookup for this scan, if `lookup()` already priced it (rule 8: idempotency). */
export async function selectExisting(q: Queryable, scanId: string): Promise<LookupRow | null> {
  const rows = await q.select().from(lookups).where(eq(lookups.scanId, scanId)).limit(1)
  return rows[0] ?? null
}

/**
 * Writes a scan's lookup once. Returns `null` on a conflict (another delivery won the race), so
 * the caller re-reads `selectExisting` for the row to return — `lookup()`'s own idempotency, not
 * a second charge.
 */
export async function insertResult(
  q: Queryable,
  row: Omit<LookupRow, 'sources' | 'bands'> & { sources: string[]; bands: unknown },
): Promise<LookupRow | null> {
  const inserted = await q
    .insert(lookups)
    .values(row)
    .onConflictDoNothing({ target: lookups.scanId })
    .returning()
  return inserted[0] ?? null
}
