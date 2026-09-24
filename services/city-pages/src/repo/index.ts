// Database access. Own tables from '@nabvy/db/schema/city-pages'; listing-ingest's
// v_city_pages_seen and run-coverage's v_search_coverage / v_search_controls, read only
// (packages/db/README.md). No user rows: every call runs inside withPipeline.
import {
  centres,
  cityPages,
  vAreaMembership,
  vCentres,
  vCityPages,
} from '@nabvy/db/schema/city-pages'
import { vCityPagesSeen } from '@nabvy/db/schema/listing-ingest'
import { vSearchControls, vSearchCoverage } from '@nabvy/db/schema/run-coverage'
import { and, eq, sql } from 'drizzle-orm'
import type { NewCityPage } from '../domain'

type Queryable = import('@nabvy/db').Queryable

const iso = (value: Date | string) => new Date(value).toISOString()

/** Every city page's ID, for `newCityPagesFrom`'s membership check. */
export async function selectKnownCityPageIds(q: Queryable): Promise<Set<string>> {
  const rows = await q.select({ cityPageId: cityPages.cityPageId }).from(cityPages)
  return new Set(rows.map((row) => row.cityPageId))
}

/** listing-ingest's `v_city_pages_seen`: every city page listings have carried, with a town label. */
export async function selectSeen(
  q: Queryable,
): Promise<{ cityPageId: string; townLabel: string | null; firstSeenAt: Date }[]> {
  const rows = await q
    .select({
      cityPageId: vCityPagesSeen.cityPageId,
      townLabel: vCityPagesSeen.townLabel,
      firstSeenAt: vCityPagesSeen.firstSeenAt,
    })
    .from(vCityPagesSeen)
  return rows.map((row) => ({ ...row, firstSeenAt: new Date(row.firstSeenAt) }))
}

/** Adds city pages first seen on cards (`coord_source = 'card'`, no coordinate). Safe to repeat. */
export async function insertCardCityPages(q: Queryable, rows: NewCityPage[]): Promise<string[]> {
  if (rows.length === 0) return []
  const inserted = await q
    .insert(cityPages)
    .values(
      rows.map((row) => ({
        cityPageId: row.cityPageId,
        name: row.name,
        towns: row.towns,
        coordSource: 'card' as const,
        firstSeenAt: row.firstSeenAt,
      })),
    )
    .onConflictDoNothing({ target: cityPages.cityPageId })
    .returning({ cityPageId: cityPages.cityPageId })
  return inserted.map((row) => row.cityPageId)
}

export interface CentreRow {
  cityPageId: string
  active: boolean
  verified: boolean
  verifiedByJob: number | null
  country: string
  currency: string
  reportedLat: number | null
  reportedLng: number | null
  areaKm: number
}

/** One centre row (candidate or verified), or null if this city page is not a centre. */
export async function selectCentre(q: Queryable, cityPageId: string): Promise<CentreRow | null> {
  const [row] = await q.select().from(centres).where(eq(centres.cityPageId, cityPageId))
  return row ?? null
}

/**
 * The job's newest-first, page-1 search of this centre, if the run judged it complete or capped
 * (never degraded — run-coverage's own gap check already refused a bad read), with Facebook's
 * reported centre from the same search's controls.
 */
export async function selectQualifyingSearch(
  q: Queryable,
  jobId: number,
  centreId: string,
): Promise<{ searchIndex: number; reportedLat: number | null; reportedLng: number | null } | null> {
  const [row] = await q
    .select({
      searchIndex: vSearchCoverage.searchIndex,
      status: vSearchCoverage.status,
      reportedLat: vSearchControls.latitude,
      reportedLng: vSearchControls.longitude,
    })
    .from(vSearchCoverage)
    .innerJoin(
      vSearchControls,
      and(
        eq(vSearchControls.jobId, vSearchCoverage.jobId),
        eq(vSearchControls.searchIndex, vSearchCoverage.searchIndex),
      ),
    )
    .where(
      and(
        eq(vSearchCoverage.jobId, jobId),
        eq(vSearchCoverage.centreId, centreId),
        eq(vSearchCoverage.kind, 'newest'),
        sql`${vSearchCoverage.status} <> 'degraded'`,
      ),
    )
    .orderBy(vSearchCoverage.searchIndex)
    .limit(1)
  if (!row) return null
  return {
    searchIndex: row.searchIndex,
    reportedLat: row.reportedLat,
    reportedLng: row.reportedLng,
  }
}

/**
 * Binds verification: marks a candidate centre verified, activates it, and records Facebook's
 * reported centre when the qualifying search gave one. Inserts the centre row first if this city
 * page had none yet (a hunt asked for a centre outside the seeded grid). Country and currency
 * default to GB/GBP: the beta runs UK only, and a request to verify Dublin or another Irish page
 * is out of scope for this call (question in docs/questions/city-pages.md).
 */
export async function upsertVerifiedCentre(
  q: Queryable,
  row: {
    cityPageId: string
    verifiedByJob: number
    reportedLat: number | null
    reportedLng: number | null
    areaKm: number
  },
): Promise<void> {
  await q
    .insert(centres)
    .values({
      cityPageId: row.cityPageId,
      active: true,
      verified: true,
      verifiedByJob: row.verifiedByJob,
      country: 'GB',
      currency: 'GBP',
      reportedLat: row.reportedLat,
      reportedLng: row.reportedLng,
      areaKm: row.areaKm,
    })
    .onConflictDoUpdate({
      target: centres.cityPageId,
      set: {
        active: true,
        verified: true,
        verifiedByJob: row.verifiedByJob,
        reportedLat: row.reportedLat,
        reportedLng: row.reportedLng,
      },
    })
}

export async function selectCityPages(q: Queryable) {
  const rows = await q.select().from(vCityPages)
  return rows.map((row) => ({ ...row, firstSeenAt: iso(row.firstSeenAt) }))
}

export function selectCentres(q: Queryable) {
  return q.select().from(vCentres)
}

export function selectAreaMembership(q: Queryable) {
  return q.select().from(vAreaMembership)
}
