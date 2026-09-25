// Database access. Own tables from '@nabvy/db/schema/source-health'; other modules (apify-gateway,
// route-health, run-coverage) only through their v_ views (packages/db/README.md). source-health
// holds no user rows, so no withUser scoping.
import { SOURCE_HEALTH_RAMP_STAGES } from '@nabvy/config/modules/source-health'
import type { SourceHealthAlertReason } from '@nabvy/contracts/modules/source-health'
import type { Queryable } from '@nabvy/db'
import { vJobs, vSellerPresence } from '@nabvy/db/schema/apify-gateway'
import { vDecisions } from '@nabvy/db/schema/route-health'
import { vSearchCoverage } from '@nabvy/db/schema/run-coverage'
import { healthDaily, processedJobs, ramp, vHealth } from '@nabvy/db/schema/source-health'
import { asc, desc, eq, sql } from 'drizzle-orm'
import { type HealthDayTotals, type RampDayRead, rampStageAt, type SearchOutcome } from '../domain'

export interface CollectedJob {
  /** The region an apify-gateway job was tagged with (every submitted run carries one, rule 12). */
  regionId: string | undefined
  /**
   * The job's own server-side time, for its Europe/London day: `settled_at` (the gateway's
   * cost settle), else `finished_at` (the run's finish per Apify), else `created_at`. Never the
   * transport's delivery time, which a retry can push past midnight.
   */
  occurredAt: Date
}

/** The job's `v_jobs` row, or undefined while apify-gateway has none for it yet. */
export async function selectJob(db: Queryable, jobId: number): Promise<CollectedJob | undefined> {
  const [row] = await db
    .select({
      tags: vJobs.tags,
      settledAt: vJobs.settledAt,
      finishedAt: vJobs.finishedAt,
      createdAt: vJobs.createdAt,
    })
    .from(vJobs)
    .where(eq(vJobs.id, jobId))
  if (!row) return undefined
  const region = (row.tags as Record<string, unknown>).region
  return {
    regionId: typeof region === 'string' ? region : undefined,
    occurredAt: row.settledAt ?? row.finishedAt ?? row.createdAt,
  }
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
    totalSearches: row.totalSearches,
    degradedSearches: row.degradedSearches,
    breakerTrips: row.breakerTrips,
    newOperationIds: row.newOperationIds,
    blockedPages: row.blockedPages,
    alerted: row.alerted as HealthDayTotals['alerted'],
  }
}

/**
 * Claims the job (`processed_jobs`, keyed by job ID across days, `on conflict do nothing`) and,
 * only on a real claim, adds its counts to the day's row with SQL increments. Returns the day's
 * totals after the add, or `undefined` when the job was already folded in (a replay, whatever day
 * the redelivery lands on). Concurrency: two jobs on one day each take the row lock for their
 * own `update`, so the second increments on top of the first instead of overwriting it; the
 * caller's transaction (`withPipeline`) keeps the claim and the add together.
 */
export async function addJobToDay(
  db: Queryable,
  day: string,
  jobId: number,
  contribution: HealthDayTotals,
  at: Date,
): Promise<HealthDayTotals | undefined> {
  const claimed = await db
    .insert(processedJobs)
    .values({ jobId, day, processedAt: at })
    .onConflictDoNothing({ target: processedJobs.jobId })
    .returning({ jobId: processedJobs.jobId })
  if (claimed.length === 0) return undefined

  await db.insert(healthDaily).values({ day }).onConflictDoNothing({ target: healthDaily.day })

  const ids = JSON.stringify(contribution.newOperationIds)
  const pages = JSON.stringify(contribution.blockedPages)
  const [row] = await db
    .update(healthDaily)
    .set({
      totalSearches: sql`${healthDaily.totalSearches} + ${contribution.totalSearches}`,
      degradedSearches: sql`${healthDaily.degradedSearches} + ${contribution.degradedSearches}`,
      breakerTrips: sql`${healthDaily.breakerTrips} + ${contribution.breakerTrips}`,
      // the union, each ID once, in first-seen order (existing first, then the job's new ones)
      newOperationIds: sql`(
        select coalesce(jsonb_agg(value order by ord), '[]'::jsonb)
        from (
          select value, min(ord) as ord
          from jsonb_array_elements(${healthDaily.newOperationIds} || ${ids}::jsonb)
            with ordinality as e(value, ord)
          group by value
        ) as ids
      )`,
      blockedPages: sql`${healthDaily.blockedPages} || ${pages}::jsonb`,
      updatedAt: at,
    })
    .where(eq(healthDaily.day, day))
    .returning()
  if (!row) throw new Error(`source-health: day ${day} vanished between insert and update`)
  return toTotals(row)
}

/**
 * Records `reasons` as alerted for the day, one at a time, each only if not already there, and
 * returns the ones this call actually added: the caller emits exactly those. Under concurrent
 * jobs the second `update` re-checks the row after the first commits and adds nothing, so a
 * reason's event fires once per day (README, "Outputs").
 */
export async function claimAlerts(
  db: Queryable,
  day: string,
  reasons: readonly SourceHealthAlertReason[],
): Promise<SourceHealthAlertReason[]> {
  const claimed: SourceHealthAlertReason[] = []
  for (const reason of reasons) {
    const one = JSON.stringify([reason])
    const rows = await db
      .update(healthDaily)
      .set({ alerted: sql`${healthDaily.alerted} || ${one}::jsonb` })
      .where(sql`${healthDaily.day} = ${day} and not (${healthDaily.alerted} @> ${one}::jsonb)`)
      .returning({ day: healthDaily.day })
    if (rows.length > 0) claimed.push(reason)
  }
  return claimed
}

/** A day's degraded share and alerts, read back from `v_health`; undefined while there is no row (or off). */
export async function selectRampDayRead(
  db: Queryable,
  day: string,
): Promise<RampDayRead | undefined> {
  const [row] = await db
    .select({ pct: vHealth.pctDegraded, alerted: vHealth.alerted })
    .from(vHealth)
    .where(eq(vHealth.day, day))
  if (!row) return undefined
  return { pctDegraded: Number(row.pct), alerted: row.alerted as SourceHealthAlertReason[] }
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

/** Seeds the ramp at its lowest stage if no stage has ever been entered (`stage` is unique, so a racing seed is a no-op). */
export async function seedRampIfMissing(db: Queryable, at: Date): Promise<void> {
  const current = await selectCurrentRamp(db)
  if (current) return
  await db
    .insert(ramp)
    .values({
      stage: 0,
      startedAt: at,
      maxChecksPerDay: rampStageAt(SOURCE_HEALTH_RAMP_STAGES, 0).maxChecksPerDay,
      advancedBy: null,
    })
    .onConflictDoNothing({ target: ramp.stage })
}

/**
 * Appends the next stage. Never updates a past stage's row (README, "Decisions"). Returns false
 * when that stage already exists (another `assessRamp` advanced first): the caller then reports
 * no advance of its own.
 */
export async function insertRampStage(
  db: Queryable,
  stage: number,
  startedAt: Date,
  maxChecksPerDay: number,
  advancedBy: string,
): Promise<boolean> {
  const rows = await db
    .insert(ramp)
    .values({ stage, startedAt, maxChecksPerDay, advancedBy })
    .onConflictDoNothing({ target: ramp.stage })
    .returning({ stage: ramp.stage })
  return rows.length > 0
}
