// Database access: this module's own schema, asking_price_index, and the published views it reads
// as nabvy_pipeline inside withPipeline: listing-ingest's v_listings and v_sightings,
// detail-evidence's v_current and v_text, listing-assessment's v_assessments, parts-record's
// v_parts, noise-filter's v_classifications, city-pages' v_centres, relist-merge's v_groups,
// copy-advert's v_members, product-catalogue's v_items and v_aliases, and
// listing_suppression.is_suppressed().
import type { AskingPriceIndexExclusion } from '@nabvy/contracts/modules/asking-price-index'
import { groups, members, stats } from '@nabvy/db/schema/asking-price-index'
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm'
import type { CatalogueItem, Figures, ListingFacts } from '../domain'

// A type query rather than a separate statement, as in relist-merge: packages/db's conventions
// test reads each statement up to the next semicolon.
type Queryable = import('@nabvy/db').Queryable

const rowsOf = <T>(result: unknown): T[] => (result as { rows: T[] }).rows

/** Serialises index calls, so two deliveries never recompute one group at once. */
export async function lockIndex(q: Queryable): Promise<void> {
  await q.execute(sql`select pg_advisory_xact_lock(hashtextextended('asking-price-index', 0))`)
}

interface FactsRow {
  listing_id: string
  price_minor: string | number | null
  currency: 'GBP' | 'EUR'
  money_kind: string | null
  availability: string
  binding: string | null
  city_page_id: string | null
  last_seen_at: string | Date
  card_hash: string
  found_by_terms: string[] | null
  title: string
  evidence_hash: string | null
  condition: string | null
  description: string | null
  form: string | null
  offered: string[] | null
  noise: boolean
  country: string | null
  relist_group: string | null
  copy_cluster: string | null
  suppressed: boolean
}

/**
 * The facts of these listings' current versions, one row each (listings listing-ingest does not
 * hold are left out). Other modules' views are empty while their switch is off, which reads here as
 * "no data": no parts means no group, no noise row means not noise, no relist group or copy cluster
 * means the listing counts on its own (rule 11).
 */
export async function selectFacts(q: Queryable, listingIds: string[]): Promise<ListingFacts[]> {
  if (listingIds.length === 0) return []
  const ids = sql`array[${sql.join(
    listingIds.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`
  const rows = rowsOf<FactsRow>(
    await q.execute(sql`
      select
        l.id as listing_id, l.price_minor, l.currency, l.money_kind, l.availability, l.binding,
        l.city_page_id, l.last_seen_at, l.card_hash, l.found_by_terms, l.title,
        c.evidence_hash, c.condition, t.description, a.form,
        array(
          select distinct p.catalogue_id from parts_record.v_parts p
          where p.listing_id = l.id and p.evidence_hash = c.evidence_hash
            and p.inclusion = 'offered' and not p.rejected and p.catalogue_id is not null
          order by p.catalogue_id
        ) as offered,
        exists (
          select 1 from noise_filter.v_classifications n
          where n.listing_id = l.id and n.evidence_hash = c.evidence_hash
            and jsonb_array_length(n.reasons) > 0
        ) as noise,
        coalesce(
          (select ce.country from city_pages.v_centres ce where ce.city_page_id = l.city_page_id),
          (select ce.country
             from listing_ingest.v_sightings s
             cross join lateral unnest(s.centre_ids) as found (centre_id)
             join city_pages.v_centres ce on ce.city_page_id = found.centre_id
            where s.listing_id = l.id
            order by s.seen_at desc, found.centre_id
            limit 1)
        ) as country,
        (select r.group_id::text from relist_merge.v_groups r where r.listing_id = l.id limit 1)
          as relist_group,
        (select min(m.cluster_key) from copy_advert.v_members m where m.listing_id = l.id)
          as copy_cluster,
        listing_suppression.is_suppressed(l.id) as suppressed
      from listing_ingest.v_listings l
      left join detail_evidence.v_current c on c.listing_id = l.id
      left join detail_evidence.v_text t
        on t.listing_id = l.id and t.evidence_hash = c.evidence_hash
      left join listing_assessment.v_assessments a
        on a.listing_id = l.id and a.evidence_hash = c.evidence_hash
      where l.id = any(${ids})
      order by l.id`),
  )
  return rows.map((r) => ({
    listingId: r.listing_id,
    priceMinor: r.price_minor === null ? null : Number(r.price_minor),
    currency: r.currency,
    moneyKind: r.money_kind,
    availability: r.availability,
    binding: r.binding,
    cityPageId: r.city_page_id,
    lastSeenAt: new Date(r.last_seen_at),
    cardHash: r.card_hash,
    foundByTerms: r.found_by_terms ?? [],
    title: r.title,
    evidenceHash: r.evidence_hash,
    condition: r.condition,
    description: r.description,
    form: r.form,
    offered: r.offered ?? [],
    noise: r.noise,
    country: r.country,
    relistGroup: r.relist_group,
    copyCluster: r.copy_cluster,
    suppressed: r.suppressed,
    promoted: false,
  }))
}

