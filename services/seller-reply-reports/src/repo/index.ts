// Database access to the seller_reply_reports schema, and the default reads of other modules'
// views and functions (the `defaultDeps` in ../index.ts). User writes run as nabvy_app inside
// withUser, where row-level security limits every statement to the caller's own reports; the
// aggregator, resolve(), the purge and erase() run as nabvy_pipeline
// (packages/db/migrations/seller-reply-reports/*_access.sql).
import type { Queryable } from '@nabvy/db'
import { sql } from 'drizzle-orm'
import type { StoredReason } from '../domain'

const rowsOf = <T>(result: unknown): T[] => (result as { rows: T[] }).rows

/** A Postgres array literal for `= any(...::uuid[])` (the copy-advert repo's helper, same reason). */
function pgArray(values: readonly string[]): string {
  return `{${values.map((v) => `"${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')}}`
}

const toDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)))
const toDateOrNull = (v: unknown): Date | null => (v === null || v === undefined ? null : toDate(v))

// ---------------------------------------------------------------------------------------------
// The caller's own reports (nabvy_app, inside withUser)
// ---------------------------------------------------------------------------------------------

export interface OwnReport {
  id: string
  source: string
  listingId: string
  status: string
  createdAt: Date
  withdrawnAt: Date | null
}

export async function selectOwnReports(
  q: Queryable,
  where: { ids?: string[]; listingIds?: string[] },
): Promise<OwnReport[]> {
  const filter = where.ids
    ? sql`id = any(${pgArray(where.ids)}::uuid[])`
    : sql`listing_id = any(${pgArray(where.listingIds ?? [])}::uuid[])`
  const rows = rowsOf<Record<string, unknown>>(
    await q.execute(sql`
      select id, source, listing_id, status, created_at, withdrawn_at
      from seller_reply_reports.reports where ${filter}`),
  )
  return rows.map((r) => ({
    id: String(r.id),
    source: String(r.source),
    listingId: String(r.listing_id),
    status: String(r.status),
    createdAt: toDate(r.created_at),
    withdrawnAt: toDateOrNull(r.withdrawn_at),
  }))
}

export async function isTester(q: Queryable, userId: string): Promise<boolean> {
  const rows = rowsOf<{ n: number }>(
    await q.execute(
      sql`select count(*)::int as n from seller_reply_reports.testers where user_id = ${userId}::uuid`,
    ),
  )
  return (rows[0]?.n ?? 0) > 0
}

/** Suppression through the SECURITY DEFINER predicate granted to nabvy_app (rule 5). */
export async function suppressedOf(q: Queryable, listingIds: string[]): Promise<Set<string>> {
  if (listingIds.length === 0) return new Set()
  const rows = rowsOf<{ id: string }>(
    await q.execute(sql`
      select id::text as id from unnest(${pgArray(listingIds)}::uuid[]) as id
      where listing_suppression.is_suppressed(id)`),
  )
  return new Set(rows.map((r) => r.id))
}

export interface NewReport {
  source: string
  listingId: string
  reporterUserId: string
  cardHash: string | null
  evidenceHash: string | null
  openVia: string | null
  firstOpenedAt: Date | null
  shippingOffered: boolean | null
  checkoutEnabled: boolean | null
  messagingEnabled: boolean | null
  ruleVersion: string
}

/** Inserts the report unless the user already reported this listing (one per user per listing). */
export async function insertReport(
  q: Queryable,
  r: NewReport,
): Promise<{ id: string; created: boolean }> {
  const inserted = rowsOf<{ id: string }>(
    await q.execute(sql`
      insert into seller_reply_reports.reports
        (source, listing_id, reporter_user_id, card_hash, evidence_hash, open_via, first_opened_at,
         listing_shipping_offered, listing_checkout_enabled, listing_messaging_enabled, rule_version)
      values (${r.source}, ${r.listingId}::uuid, ${r.reporterUserId}::uuid, ${r.cardHash}, ${r.evidenceHash},
        ${r.openVia}, ${r.firstOpenedAt ? r.firstOpenedAt.toISOString() : null}::timestamptz,
        ${r.shippingOffered}, ${r.checkoutEnabled}, ${r.messagingEnabled}, ${r.ruleVersion})
      on conflict (listing_id, reporter_user_id) do nothing
      returning id`),
  )
  if (inserted[0]) return { id: String(inserted[0].id), created: true }
  const [existing] = await selectOwnReports(q, { listingIds: [r.listingId] })
  if (!existing) throw new Error('report insert conflicted but no own row is visible')
  return { id: existing.id, created: false }
}

