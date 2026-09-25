// Database access: this module's own schema, copy_advert, and the published views it reads
// (listing-ingest, detail-evidence, city-pages, listing-suppression), as nabvy_pipeline inside
// withPipeline. Cross-module joins are written as raw SQL, as listing-suppression's repo does for
// `is_suppressed()`: Drizzle's query builder does not join views across module schema files well,
// and these queries are internal-only (never exposed to a caller).
import type { Queryable } from '@nabvy/db'
import {
  accountChecks,
  candidateRequests,
  clusters,
  flags,
  links,
  members,
  overrides,
  photoMatches,
  prints,
  reports,
} from '@nabvy/db/schema/copy-advert'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'

const rowsOf = <T>(result: unknown): T[] => (result as { rows: T[] }).rows

/**
 * A Postgres array literal, for `= any(${pgArray(ids)}::uuid[])` casts in raw SQL: passing a JS
 * array straight into a `sql` template and casting it binds as a `record`, not an array (as
 * listing-suppression's own `selectSuppressed` found), so every value list is joined by hand.
 */
function pgArray(values: readonly string[]): string {
  return `{${values.map((v) => `"${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')}}`
}

// ---------------------------------------------------------------------------------------------
// Reading other modules' listings (S1 input)
// ---------------------------------------------------------------------------------------------

export interface ListingInputRow {
  listingId: string
  source: string
  sourceListingId: string
  cardHash: string
  title: string
  priceMinor: number | null
  currency: string | null
  moneyKind: string | null
  photoId: string | null
  cityPageId: string | null
  listedAt: Date | null
  lastSeenAt: Date
  evidenceHash: string
  descStatus: 'full_verified' | 'partial' | 'missing' | null
  description: string | null
}

/** listing-ingest's card plus detail-evidence's current version, for building a print (S1). */
export async function selectListingInputs(
  q: Queryable,
  listingIds: readonly string[],
): Promise<ListingInputRow[]> {
  if (listingIds.length === 0) return []
  const result = await q.execute(sql`
    select
      l.id as "listingId", l.source, l.source_listing_id as "sourceListingId", l.card_hash as "cardHash",
      l.title, l.price_minor as "priceMinor", l.currency, l.money_kind as "moneyKind",
      l.primary_photo_id as "photoId", l.city_page_id as "cityPageId", l.listed_at as "listedAt",
      l.last_seen_at as "lastSeenAt",
      coalesce(de.evidence_hash, '') as "evidenceHash", de.description_status as "descStatus", dt.description
    from listing_ingest.v_listings l
    left join detail_evidence.v_current de on de.listing_id = l.id
    left join detail_evidence.v_text dt on dt.listing_id = l.id and dt.evidence_hash = de.evidence_hash
    where l.id = any(${pgArray(listingIds)}::uuid[])`)
  // Raw `execute()` rows carry timestamps as strings, not Date objects (unlike the query
  // builder); every caller of this row expects a real Date for listedAt/lastSeenAt.
  return rowsOf<ListingInputRow>(result).map((r) => ({
    ...r,
    listedAt: r.listedAt ? new Date(r.listedAt) : null,
    lastSeenAt: new Date(r.lastSeenAt),
  }))
}

/** listing-ingest's `in_area` reachability is not published; area membership comes from city-pages. */
export async function selectInArea(
  q: Queryable,
  cityPageIds: readonly string[],
): Promise<Set<string>> {
  if (cityPageIds.length === 0) return new Set()
  const result = await q.execute(sql`
    select city_page_id as "cityPageId" from city_pages.v_area_membership
    where city_page_id = any(${pgArray(cityPageIds)}::text[]) and in_area`)
  return new Set(rowsOf<{ cityPageId: string }>(result).map((r) => r.cityPageId))
}

/** City pages' labels, for town grouping (docs 4.8). */
export async function selectCityPageLabels(
  q: Queryable,
  cityPageIds: readonly string[],
): Promise<
  Array<{ cityPageId: string; labels: string[]; lat: number | null; lng: number | null }>
> {
  if (cityPageIds.length === 0) return []
  const result = await q.execute(sql`
    select city_page_id as "cityPageId", towns as labels, lat, lng
    from city_pages.v_city_pages
    where city_page_id = any(${pgArray(cityPageIds)}::text[])`)
  return rowsOf(result)
}

