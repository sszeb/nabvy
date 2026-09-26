// Database access: this module's own schema, asking_price_position, and the published views it
// reads as nabvy_pipeline inside withPipeline: asking-price-index's v_groups and v_members,
// listing-ingest's v_listings, detail-evidence's v_current, and
// listing_suppression.is_suppressed().
import { positions } from '@nabvy/db/schema/asking-price-position'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Member } from '../domain'

// A type query rather than a separate statement, as in asking-price-index: packages/db's
// conventions test reads each statement up to the next semicolon.
type Queryable = import('@nabvy/db').Queryable

const rowsOf = <T>(result: unknown): T[] => (result as { rows: T[] }).rows
const num = (v: string | number | null): number | null => (v === null ? null : Number(v))
const textArray = (values: string[]) =>
  sql`array[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`

/** Serialises position calls, so two deliveries never rewrite one group's positions at once. */
export async function lockPositions(q: Queryable): Promise<void> {
  await q.execute(sql`select pg_advisory_xact_lock(hashtextextended('asking-price-position', 0))`)
}

export interface GroupFigures {
  groupKey: string
  label: string
  currency: 'GBP' | 'EUR'
  n: number
  median: number | null
  mad: number | null
  p25: number | null
  p75: number | null
  asOf: Date
}

/** These groups' figures (asking-price-index `v_groups`); groups with no figures are left out. */
export async function selectGroups(
  q: Queryable,
  groupKeys: string[],
): Promise<Map<string, GroupFigures>> {
  if (groupKeys.length === 0) return new Map()
  const rows = rowsOf<{
    group_key: string
    label: string
    currency: 'GBP' | 'EUR'
    n: number
    median: string | number | null
    mad: string | number | null
    p25: string | number | null
    p75: string | number | null
    as_of: string | Date
  }>(
    await q.execute(sql`
      select g.group_key, g.label, g.currency, g.n, g.median, g.mad, g.p25, g.p75, g.as_of
      from asking_price_index.v_groups g
      where g.group_key = any(${textArray(groupKeys)}) and g.as_of is not null`),
  )
  return new Map(
    rows.map((r) => [
      r.group_key,
      {
        groupKey: r.group_key,
        label: r.label,
        currency: r.currency,
        n: Number(r.n),
        median: num(r.median),
        mad: num(r.mad),
        p25: num(r.p25),
        p75: num(r.p75),
        asOf: new Date(r.as_of),
      },
    ]),
  )
}

/** Every member of these groups (asking-price-index `v_members`). */
export async function selectMembers(
  q: Queryable,
  groupKeys: string[],
): Promise<(Member & { groupKey: string })[]> {
  if (groupKeys.length === 0) return []
  const rows = rowsOf<{
    group_key: string
    listing_id: string
    ask_minor: string | number
    counted: boolean
    excluded: string | null
  }>(
    await q.execute(sql`
      select m.group_key, m.listing_id, m.ask_minor, m.counted, m.excluded
      from asking_price_index.v_members m
      where m.group_key = any(${textArray(groupKeys)})
      order by m.group_key, m.listing_id`),
  )
  return rows.map((r) => ({
    groupKey: r.group_key,
    listingId: r.listing_id,
    askMinor: Number(r.ask_minor),
    counted: r.counted,
    excluded: r.excluded,
  }))
}

export interface ListingVersion {
  cardHash: string
  evidenceHash: string
}

/**
 * The current card and evidence hashes of these listings, for the replay key (rule 8). Listings
 * listing-ingest or detail-evidence does not hold (or holds while off), and suppressed listings,
 * are left out: no data reads as no position (rule 11).
 */
export async function selectVersions(
  q: Queryable,
  listingIds: string[],
): Promise<Map<string, ListingVersion>> {
  if (listingIds.length === 0) return new Map()
  const ids = sql`array[${sql.join(
    listingIds.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`
  const rows = rowsOf<{ listing_id: string; card_hash: string; evidence_hash: string }>(
    await q.execute(sql`
      select l.id as listing_id, l.card_hash, c.evidence_hash
      from listing_ingest.v_listings l
      join detail_evidence.v_current c on c.listing_id = l.id
      where l.id = any(${ids}) and not listing_suppression.is_suppressed(l.id)`),
  )
  return new Map(
    rows.map((r) => [r.listing_id, { cardHash: r.card_hash, evidenceHash: r.evidence_hash }]),
  )
}

export type PositionRow = typeof positions.$inferInsert & {
  listingId: string
  groupKey: string
}
export type StoredPosition = typeof positions.$inferSelect

/** The stored positions in these groups. */
export async function selectPositions(
  q: Queryable,
  groupKeys: string[],
): Promise<StoredPosition[]> {
  if (groupKeys.length === 0) return []
  return q.select().from(positions).where(inArray(positions.groupKey, groupKeys))
}

/** Writes one position (insert, or replace the listing's row in that group). */
export async function upsertPosition(q: Queryable, row: PositionRow): Promise<void> {
  const { listingId: _l, groupKey: _g, ...rest } = row
  await q
    .insert(positions)
    .values(row)
    .onConflictDoUpdate({ target: [positions.listingId, positions.groupKey], set: rest })
}

/** Removes one listing's position in one group. */
export async function deletePosition(
  q: Queryable,
  listingId: string,
  groupKey: string,
): Promise<void> {
  await q
    .delete(positions)
    .where(and(eq(positions.listingId, listingId), eq(positions.groupKey, groupKey)))
}

/** Removes every position of these listings (rule 12). Returns the listings that had one. */
export async function deletePositionsOf(q: Queryable, listingIds: string[]): Promise<string[]> {
  if (listingIds.length === 0) return []
  const removed = await q
    .delete(positions)
    .where(inArray(positions.listingId, listingIds))
    .returning({ listingId: positions.listingId })
  return [...new Set(removed.map((r) => r.listingId))]
}