export async function replaceReasons(
  q: Queryable,
  reportId: string,
  reasons: StoredReason[],
): Promise<void> {
  await q.execute(
    sql`delete from seller_reply_reports.report_reasons where report_id = ${reportId}::uuid`,
  )
  for (const r of reasons) {
    await q.execute(sql`
      insert into seller_reply_reports.report_reasons (report_id, reason, detail, second_answer, reported_place_id)
      values (${reportId}::uuid, ${r.reason}, ${r.detail}, ${r.secondAnswer}, ${r.reportedPlaceId})`)
  }
}

export async function markWithdrawn(q: Queryable, reportId: string, now: Date): Promise<void> {
  await q.execute(sql`
    update seller_reply_reports.reports
    set status = 'withdrawn', withdrawn_at = ${now.toISOString()}::timestamptz
    where id = ${reportId}::uuid and withdrawn_at is null`)
}

// ---------------------------------------------------------------------------------------------
// The aggregator's reads and writes (nabvy_pipeline)
// ---------------------------------------------------------------------------------------------

export interface ReasonRow extends StoredReason {
  distanceBand: string | null
  counts: string | null
}

export interface ReportRow {
  id: string
  source: string
  listingId: string
  reporterUserId: string
  createdAt: Date
  withdrawnAt: Date | null
  eligibility: string
  weight: number
  weightAtSubmit: number | null
  status: string
  outcome: string | null
  outcomeBy: string | null
  shippingOffered: boolean | null
  reasons: ReasonRow[]
  /** The reporter's other reports made in the hour and the day before this one (rate limits). */
  priorHour: number
  priorDay: number
}

export async function selectReportsOn(q: Queryable, listingIds: string[]): Promise<ReportRow[]> {
  if (listingIds.length === 0) return []
  const rows = rowsOf<Record<string, unknown>>(
    await q.execute(sql`
      select r.id, r.source, r.listing_id, r.reporter_user_id, r.created_at, r.withdrawn_at,
        r.eligibility, r.weight, r.weight_at_submit, r.status, r.outcome, r.outcome_by,
        r.listing_shipping_offered,
        (select count(*)::int from seller_reply_reports.reports p
          where p.reporter_user_id = r.reporter_user_id and p.id <> r.id
            and p.created_at <= r.created_at and p.created_at > r.created_at - interval '1 hour') as prior_hour,
        (select count(*)::int from seller_reply_reports.reports p
          where p.reporter_user_id = r.reporter_user_id and p.id <> r.id
            and p.created_at <= r.created_at and p.created_at > r.created_at - interval '1 day') as prior_day,
        coalesce((select json_agg(json_build_object(
            'reason', rr.reason, 'detail', rr.detail, 'secondAnswer', rr.second_answer,
            'reportedPlaceId', rr.reported_place_id, 'distanceBand', rr.distance_band, 'counts', rr.counts)
            order by rr.reason)
          from seller_reply_reports.report_reasons rr where rr.report_id = r.id), '[]'::json) as reasons
      from seller_reply_reports.reports r
      where r.listing_id = any(${pgArray(listingIds)}::uuid[])
      order by r.created_at, r.id`),
  )
  return rows.map((r) => ({
    id: String(r.id),
    source: String(r.source),
    listingId: String(r.listing_id),
    reporterUserId: String(r.reporter_user_id),
    createdAt: toDate(r.created_at),
    withdrawnAt: toDateOrNull(r.withdrawn_at),
    eligibility: String(r.eligibility),
    weight: Number(r.weight),
    weightAtSubmit: r.weight_at_submit === null ? null : Number(r.weight_at_submit),
    status: String(r.status),
    outcome: (r.outcome as string | null) ?? null,
    outcomeBy: (r.outcome_by as string | null) ?? null,
    shippingOffered: (r.listing_shipping_offered as boolean | null) ?? null,
    reasons: (typeof r.reasons === 'string' ? JSON.parse(r.reasons) : r.reasons) as ReasonRow[],
    priorHour: Number(r.prior_hour),
    priorDay: Number(r.prior_day),
  }))
}