/** The subset of these listings the suppression list hides now. */
export async function selectSuppressed(
  q: Queryable,
  listingIds: readonly string[],
): Promise<Set<string>> {
  if (listingIds.length === 0) return new Set()
  const result = await q.execute(sql`
    select id::text as id from unnest(${pgArray(listingIds)}::uuid[]) as t (id)
    where listing_suppression.is_suppressed(id)`)
  return new Set(rowsOf<{ id: string }>(result).map((r) => r.id))
}

// ---------------------------------------------------------------------------------------------
// Prints (S1)
// ---------------------------------------------------------------------------------------------

export interface NewPrint {
  listingId: string
  source: string
  sourceListingId: string
  cardHash: string
  evidenceHash: string
  ruleVersion: string
  titleNorm: string
  priceMinor: number | null
  currency: string | null
  advertFp: string | null
  descStatus: string | null
  descNorm: string | null
  descFp: string | null
  photoId: string | null
  cityPageId: string | null
  listedAt: Date | null
  lastSeenAt: Date
  inputT1: Date | null
  doneAt: Date
}

/**
 * Upserts one print. On a replay (same source, sourceListingId, cardHash, evidenceHash,
 * ruleVersion) nothing changes and the existing row's ID is returned. Every older print of the
 * same listing is marked not current.
 */
export async function upsertPrint(
  q: Queryable,
  print: NewPrint,
): Promise<{ id: string; isNew: boolean }> {
  const inserted = await q
    .insert(prints)
    .values(print)
    .onConflictDoNothing({
      target: [
        prints.source,
        prints.sourceListingId,
        prints.cardHash,
        prints.evidenceHash,
        prints.ruleVersion,
      ],
    })
    .returning({ id: prints.id })
  const insertedRow = inserted[0]
  if (insertedRow) {
    await q
      .update(prints)
      .set({ current: false })
      .where(and(eq(prints.listingId, print.listingId), sql`${prints.id} <> ${insertedRow.id}`))
    return { id: insertedRow.id, isNew: true }
  }
  const existing = await q
    .select({ id: prints.id })
    .from(prints)
    .where(
      and(
        eq(prints.source, print.source),
        eq(prints.sourceListingId, print.sourceListingId),
        eq(prints.cardHash, print.cardHash),
        eq(prints.evidenceHash, print.evidenceHash),
        eq(prints.ruleVersion, print.ruleVersion),
      ),
    )
    .limit(1)
  const existingRow = existing[0]
  if (!existingRow) throw new Error('upsertPrint: conflict with no matching row')
  return { id: existingRow.id, isNew: false }
}

export interface CurrentPrint {
  listingId: string
  sourceListingId: string
  advertFp: string | null
  descFp: string | null
  descNorm: string | null
  descStatus: string | null
  titleNorm: string
  photoId: string | null
  lastSeenAt: Date
}

/** Other current prints sharing this `advertFp`, within the window, excluding this listing (S2). */
export async function selectByAdvertFp(
  q: Queryable,
  advertFp: string,
  ruleVersion: string,
  excludeListingId: string,
  sinceDate: Date,
): Promise<CurrentPrint[]> {
  const rows = await q
    .select({
      listingId: prints.listingId,
      sourceListingId: prints.sourceListingId,
      advertFp: prints.advertFp,
      descFp: prints.descFp,
      descNorm: prints.descNorm,
      descStatus: prints.descStatus,
      titleNorm: prints.titleNorm,
      photoId: prints.photoId,
      lastSeenAt: prints.lastSeenAt,
    })
    .from(prints)
    .where(
      and(
        eq(prints.advertFp, advertFp),
        eq(prints.ruleVersion, ruleVersion),
        eq(prints.current, true),
        sql`${prints.listingId} <> ${excludeListingId}`,
        sql`${prints.lastSeenAt} >= ${sinceDate}`,
      ),
    )
  return rows
}