/** Names and aliases of these catalogue items (product-catalogue). */
export async function selectCatalogue(
  q: Queryable,
  catalogueIds: string[],
): Promise<Map<string, CatalogueItem>> {
  if (catalogueIds.length === 0) return new Map()
  const ids = sql`array[${sql.join(
    catalogueIds.map((id) => sql`${id}`),
    sql`, `,
  )}]::text[]`
  const rows = rowsOf<{ catalogue_id: string; name: string; aliases: string[] | null }>(
    await q.execute(sql`
      select i.catalogue_id, i.name,
        array(select a.alias from product_catalogue.v_aliases a
              where a.catalogue_id = i.catalogue_id order by a.alias) as aliases
      from product_catalogue.v_items i
      where i.catalogue_id = any(${ids})`),
  )
  return new Map(rows.map((r) => [r.catalogue_id, { name: r.name, aliases: r.aliases ?? [] }]))
}

export interface GroupRow {
  groupKey: string
  catalogueId: string
  context: string
  condition: string
  country: string
  currency: string
  windowDays: number
  label: string
}

/** Opens groups that do not exist yet; an existing group keeps its label. */
export async function upsertGroups(q: Queryable, rows: GroupRow[]): Promise<void> {
  if (rows.length === 0) return
  await q.insert(groups).values(rows).onConflictDoNothing({ target: groups.groupKey })
}

// Exclusions the group decides (collapse, one per seller key, fences), as opposed to the listing's own.
const GROUP_LEVEL = new Set(['stale', 'relist', 'copy', 'seller', 'outlier'])
// The table's check constraint holds `excluded` to AskingPriceIndexExclusion's values.
export const ownExclusion = (excluded: string | null): AskingPriceIndexExclusion | null =>
  excluded !== null && !GROUP_LEVEL.has(excluded) ? (excluded as AskingPriceIndexExclusion) : null

export interface MemberRow {
  groupKey: string
  listingId: string
  askMinor: number
  sampleOrigin: 'on_target' | 'by_catch'
  collapseKey: string
  cityPageId: string | null
  seenAt: Date
  cardHash: string
  evidenceHash: string
  counted: boolean
  excluded: string | null
}

/**
 * Writes the batch's memberships: upserts each (group, listing) row, and removes memberships of
 * batch listings in groups they no longer belong to. Returns the group keys whose member rows
 * changed or were removed.
 */
