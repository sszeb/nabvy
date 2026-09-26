// Database access to the want_manager schema only. User writes run as nabvy_app inside withUser
// (packages/db/migrations/want-manager/*_access.sql): row-level security limits every statement
// to the caller's own rows. The two SECURITY DEFINER functions (nearest_centre, fair_use_want_cap)
// are this module's own; the pipeline reads for the purge and wantOwners.
import type { Queryable } from '@nabvy/db'
import { criteria, preferences, wants } from '@nabvy/db/schema/want-manager'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import type { WantContent } from '../domain'

export type WantRow = typeof wants.$inferSelect
export type CriterionRow = typeof criteria.$inferSelect
export type PreferencesRow = typeof preferences.$inferSelect

const rowsOf = <T>(result: unknown): T[] => (result as { rows: T[] }).rows

/** The user's own want by ID with its criteria in position order, or undefined (RLS). */
export async function selectWant(
  q: Queryable,
  wantId: string,
): Promise<{ want: WantRow; criteria: CriterionRow[] } | undefined> {
  const [want] = await q.select().from(wants).where(eq(wants.id, wantId)).limit(1)
  if (!want) return undefined
  const rows = await q
    .select()
    .from(criteria)
    .where(eq(criteria.wantId, wantId))
    .orderBy(criteria.position)
  return { want, criteria: rows }
}

/** Every want of the caller with its criteria (RLS), newest first. */
export async function selectWantsMine(
  q: Queryable,
): Promise<{ want: WantRow; criteria: CriterionRow[] }[]> {
  const wantRows = await q.select().from(wants).orderBy(sql`${wants.createdAt} desc`)
  if (wantRows.length === 0) return []
  const criterionRows = await q
    .select()
    .from(criteria)
    .where(
      inArray(
        criteria.wantId,
        wantRows.map((w) => w.id),
      ),
    )
    .orderBy(criteria.position)
  return wantRows.map((want) => ({
    want,
    criteria: criterionRows.filter((c) => c.wantId === want.id),
  }))
}

/** The caller's active wants, leaving one ID out (the want being replaced). */
export async function countActiveWants(
  q: Queryable,
  userId: string,
  excludeWantId: string | null,
): Promise<number> {
  const where = excludeWantId
    ? and(eq(wants.userId, userId), eq(wants.active, true), ne(wants.id, excludeWantId))
    : and(eq(wants.userId, userId), eq(wants.active, true))
  const [row] = await q.select({ n: sql<number>`count(*)::int` }).from(wants).where(where)
  return row?.n ?? 0
}

function contentColumns(content: WantContent, versionHash: string) {
  return {
    lat: content.lat,
    lng: content.lng,
    radiusKm: content.radiusKm,
    centreId: content.centreId,
    centreVerified: content.centreVerified,
    priceCapMinor: content.priceCapMinor,
    currency: content.currency,
    active: content.active,
    cadenceSeconds: content.cadenceSeconds,
    deliverySpeed: content.deliverySpeed,
    deliveryMethods: content.deliveryMethods,
    alternatives: content.alternatives,
    pcContainment: content.pcContainment,
    alternativesMaxPriceMinor: content.alternativesMaxPriceMinor,
    instantAlternatives: content.instantAlternatives,
    instantTopPicks: content.instantTopPicks,
    filter: content.filter,
    versionHash,
  }
}

/** Inserts a want and its criteria. */
export async function insertWant(
  q: Queryable,
  userId: string,
  content: WantContent,
  versionHash: string,
): Promise<WantRow> {
  const [row] = await q
    .insert(wants)
    .values({ userId, ...contentColumns(content, versionHash) })
    .returning()
  if (!row) throw new Error('want insert returned no row')
  await replaceCriteria(q, row.id, userId, content.criteria)
  return row
}

/** Replaces a want's content and criteria whole (RLS: the caller's own want only). */
export async function updateWant(
  q: Queryable,
  wantId: string,
  userId: string,
  content: WantContent,
  versionHash: string,
): Promise<WantRow> {
  const [row] = await q
    .update(wants)
    .set(contentColumns(content, versionHash))
    .where(eq(wants.id, wantId))
    .returning()
  if (!row) throw new Error('want update matched no row')
  await replaceCriteria(q, wantId, userId, content.criteria)
  return row
}

/** Sets only `active` and the version hash. */
export async function updateWantActive(
  q: Queryable,
  wantId: string,
  active: boolean,
  versionHash: string,
): Promise<WantRow | undefined> {
  const [row] = await q
    .update(wants)
    .set({ active, versionHash })
    .where(eq(wants.id, wantId))
    .returning()
  return row
}

