// Database access. Own table from '@nabvy/db/schema/demand-signals'; other modules' data only
// through their v_ views, as nabvy_pipeline (packages/db/README.md). No user rows: nothing here
// runs inside withUser, and no query selects a user ID or a seller field.
import type { Queryable } from '@nabvy/db'
import { cells, vCells } from '@nabvy/db/schema/demand-signals'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { AdvertRow, CellDraft, WantTerm } from '../domain'

type Rows<T> = { rows: T[] }

/**
 * Takes the week's lock for the rest of the transaction, so two publishes of one week never
 * interleave: the second waits, then sees the first one's cells and writes nothing.
 */
export async function lockWeek(
  q: Queryable,
  weekStart: string,
  ruleVersion: string,
): Promise<void> {
  await q.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`demand-signals:${weekStart}@${ruleVersion}`}, 0))`,
  )
}

/** Whether any cell of the week and rule version is already stored. */
export async function weekPublished(
  q: Queryable,
  weekStart: string,
  ruleVersion: string,
): Promise<boolean> {
  const rows = await q
    .select({ id: cells.id })
    .from(cells)
    .where(and(eq(cells.weekStart, weekStart), eq(cells.ruleVersion, ruleVersion)))
    .limit(1)
  return rows.length > 0
}

/** want-manager's want counts per centre and family (active wants with a centre; no user ID). */
export async function selectWantTerms(q: Queryable): Promise<WantTerm[]> {
  const result = (await q.execute(sql`
    select t.centre_id, t.family, t.want_count
    from want_manager.v_want_terms_by_centre t
  `)) as unknown as Rows<{ centre_id: string; family: string; want_count: number | string }>
  return result.rows.map((r) => ({
    centreId: r.centre_id,
    family: r.family,
    wantCount: Number(r.want_count),
  }))
}

/**
 * The wanted or swap adverts first listed in [from, to): a listing whose latest assessment
 * carries parts-record's kind `wanted_or_swap` (listing_assessment.v_assessments), at the nearest
 * centre of its city page (city_pages.v_area_membership), once per family its confirmed parts
 * name. The family is the catalogue item's (product_catalogue.v_items), else the catalogue ID,
 * the same fallback want-manager's `v_want_terms_by_centre` uses, so the two meet in one cell.
 * The week is the listing's T0 (`listed_at`), else its T1 (`first_fetched_at`) when Facebook gave
 * no listing time. Each listing carries its copy-advert cluster (copy_advert.v_members, empty
 * while that module is off, so each advert then counts once on its own). Reads IDs, the city page
 * and parts only: no title, price or seller field.
 */
export async function selectAdverts(q: Queryable, from: Date, to: Date): Promise<AdvertRow[]> {
  const result = (await q.execute(sql`
    with latest as (
      select distinct on (a.listing_id) a.listing_id, a.kind, a.confirmed_parts
      from listing_assessment.v_assessments a
      order by a.listing_id, a.assessed_at desc
    ),
    wanted as (
      select l.id as listing_id, m.centre_id, x.confirmed_parts
      from latest x
      join listing_ingest.v_listings l on l.id = x.listing_id
      join city_pages.v_area_membership m on m.city_page_id = l.city_page_id
      where x.kind = 'wanted_or_swap'
        and m.centre_id is not null
        and coalesce(l.listed_at, l.first_fetched_at) >= ${from.toISOString()}::timestamptz
        and coalesce(l.listed_at, l.first_fetched_at) < ${to.toISOString()}::timestamptz
    )
    select w.listing_id::text as listing_id, w.centre_id,
           coalesce(i.family, p.part ->> 'catalogueId') as family,
           (select min(cm.cluster_key) from copy_advert.v_members cm
             where cm.listing_id = w.listing_id) as cluster_key
    from wanted w
    cross join lateral jsonb_array_elements(w.confirmed_parts) as p (part)
    left join product_catalogue.v_items i on i.catalogue_id = p.part ->> 'catalogueId'
    where p.part ->> 'catalogueId' is not null
    group by w.listing_id, w.centre_id, coalesce(i.family, p.part ->> 'catalogueId')
  `)) as unknown as Rows<{
    listing_id: string
    centre_id: string
    family: string
    cluster_key: string | null
  }>
  return result.rows.map((r) => ({
    listingId: r.listing_id,
    centreId: r.centre_id,
    family: r.family,
    clusterKey: r.cluster_key,
  }))
}

/** Inserts the week's cells; one already stored is skipped. Returns how many were written. */
export async function insertCells(
  q: Queryable,
  weekStart: string,
  ruleVersion: string,
  drafts: readonly CellDraft[],
): Promise<number> {
  let written = 0
  for (let i = 0; i < drafts.length; i += 500) {
    const inserted = await q
      .insert(cells)
      .values(drafts.slice(i, i + 500).map((d) => ({ ...d, weekStart, ruleVersion })))
      .onConflictDoNothing()
      .returning({ id: cells.id })
    written += inserted.length
  }
  return written
}

/** The week's cells from `v_cells` (empty while the module is off). */
export async function selectCells(q: Queryable, weekStart: string) {
  return q
    .select()
    .from(vCells)
    .where(eq(vCells.weekStart, weekStart))
    .orderBy(asc(vCells.centreId), asc(vCells.family), asc(vCells.ruleVersion))
}