/** Other current prints sharing this `photoId`, excluding this listing (S6). */
export async function selectByPhotoId(
  q: Queryable,
  photoId: string,
  ruleVersion: string,
  excludeListingId: string,
): Promise<CurrentPrint[]> {
  const rows = await q
    .select({
      listingId: prints.listingId,
      sourceListingId: prints.sourceListingId,
      advertFp: prints.advertFp,
      descFp: prints.descFp,
      descNorm: prints.descNorm,
      descStatus: prints.descStatus,
      titleNorm: prints.titleNorm,
      photoId: prints.photoId,
      lastSeenAt: prints.lastSeenAt,
    })
    .from(prints)
    .where(
      and(
        eq(prints.photoId, photoId),
        eq(prints.ruleVersion, ruleVersion),
        eq(prints.current, true),
        sql`${prints.listingId} <> ${excludeListingId}`,
      ),
    )
  return rows
}

/** Current prints, any `advertFp`, whose description trigram-matches this one (S5). */
export async function selectTextCopyCandidates(
  q: Queryable,
  input: {
    descNorm: string
    ruleVersion: string
    excludeListingId: string
    threshold: number
    sinceDate: Date
  },
): Promise<CurrentPrint[]> {
  await q.execute(sql`
    select set_config('pg_trgm.similarity_threshold', ${input.threshold.toString()}, true)`)
  const result = await q.execute(sql`
    select listing_id as "listingId", source_listing_id as "sourceListingId", advert_fp as "advertFp",
           desc_fp as "descFp", desc_norm as "descNorm", desc_status as "descStatus",
           title_norm as "titleNorm", photo_id as "photoId", last_seen_at as "lastSeenAt"
    from copy_advert.prints
    where current and rule_version = ${input.ruleVersion}
      and listing_id <> ${input.excludeListingId}
      and desc_norm is not null
      and desc_norm % ${input.descNorm}::text
      and last_seen_at >= ${input.sinceDate}`)
  return rowsOf<CurrentPrint>(result)
}

/** pg_trgm similarity of two normalised descriptions, as the module's own SQL test verifies. */
export async function selectSimilarity(q: Queryable, a: string, b: string): Promise<number> {
  const result = await q.execute(sql`select similarity(${a}, ${b}) as sim`)
  return Number(rowsOf<{ sim: number }>(result)[0]?.sim ?? 0)
}

// ---------------------------------------------------------------------------------------------
// Links and photo matches
// ---------------------------------------------------------------------------------------------

export interface NewLink {
  listingA: string
  listingB: string
  basis: string
  similarity: number | null
  photoIdMatch: boolean
  ruleVersion: string
  decidedAt: Date
}