export async function selectReportListings(
  q: Queryable,
  where: { reportIds?: string[]; userIds?: string[] },
): Promise<string[]> {
  const filter = where.reportIds
    ? sql`id = any(${pgArray(where.reportIds)}::uuid[])`
    : sql`reporter_user_id = any(${pgArray(where.userIds ?? [])}::uuid[])`
  const rows = rowsOf<{ listing_id: string }>(
    await q.execute(
      sql`select distinct listing_id::text as listing_id from seller_reply_reports.reports where ${filter}`,
    ),
  )
  return rows.map((r) => r.listing_id)
}

export interface ReporterRecord {
  tester: boolean
  upheld: number
  notUpheld: number
}

export async function selectReporterRecords(
  q: Queryable,
  userIds: string[],
): Promise<Map<string, ReporterRecord>> {
  const out = new Map<string, ReporterRecord>()
  if (userIds.length === 0) return out
  const rows = rowsOf<Record<string, unknown>>(
    await q.execute(sql`
      select u.id::text as user_id,
        exists (select 1 from seller_reply_reports.testers t where t.user_id = u.id) as tester,
        coalesce(s.upheld, 0) as upheld, coalesce(s.not_upheld, 0) as not_upheld
      from unnest(${pgArray(userIds)}::uuid[]) as u(id)
      left join seller_reply_reports.reporter_stats s on s.user_id = u.id`),
  )
  for (const r of rows) {
    out.set(String(r.user_id), {
      tester: Boolean(r.tester),
      upheld: Number(r.upheld),
      notUpheld: Number(r.not_upheld),
    })
  }
  return out
}

export interface ReportUpdate {
  id: string
  eligibility: string
  weight: number
  weightAtSubmit: number | null
  status: string
  outcome: string | null
  outcomeBy: string | null
}

export async function updateReport(q: Queryable, u: ReportUpdate): Promise<void> {
  await q.execute(sql`
    update seller_reply_reports.reports
    set eligibility = ${u.eligibility}, weight = ${u.weight}, weight_at_submit = ${u.weightAtSubmit},
      status = ${u.status}, outcome = ${u.outcome}, outcome_by = ${u.outcomeBy}
    where id = ${u.id}::uuid`)
}

export async function updateReason(
  q: Queryable,
  reportId: string,
  reason: string,
  values: { distanceBand: string | null; counts: string },
): Promise<void> {
  await q.execute(sql`
    update seller_reply_reports.report_reasons
    set distance_band = ${values.distanceBand}, counts = ${values.counts}
    where report_id = ${reportId}::uuid and reason = ${reason}`)
}

export interface EvidenceRow {
  source: string
  listingId: string
  family: string
  scope: string
  persons: number
  weightSum: number
  counterWeight: number
  level: string
  placeId: string | null
  distanceBand: string | null
  held: boolean
  holdReason: string | null
  inputsHash: string
  ruleVersion: string
  t1FetchedAt: Date | null
}