export async function writeMembers(
  q: Queryable,
  listingIds: string[],
  rows: MemberRow[],
): Promise<Set<string>> {
  const touched = new Set<string>()
  if (listingIds.length === 0) return touched
  const existing = await q
    .select()
    .from(members)
    .where(inArray(members.listingId, listingIds))
  const byKey = new Map(existing.map((m) => [`${m.groupKey}\u0000${m.listingId}`, m]))
  const wanted = new Set(rows.map((r) => `${r.groupKey}\u0000${r.listingId}`))
  for (const old of existing) {
    if (!wanted.has(`${old.groupKey}\u0000${old.listingId}`)) {
      touched.add(old.groupKey)
      await q
        .delete(members)
        .where(and(eq(members.groupKey, old.groupKey), eq(members.listingId, old.listingId)))
    }
  }
  for (const row of rows) {
    const old = byKey.get(`${row.groupKey}\u0000${row.listingId}`)
    if (
      old &&
      old.askMinor === row.askMinor &&
      old.sampleOrigin === row.sampleOrigin &&
      old.collapseKey === row.collapseKey &&
      old.cityPageId === row.cityPageId &&
      old.seenAt.getTime() === row.seenAt.getTime() &&
      old.cardHash === row.cardHash &&
      old.evidenceHash === row.evidenceHash &&
      // Counting is decided per group afterwards; only the listing's own exclusion is compared.
      ownExclusion(old.excluded) === row.excluded
    ) {
      continue
    }
    touched.add(row.groupKey)
    await q
      .insert(members)
      .values(row)
      .onConflictDoUpdate({
        target: [members.groupKey, members.listingId],
        set: {
          askMinor: row.askMinor,
          sampleOrigin: row.sampleOrigin,
          collapseKey: row.collapseKey,
          cityPageId: row.cityPageId,
          seenAt: row.seenAt,
          cardHash: row.cardHash,
          evidenceHash: row.evidenceHash,
          counted: row.counted,
          excluded: row.excluded,
        },
      })
  }
  return touched
}

/** Every member of these groups. */
export async function selectMembers(q: Queryable, groupKeys: string[]) {
  if (groupKeys.length === 0) return []
  return q.select().from(members).where(inArray(members.groupKey, groupKeys))
}

/** Sets `counted` and `excluded` where the group's decision changed them. */
export async function setOutcomes(
  q: Queryable,
  groupKey: string,
  outcomes: { listingId: string; counted: boolean; excluded: string | null }[],
): Promise<void> {
  for (const o of outcomes) {
    await q
      .update(members)
      .set({ counted: o.counted, excluded: o.excluded })
      .where(
        and(
          eq(members.groupKey, groupKey),
          eq(members.listingId, o.listingId),
          sql`(${members.counted}, ${members.excluded}) is distinct from (${o.counted}, ${o.excluded}::text)`,
        ),
      )
  }
}

export type StatsRow = Figures & { groupKey: string; copyCollapse: boolean; asOf: Date }

export async function selectStats(q: Queryable, groupKeys: string[]): Promise<Map<string, StatsRow>> {
  if (groupKeys.length === 0) return new Map()
  const rows = await q.select().from(stats).where(inArray(stats.groupKey, groupKeys))
  return new Map(rows.map((r) => [r.groupKey, r]))
}

export async function upsertStats(q: Queryable, row: StatsRow): Promise<void> {
  const { groupKey, ...rest } = row
  await q
    .insert(stats)
    .values(row)
    .onConflictDoUpdate({ target: stats.groupKey, set: rest })
}

/** Removes these listings from every group (rule 12). Returns the groups they were in. */
export async function deleteMembersOf(q: Queryable, listingIds: string[]): Promise<string[]> {
  if (listingIds.length === 0) return []
  const removed = await q
    .delete(members)
    .where(inArray(members.listingId, listingIds))
    .returning({ groupKey: members.groupKey })
  return [...new Set(removed.map((r) => r.groupKey))]
}

/** Groups left with no member at all, for cleanup. */
export async function deleteEmptyGroups(q: Queryable, groupKeys: string[]): Promise<void> {
  if (groupKeys.length === 0) return
  await q
    .delete(groups)
    .where(
      and(
        inArray(groups.groupKey, groupKeys),
        notInArray(
          groups.groupKey,
          q.select({ groupKey: members.groupKey }).from(members),
        ),
      ),
    )
}