function ordered(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

export async function upsertLink(q: Queryable, link: NewLink): Promise<void> {
  const [listingA, listingB] = ordered(link.listingA, link.listingB)
  await q
    .insert(links)
    .values({ ...link, listingA, listingB })
    .onConflictDoUpdate({
      target: [links.listingA, links.listingB, links.ruleVersion],
      set: {
        basis: link.basis,
        similarity: link.similarity,
        photoIdMatch: link.photoIdMatch,
        decidedAt: link.decidedAt,
      },
    })
}

export async function upsertPhotoMatch(
  q: Queryable,
  input: {
    listingA: string
    listingB: string
    photoId: string
    ruleVersion: string
    foundAt: Date
  },
): Promise<void> {
  const [listingA, listingB] = ordered(input.listingA, input.listingB)
  await q
    .insert(photoMatches)
    .values({ ...input, listingA, listingB })
    .onConflictDoNothing({
      target: [photoMatches.listingA, photoMatches.listingB, photoMatches.ruleVersion],
    })
}

export async function markPhotoIdMatch(
  q: Queryable,
  listingA: string,
  listingB: string,
  ruleVersion: string,
): Promise<void> {
  const [a, b] = ordered(listingA, listingB)
  await q
    .update(links)
    .set({ photoIdMatch: true })
    .where(and(eq(links.listingA, a), eq(links.listingB, b), eq(links.ruleVersion, ruleVersion)))
}

/** Confirmed links (`exact_text`/`near_text`) touching any of these listings, for S8's closure. */
export async function selectConfirmedLinksTouching(
  q: Queryable,
  listingIds: readonly string[],
  ruleVersion: string,
): Promise<Array<{ listingA: string; listingB: string }>> {
  if (listingIds.length === 0) return []
  const rows = await q
    .select({ listingA: links.listingA, listingB: links.listingB })
    .from(links)
    .where(
      and(
        eq(links.ruleVersion, ruleVersion),
        sql`${links.basis} in ('exact_text', 'near_text')`,
        sql`(${links.listingA} = any(${pgArray(listingIds)}::uuid[]) or ${links.listingB} = any(${pgArray(listingIds)}::uuid[]))`,
      ),
    )
  return rows
}

// ---------------------------------------------------------------------------------------------
// Clusters, members, flags
// ---------------------------------------------------------------------------------------------

/** The active cluster key of each of these listings, if any. */
export async function selectActiveClusterKeys(
  q: Queryable,
  listingIds: readonly string[],
): Promise<Map<string, string>> {
  if (listingIds.length === 0) return new Map()
  const rows = await q
    .select({ listingId: members.listingId, clusterKey: members.clusterKey })
    .from(members)
    .where(and(inArray(members.listingId, [...listingIds]), isNull(members.leftAt)))
  return new Map(rows.map((r) => [r.listingId, r.clusterKey]))
}

/** Every listing that is an active member of some cluster (for `listing-suppression.changed`). */
export async function selectAllActiveMemberIds(q: Queryable): Promise<string[]> {
  const rows = await q
    .select({ listingId: members.listingId })
    .from(members)
    .where(isNull(members.leftAt))
  return rows.map((r) => r.listingId)
}

/** Every active member of these clusters, for recomputing facts (docs 4.8). */
export async function selectActiveMembers(
  q: Queryable,
  clusterKeys: readonly string[],
): Promise<
  Array<{
    clusterKey: string
    listingId: string
    sourceListingId: string
    cityPageId: string | null
  }>
> {
  if (clusterKeys.length === 0) return []
  return q
    .select({
      clusterKey: members.clusterKey,
      listingId: members.listingId,
      sourceListingId: members.sourceListingId,
      cityPageId: members.cityPageId,
    })
    .from(members)
    .where(and(inArray(members.clusterKey, [...clusterKeys]), isNull(members.leftAt)))
}

export async function closeMembership(
  q: Queryable,
  clusterKey: string,
  listingId: string,
  at: Date,
): Promise<void> {
  await q
    .update(members)
    .set({ leftAt: at })
    .where(and(eq(members.clusterKey, clusterKey), eq(members.listingId, listingId)))
}

export async function expireCluster(q: Queryable, clusterKey: string): Promise<void> {
  await q.update(clusters).set({ status: 'expired' }).where(eq(clusters.clusterKey, clusterKey))
}

export interface ClusterUpsert {
  clusterKey: string
  ruleVersion: string
  memberSetHash: string
  priceMinor: number | null
  currency: string | null
  listingCount: number
  townCount: number
  spanDays: number
  spreadKm: number | null
  massPosted: boolean
  asOf: Date
}

export async function upsertCluster(q: Queryable, c: ClusterUpsert): Promise<void> {
  await q
    .insert(clusters)
    .values({ ...c, status: 'active' })
    .onConflictDoUpdate({
      target: clusters.clusterKey,
      set: {
        memberSetHash: c.memberSetHash,
        priceMinor: c.priceMinor,
        currency: c.currency,
        listingCount: c.listingCount,
        townCount: c.townCount,
        spanDays: c.spanDays,
        spreadKm: c.spreadKm,
        massPosted: c.massPosted,
        status: 'active',
        asOf: c.asOf,
      },
    })
}

export async function upsertMember(
  q: Queryable,
  input: {
    clusterKey: string
    listingId: string
    sourceListingId: string
    cityPageId: string | null
    basis: string
    joinedAt: Date
  },
): Promise<void> {
  await q
    .insert(members)
    .values({ ...input, leftAt: null })
    .onConflictDoUpdate({
      target: [members.clusterKey, members.listingId],
      set: { basis: input.basis, leftAt: null, cityPageId: input.cityPageId },
    })
}

export interface FlagUpsert {
  listingId: string
  clusterKey: string
  towns: number
  spanDays: number
  wouldShow: boolean
  ruleVersion: string
  memberSetHash: string
}

export async function upsertFlag(q: Queryable, f: FlagUpsert): Promise<void> {
  await q
    .insert(flags)
    .values(f)
    .onConflictDoUpdate({
      target: flags.listingId,
      set: {
        clusterKey: f.clusterKey,
        towns: f.towns,
        spanDays: f.spanDays,
        wouldShow: f.wouldShow,
        ruleVersion: f.ruleVersion,
        memberSetHash: f.memberSetHash,
      },
    })
}

export async function deleteFlag(q: Queryable, listingId: string): Promise<void> {
  await q.delete(flags).where(eq(flags.listingId, listingId))
}

// ---------------------------------------------------------------------------------------------
// Candidate requests, overrides, reports
// ---------------------------------------------------------------------------------------------

export async function selectCandidateCountToday(
  q: Queryable,
  sinceMidnight: Date,
): Promise<number> {
  const result = await q.execute(sql`
    select count(*)::int as n from copy_advert.candidate_requests where requested_at >= ${sinceMidnight}`)
  return Number(rowsOf<{ n: number }>(result)[0]?.n ?? 0)
}

export async function alreadyRequested(
  q: Queryable,
  listingIds: readonly string[],
): Promise<Set<string>> {
  if (listingIds.length === 0) return new Set()
  const rows = await q
    .select({ listingId: candidateRequests.listingId })
    .from(candidateRequests)
    .where(inArray(candidateRequests.listingId, [...listingIds]))
  return new Set(rows.map((r) => r.listingId))
}

export async function insertCandidateRequest(
  q: Queryable,
  input: { listingId: string; advertFp: string; requestedAt: Date },
): Promise<void> {
  await q
    .insert(candidateRequests)
    .values(input)
    .onConflictDoNothing({ target: candidateRequests.listingId })
}

export async function selectOverrides(
  q: Queryable,
): Promise<Array<{ kind: string; listingA: string | null; listingB: string | null }>> {
  return q
    .select({ kind: overrides.kind, listingA: overrides.listingA, listingB: overrides.listingB })
    .from(overrides)
}

export async function insertOverride(
  q: Queryable,
  input: {
    kind: string
    listingA: string | null
    listingB: string | null
    reason: string
    auditId: string
    at: Date
  },
): Promise<void> {
  await q.insert(overrides).values(input)
}

export async function insertReport(
  q: Queryable,
  input: { userId: string; listingId: string; reason: string; at: Date },
): Promise<{ inserted: boolean }> {
  const rows = await q
    .insert(reports)
    .values(input)
    .onConflictDoNothing({ target: [reports.userId, reports.listingId] })
    .returning({ id: reports.id })
  return { inserted: rows.length > 0 }
}

// ---------------------------------------------------------------------------------------------
// Erasure and expiry
// ---------------------------------------------------------------------------------------------

export async function eraseListings(q: Queryable, listingIds: readonly string[]): Promise<void> {
  if (listingIds.length === 0) return
  const ids = [...listingIds]
  await q.delete(prints).where(inArray(prints.listingId, ids))
  await q
    .delete(links)
    .where(
      sql`${links.listingA} = any(${pgArray(ids)}::uuid[]) or ${links.listingB} = any(${pgArray(ids)}::uuid[])`,
    )
  await q
    .delete(photoMatches)
    .where(
      sql`${photoMatches.listingA} = any(${pgArray(ids)}::uuid[]) or ${photoMatches.listingB} = any(${pgArray(ids)}::uuid[])`,
    )
  await q.delete(members).where(inArray(members.listingId, ids))
  await q.delete(flags).where(inArray(flags.listingId, ids))
  await q.delete(candidateRequests).where(inArray(candidateRequests.listingId, ids))
  await q
    .delete(overrides)
    .where(
      sql`${overrides.listingA} = any(${pgArray(ids)}::uuid[]) or ${overrides.listingB} = any(${pgArray(ids)}::uuid[])`,
    )
  await q.delete(reports).where(inArray(reports.listingId, ids))
}

export async function deleteReportsForUser(q: Queryable, userId: string): Promise<void> {
  await q.delete(reports).where(eq(reports.userId, userId))
}

/** Active members whose listing has not been seen within the window (daily expiry, docs 4.8). */
export async function selectExpiredMembers(
  q: Queryable,
  cutoff: Date,
): Promise<Array<{ clusterKey: string; listingId: string }>> {
  const result = await q.execute(sql`
    select m.cluster_key as "clusterKey", m.listing_id as "listingId"
    from copy_advert.members m
    join listing_ingest.v_listings l on l.id = m.listing_id
    where m.left_at is null and l.last_seen_at < ${cutoff}`)
  return rowsOf(result)
}

export { accountChecks }