/** The current inputs hash of every evidence row on these listings, keyed `listing|family|scope`. */
export async function selectEvidenceHashes(
  q: Queryable,
  listingIds: string[],
  ruleVersion: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (listingIds.length === 0) return out
  const rows = rowsOf<Record<string, string>>(
    await q.execute(sql`
      select listing_id::text as listing_id, family, scope, inputs_hash
      from seller_reply_reports.listing_evidence
      where listing_id = any(${pgArray(listingIds)}::uuid[]) and rule_version = ${ruleVersion}`),
  )
  for (const r of rows) out.set(`${r.listing_id}|${r.family}|${r.scope}`, String(r.inputs_hash))
  return out
}

export async function upsertEvidence(q: Queryable, e: EvidenceRow, now: Date): Promise<void> {
  await q.execute(sql`
    insert into seller_reply_reports.listing_evidence
      (source, listing_id, family, scope, persons, weight_sum, counter_weight, level, place_id,
       distance_band, held, hold_reason, carried_from_relist, inputs_hash, rule_version, as_of,
       t1_fetched_at, done_at)
    values (${e.source}, ${e.listingId}::uuid, ${e.family}, ${e.scope}, ${e.persons}, ${e.weightSum},
      ${e.counterWeight}, ${e.level}, ${e.placeId}, ${e.distanceBand}, ${e.held}, ${e.holdReason}, false,
      ${e.inputsHash}, ${e.ruleVersion}, ${now.toISOString()}::timestamptz,
      ${e.t1FetchedAt ? e.t1FetchedAt.toISOString() : null}::timestamptz, ${now.toISOString()}::timestamptz)
    on conflict (source, listing_id, family, scope, rule_version) do update set
      persons = excluded.persons, weight_sum = excluded.weight_sum,
      counter_weight = excluded.counter_weight, level = excluded.level, place_id = excluded.place_id,
      distance_band = excluded.distance_band, held = excluded.held, hold_reason = excluded.hold_reason,
      inputs_hash = excluded.inputs_hash, as_of = excluded.as_of,
      t1_fetched_at = excluded.t1_fetched_at, done_at = excluded.done_at
    where seller_reply_reports.listing_evidence.inputs_hash is distinct from excluded.inputs_hash`)
}

/** Opens a hold unless one is already open for this scope and reason. */
export async function openHold(
  q: Queryable,
  source: string,
  scopeKey: string,
  reason: string,
  now: Date,
): Promise<void> {
  await q.execute(sql`
    insert into seller_reply_reports.holds (source, scope_key, reason, opened_at)
    values (${source}, ${scopeKey}, ${reason}, ${now.toISOString()}::timestamptz)
    on conflict (scope_key, reason) where released_at is null do nothing`)
}

export async function setOutcomes(
  q: Queryable,
  reportIds: string[],
  outcome: string,
  by: string,
): Promise<string[]> {
  const rows = rowsOf<{ id: string }>(
    await q.execute(sql`
      update seller_reply_reports.reports set outcome = ${outcome}, outcome_by = ${by}
      where id = any(${pgArray(reportIds)}::uuid[])
        and (outcome is distinct from ${outcome} or outcome_by is distinct from ${by})
      returning id::text as id`),
  )
  return rows.map((r) => r.id)
}

export async function voidReportsOf(q: Queryable, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return []
  const rows = rowsOf<{ id: string }>(
    await q.execute(sql`
      update seller_reply_reports.reports set outcome = 'void', outcome_by = 'ban'
      where reporter_user_id = any(${pgArray(userIds)}::uuid[])
        and (outcome is distinct from 'void' or outcome_by is distinct from 'ban')
      returning id::text as id`),
  )
  return rows.map((r) => r.id)
}