async function replaceCriteria(
  q: Queryable,
  wantId: string,
  userId: string,
  items: WantContent['criteria'],
): Promise<void> {
  await q.delete(criteria).where(eq(criteria.wantId, wantId))
  await q.insert(criteria).values(
    items.map((c, position) => ({
      wantId,
      userId,
      position,
      partType: c.partType,
      catalogueId: c.catalogueId,
      family: c.family,
      minAttr: c.minAttr,
      orBetter: c.orBetter,
    })),
  )
}

/** Deletes the caller's want (criteria cascade). True when a row went. */
export async function deleteWantRow(q: Queryable, wantId: string): Promise<boolean> {
  const rows = await q.delete(wants).where(eq(wants.id, wantId)).returning({ id: wants.id })
  return rows.length > 0
}

export async function selectPreferences(
  q: Queryable,
  userId: string,
): Promise<PreferencesRow | undefined> {
  const [row] = await q.select().from(preferences).where(eq(preferences.userId, userId)).limit(1)
  return row
}

/** Upserts the caller's preferences on `user_id`. `created` is true when this call inserted. */
export async function upsertPreferences(
  q: Queryable,
  input: {
    userId: string
    hideNoise: boolean
    hideSpam: boolean
    hideMultiQuantity: boolean
    channels: string[]
    quietHours: { startMinute: number; endMinute: number } | null
  },
): Promise<{ row: PreferencesRow; created: boolean }> {
  const result = await q.execute(sql`
    insert into want_manager.preferences
      (user_id, hide_noise, hide_spam, hide_multi_quantity, channels, quiet_hours)
    values (${input.userId}, ${input.hideNoise}, ${input.hideSpam}, ${input.hideMultiQuantity},
      ${sql`array[${sql.join(
        input.channels.map((c) => sql`${c}`),
        sql`, `,
      )}]::text[]`},
      ${input.quietHours === null ? null : JSON.stringify(input.quietHours)}::jsonb)
    on conflict (user_id) do update set
      hide_noise = excluded.hide_noise, hide_spam = excluded.hide_spam,
      hide_multi_quantity = excluded.hide_multi_quantity, channels = excluded.channels,
      quiet_hours = excluded.quiet_hours, updated_at = now()
    returning id, user_id as "userId", hide_noise as "hideNoise", hide_spam as "hideSpam",
      hide_multi_quantity as "hideMultiQuantity", channels, quiet_hours as "quietHours",
      created_at as "createdAt", updated_at as "updatedAt", (xmax = 0) as created
  `)
  const [row] = rowsOf<PreferencesRow & { created: boolean }>(result)
  if (!row) throw new Error('preferences upsert returned no row')
  const { created, ...stored } = row
  return { row: stored, created }
}

/** The nearest active centre with a coordinate (want_manager.nearest_centre), or undefined. */
export async function nearestCentre(
  q: Queryable,
  lat: number,
  lng: number,
): Promise<{ centreId: string; verified: boolean; distanceKm: number } | undefined> {
  const result = await q.execute(sql`
    select centre_id as "centreId", verified, distance_km as "distanceKm"
    from want_manager.nearest_centre(${lat}::double precision, ${lng}::double precision)
  `)
  const [row] = rowsOf<{ centreId: string; verified: boolean; distanceKm: number }>(result)
  return row
}

/** The current user's fair-use cap on active wants (want_manager.fair_use_want_cap), or null. */
export async function fairUseWantCap(q: Queryable): Promise<number | null> {
  const result = await q.execute(
    sql`select max_active_hunts as "maxActiveHunts" from want_manager.fair_use_want_cap()`,
  )
  const [row] = rowsOf<{ maxActiveHunts: number | null }>(result)
  return row?.maxActiveHunts ?? null
}

/** Owner per want ID, read as the pipeline (never through a view: no view carries a user ID). */
export async function selectOwners(q: Queryable, wantIds: string[]): Promise<Map<string, string>> {
  if (wantIds.length === 0) return new Map()
  const rows = await q
    .select({ id: wants.id, userId: wants.userId })
    .from(wants)
    .where(inArray(wants.id, wantIds))
  return new Map(rows.map((r) => [r.id, r.userId]))
}

/** Deletes every want, criterion and preference row of these users (account.deleted). Idempotent. */
export async function deleteUsersRows(q: Queryable, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return
  await q.delete(criteria).where(inArray(criteria.userId, userIds))
  await q.delete(wants).where(inArray(wants.userId, userIds))
  await q.delete(preferences).where(inArray(preferences.userId, userIds))
}
