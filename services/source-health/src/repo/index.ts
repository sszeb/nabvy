// Database access. Own tables from '@nabvy/db/schema/source-health'; other modules (apify-gateway,
// route-health, run-coverage) only through their v_ views (packages/db/README.md). source-health
// holds no user rows, so no withUser scoping.
import { SOURCE_HEALTH_RAMP_STAGES } from '@nabvy/config/modules/source-health'
import type { Queryable } from '@nabvy/db'
import { vJobs, vSellerPresence } from '@nabvy/db/schema/apify-gateway'
import { vDecisions } from '@nabvy/db/schema/route-health'
import { vSearchCoverage } from '@nabvy/db/schema/run-coverage'
import { healthDaily, ramp, vHealth } from '@nabvy/db/schema/source-health'
import { asc, desc, eq } from 'drizzle-orm'
import { emptyHealthDay, type HealthDayTotals, type SearchOutcome } from '../domain'

/** The region an apify-gateway job was tagged with (every submitted run carries one, rule 12). */
export async function selectJobRegion(db: Queryable, jobId: number): Promise<string | undefined> {
  const [row] = await db.select({ tags: vJobs.tags }).from(vJobs).where(eq(vJobs.id, jobId))
  const region = (row?.tags as Record<string, unknown> | undefined)?.region
  return typeof region === 'string' ? region : undefined
}

/** True once apify-gateway has a run summary for the job (confirms it was actually collected). */
export async function selectJobExists(db: Queryable, jobId: number): Promise<boolean> {
  const [row] = await db.select({ jobId: vJobs.id }).from(vJobs).where(eq(vJobs.id, jobId))
  return row !== undefined
}

/** run-coverage's judged searches for this job (empty for a details job, or while run-coverage is off). */
export async function selectSearchRoutes(db: Queryable, jobId: number): Promise<SearchOutcome[]> {
  const rows = await db
    .select({ route: vSearchCoverage.route })
    .from(vSearchCoverage)
    .where(eq(vSearchCoverage.jobId, jobId))
  return rows.map((row) => ({ route: row.route }))
}

/** apify-gateway's seller-presence flags for this job, in `seq` order (card, "rows carry no page field"). */
export async function selectSellerPresence(db: Queryable, jobId: number): Promise<boolean[]> {
  const rows = await db
    .select({ present: vSellerPresence.present })
    .from(vSellerPresence)
    .where(eq(vSellerPresence.jobId, jobId))
    .orderBy(asc(vSellerPresence.seq))
  return rows.map((row) => row.present === true)
}

export interface RegionDecision {
  reason: string | null
  newQueryIds: string[]
}

/** route-health's current decision for a region, or undefined while it has none (off, or unread yet). */
export async function selectRegionDecision(
  db: Queryable,
  regionId: string,
): Promise<RegionDecision | undefined> {
  const [row] = await db
    .select({ reason: vDecisions.reason, newQueryIds: vDecisions.newQueryIds })
    .from(vDecisions)
    .where(eq(vDecisions.regionId, regionId))
  if (!row) return undefined
  return { reason: row.reason, newQueryIds: (row.newQueryIds as string[] | null) ?? [] }
}

function toTotals(row: typeof healthDaily.$inferSelect): HealthDayTotals {
  return {
    processedJobIds: row.processedJobIds,
    totalSearches: row.totalSearches,
    degradedSearches: row.degradedSearches,
    breakerTrips: row.breakerTrips,
    newOperationIds: row.newOperationIds,
    sellerBlockPages: row.sellerBlockPages,
    alerted: row.alerted as HealthDayTotals['alerted'],
  }
}

export async function selectHealthDay(db: Queryable, day: string): Promise<HealthDayTotals> {
  const [row] = await db.select().from(healthDaily).where(eq(healthDaily.day, day))
  return row ? toTotals(row) : emptyHealthDay()
}

/** Upserts the whole day's totals (the repo always reads-modifies-writes the full row). */
export async function upsertHealthDay(
  db: Queryable,
  day: string,
  totals: HealthDayTotals,
  at: Date,
): Promise<void> {
  const values = {
    day,
    processedJobIds: totals.processedJobIds,
    totalSearches: totals.totalSearches,
    degradedSearches: totals.degradedSearches,
    breakerTrips: totals.breakerTrips,
    newOperationIds: totals.newOperationIds,
    sellerBlockPages: totals.sellerBlockPages,
    alerted: totals.alerted,
    updatedAt: at,
  }
  await db
    .insert(healthDaily)
    .values(values)
    .onConflictDoUpdate({ target: healthDaily.day, set: values })
}

/** A day's degraded share, read back from `v_health`; undefined while there is no row (or off). */
export async function selectPctDegraded(db: Queryable, day: string): Promise<number | undefined> {
  const [row] = await db.select({ pct: vHealth.pctDegraded }).from(vHealth).where(eq(vHealth.day, day))
  return row ? Number(row.pct) : undefined
}

export interface CurrentRamp {
  stage: number
  startedAt: Date
  maxChecksPerDay: number
  advancedBy: string | null
}

/** The latest ramp row (the current stage), or undefined before the first one is seeded. */
export async function selectCurrentRamp(db: Queryable): Promise<CurrentRamp | undefined> {
  const [row] = await db
    .select({
      stage: ramp.stage,
      startedAt: ramp.startedAt,
      maxChecksPerDay: ramp.maxChecksPerDay,
      advancedBy: ramp.advancedBy,
    })
    .from(ramp)
    .orderBy(desc(ramp.startedAt))
    .limit(1)
  return row
}

/** Seeds the ramp at its lowest stage if no stage has ever been entered. */
export async function seedRampIfMissing(db: Queryable, at: Date): Promise<void> {
  const current = await selectCurrentRamp(db)
  if (current) return
  await db.insert(ramp).values({
    stage: 0,
    startedAt: at,
    maxChecksPerDay: SOURCE_HEALTH_RAMP_STAGES[0].maxChecksPerDay,
    advancedBy: null,
  })
}

/** Appends the next stage. Never updates a past stage's row (README, "Decisions"). */
export async function insertRampStage(
  db: Queryable,
  stage: number,
  startedAt: Date,
  maxChecksPerDay: number,
  advancedBy: string,
): Promise<void> {
  await db.insert(ramp).values({ stage, startedAt, maxChecksPerDay, advancedBy })
}