/** Recounts reporter_stats from the reports' outcomes: idempotent whatever ran before. */
export async function recountStats(q: Queryable, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return
  await q.execute(sql`
    insert into seller_reply_reports.reporter_stats (user_id, upheld, not_upheld, voided, last_report_at)
    select r.reporter_user_id,
      count(*) filter (where r.outcome = 'upheld'),
      count(*) filter (where r.outcome = 'not_upheld'),
      count(*) filter (where r.outcome = 'void'),
      max(r.created_at)
    from seller_reply_reports.reports r
    where r.reporter_user_id = any(${pgArray(userIds)}::uuid[])
    group by r.reporter_user_id
    on conflict (user_id) do update set
      upheld = excluded.upheld, not_upheld = excluded.not_upheld, voided = excluded.voided,
      last_report_at = excluded.last_report_at
    where (seller_reply_reports.reporter_stats.upheld, seller_reply_reports.reporter_stats.not_upheld,
           seller_reply_reports.reporter_stats.voided, seller_reply_reports.reporter_stats.last_report_at)
      is distinct from (excluded.upheld, excluded.not_upheld, excluded.voided, excluded.last_report_at)`)
}

export async function selectReporters(q: Queryable, reportIds: string[]): Promise<string[]> {
  const rows = rowsOf<{ u: string }>(
    await q.execute(sql`
      select distinct reporter_user_id::text as u from seller_reply_reports.reports
      where id = any(${pgArray(reportIds)}::uuid[])`),
  )
  return rows.map((r) => r.u)
}

/** Deletes every row of these users (account.deleted, rule 12). Reasons go with their reports. */
export async function deleteUsers(q: Queryable, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return
  const ids = pgArray(userIds)
  await q.execute(
    sql`delete from seller_reply_reports.reports where reporter_user_id = any(${ids}::uuid[])`,
  )
  await q.execute(
    sql`delete from seller_reply_reports.reporter_stats where user_id = any(${ids}::uuid[])`,
  )
  await q.execute(sql`delete from seller_reply_reports.testers where user_id = any(${ids}::uuid[])`)
}

/** Deletes every report, evidence row and hold on these listings (seller-rights' erase). */
export async function deleteListings(q: Queryable, listingIds: string[]): Promise<string[]> {
  if (listingIds.length === 0) return []
  const ids = pgArray(listingIds)
  const reporters = rowsOf<{ u: string }>(
    await q.execute(sql`
      delete from seller_reply_reports.reports where listing_id = any(${ids}::uuid[])
      returning reporter_user_id::text as u`),
  )
  await q.execute(
    sql`delete from seller_reply_reports.listing_evidence where listing_id = any(${ids}::uuid[])`,
  )
  await q.execute(sql`delete from seller_reply_reports.holds where scope_key = any(${ids}::text[])`)
  return [...new Set(reporters.map((r) => r.u))]
}

export async function insertTesters(
  q: Queryable,
  input: { userIds: string[]; addedBy: string; auditId: string },
  now: Date,
): Promise<void> {
  for (const userId of input.userIds) {
    await q.execute(sql`
      insert into seller_reply_reports.testers (user_id, added_by, audit_id, added_at)
      values (${userId}::uuid, ${input.addedBy}::uuid, ${input.auditId}::uuid, ${now.toISOString()}::timestamptz)
      on conflict (user_id) do nothing`)
  }
}

// ---------------------------------------------------------------------------------------------
// Default reads of other modules (the seams in ../index.ts; README.md, "Inputs")
// ---------------------------------------------------------------------------------------------

/** account.v_profiles (created_at) and better_auth.account_active(), for the aggregator. */
export async function selectAccountFacts(
  q: Queryable,
  userIds: string[],
): Promise<Map<string, { createdAt: Date | null; active: boolean }>> {
  const out = new Map<string, { createdAt: Date | null; active: boolean }>()
  if (userIds.length === 0) return out
  const rows = rowsOf<Record<string, unknown>>(
    await q.execute(sql`
      select u.id::text as user_id, p.created_at, better_auth.account_active(u.id) as active
      from unnest(${pgArray(userIds)}::uuid[]) as u(id)
      left join account.v_profiles p on p.user_id = u.id`),
  )
  for (const r of rows)
    out.set(String(r.user_id), { createdAt: toDateOrNull(r.created_at), active: Boolean(r.active) })
  return out
}

/** account.v_standing: which of these users are banned now. */
export async function selectBanned(q: Queryable, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return []
  const rows = rowsOf<{ u: string }>(
    await q.execute(sql`
      select user_id::text as u from account.v_standing
      where user_id = any(${pgArray(userIds)}::uuid[]) and status = 'banned'`),
  )
  return rows.map((r) => r.u)
}

/** listing_feedback.v_bought_for_reports for these reporters, keyed `user|listing`. */
export async function selectBought(q: Queryable, userIds: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>()
  if (userIds.length === 0) return out
  const rows = rowsOf<Record<string, unknown>>(
    await q.execute(sql`
      select user_id::text as user_id, listing_id::text as listing_id, at
      from listing_feedback.v_bought_for_reports
      where user_id = any(${pgArray(userIds)}::uuid[])`),
  )
  for (const r of rows) out.set(`${r.user_id}|${r.listing_id}`, toDate(r.at))
  return out
}

/** Reports whose reporter has since marked the listing bought and that have no outcome yet. */
export async function selectBoughtReportListings(q: Queryable): Promise<string[]> {
  const rows = rowsOf<{ listing_id: string }>(
    await q.execute(sql`
      select distinct r.listing_id::text as listing_id
      from seller_reply_reports.reports r
      join listing_feedback.v_bought_for_reports b
        on b.user_id = r.reporter_user_id and b.listing_id = r.listing_id
      where r.outcome is null
      limit 500`),
  )
  return rows.map((r) => r.listing_id)
}

export interface ClusterRow {
  clusterKey: string
  memberSetHash: string
  members: string[]
}

/** copy_advert.v_members: the active cluster of each listing, with every member. */
export async function selectClusters(
  q: Queryable,
  listingIds: string[],
): Promise<Map<string, ClusterRow>> {
  const out = new Map<string, ClusterRow>()
  if (listingIds.length === 0) return out
  const rows = rowsOf<Record<string, string>>(
    await q.execute(sql`
      select m.cluster_key, m.member_set_hash, m.listing_id::text as listing_id
      from copy_advert.v_members m
      where m.cluster_key in (
        select cluster_key from copy_advert.v_members where listing_id = any(${pgArray(listingIds)}::uuid[]))
      order by m.cluster_key, m.listing_id`),
  )
  const byKey = new Map<string, ClusterRow>()
  for (const r of rows) {
    const key = String(r.cluster_key)
    const entry = byKey.get(key) ?? {
      clusterKey: key,
      memberSetHash: String(r.member_set_hash),
      members: [],
    }
    entry.members.push(String(r.listing_id))
    byKey.set(key, entry)
  }
  for (const c of byKey.values()) for (const m of c.members) out.set(m, c)
  return out
}

/** city_pages.v_city_pages: the gazetteer point of each reported place. */
export async function selectPlacePoints(
  q: Queryable,
  placeIds: string[],
): Promise<Map<string, { lat: number; lng: number }>> {
  const out = new Map<string, { lat: number; lng: number }>()
  if (placeIds.length === 0) return out
  const rows = rowsOf<Record<string, unknown>>(
    await q.execute(sql`
      select city_page_id, lat, lng from city_pages.v_city_pages
      where city_page_id = any(${pgArray(placeIds)}::text[]) and lat is not null and lng is not null`),
  )
  for (const r of rows) out.set(String(r.city_page_id), { lat: Number(r.lat), lng: Number(r.lng) })
  return out
}

/** listing_ingest.v_listings: T1 (first fetched) of each listing. */
export async function selectFirstFetched(
  q: Queryable,
  listingIds: string[],
): Promise<Map<string, Date>> {
  const out = new Map<string, Date>()
  if (listingIds.length === 0) return out
  const rows = rowsOf<Record<string, unknown>>(
    await q.execute(sql`
      select id::text as id, first_fetched_at from listing_ingest.v_listings
      where id = any(${pgArray(listingIds)}::uuid[])`),
  )
  for (const r of rows) out.set(String(r.id), toDate(r.first_fetched_at))
  return out
}
