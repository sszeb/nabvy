// Database access. Own tables from '@nabvy/db/schema/check-scheduler'; other modules' data only
// through their v_ views: run-coverage's `v_search_coverage` and listing-ingest's `v_sightings`
// and `v_listings` (packages/db/README.md). search-planner, spend-governor, source-health and
// apify-gateway are read through their exported functions (index.ts). Runs as nabvy_pipeline
// inside withPipeline; no user rows.

import type {
  CheckSchedulerKind,
  CheckSchedulerReason,
  CheckSchedulerRunStatus,
  CheckSchedulerShape,
} from '@nabvy/contracts/modules/check-scheduler'
import type { SearchPlannerTermClass } from '@nabvy/contracts/modules/search-planner'
import type { Queryable } from '@nabvy/db'
import { checkRuns, schedule, vCheckRuns } from '@nabvy/db/schema/check-scheduler'
import { vListings, vSightings } from '@nabvy/db/schema/listing-ingest'
import { vSearchCoverage } from '@nabvy/db/schema/run-coverage'
import { and, asc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import type { PendingRerun, ScheduleRow } from '../domain'

/** One tick at a time: the tick claim and the ramp count both depend on it. */
export async function lockTick(q: Queryable): Promise<void> {
  await q.execute(sql`select pg_advisory_xact_lock(hashtext('check_scheduler.tick'))`)
}

/** Regions this tick slot already claimed: a retried tick skips them. */
export async function selectClaimed(q: Queryable, tickAt: Date): Promise<Set<string>> {
  const rows = await q
    .select({ centreId: checkRuns.centreId })
    .from(checkRuns)
    .where(eq(checkRuns.tickAt, tickAt))
  return new Set(rows.map((r) => r.centreId))
}

/** Term checks sent since `since` (the London day's start), for source-health's ramp cap. */
export async function countChecksSince(q: Queryable, since: Date): Promise<number> {
  const [row] = await q
    .select({ n: sql<string>`coalesce(sum(cardinality(${checkRuns.terms})), 0)` })
    .from(checkRuns)
    .where(and(eq(checkRuns.status, 'submitted'), gte(checkRuns.tickAt, since)))
  return Number(row?.n ?? 0)
}

export async function selectSchedule(q: Queryable): Promise<ScheduleRow[]> {
  const rows = await q.select().from(schedule)
  return rows.map((r) => ({
    centreId: r.centreId,
    termClass: r.termClass as SearchPlannerTermClass,
    kind: r.kind as CheckSchedulerKind,
    cadenceS: r.cadenceS,
    nextDueAt: r.nextDueAt,
    lastRunAt: r.lastRunAt,
  }))
}

/** Drops schedule rows no runnable pair needs any more (the plan is the source of truth). */
export async function deleteStaleSchedule(
  q: Queryable,
  live: { centreId: string; termClass: string }[],
): Promise<void> {
  const keep = new Set(live.map((l) => `${l.centreId}|${l.termClass}`))
  const rows = await q
    .select({ centreId: schedule.centreId, termClass: schedule.termClass })
    .from(schedule)
  for (const r of rows) {
    if (keep.has(`${r.centreId}|${r.termClass}`)) continue
    await q
      .delete(schedule)
      .where(and(eq(schedule.centreId, r.centreId), eq(schedule.termClass, r.termClass)))
  }
}

export async function upsertSchedule(
  q: Queryable,
  row: {
    centreId: string
    termClass: SearchPlannerTermClass
    kind: CheckSchedulerKind
    cadenceS: number
    lastRunAt: Date
  },
): Promise<void> {
  const nextDueAt = new Date(row.lastRunAt.getTime() + row.cadenceS * 1000)
  await q
    .insert(schedule)
    .values({ ...row, nextDueAt })
    .onConflictDoUpdate({
      target: [schedule.centreId, schedule.termClass, schedule.kind],
      set: { cadenceS: row.cadenceS, lastRunAt: row.lastRunAt, nextDueAt },
    })
}

/** Pending reruns, oldest first. */
export async function selectPendingReruns(q: Queryable): Promise<PendingRerun[]> {
  const rows = await q
    .select({
      id: checkRuns.id,
      centreId: checkRuns.centreId,
      kind: checkRuns.kind,
      shape: checkRuns.shape,
      terms: checkRuns.terms,
    })
    .from(checkRuns)
    .where(eq(checkRuns.status, 'pending'))
    .orderBy(asc(checkRuns.createdAt), asc(checkRuns.id))
  return rows.map((r) => ({
    ...r,
    kind: r.kind as CheckSchedulerKind,
    shape: r.shape as CheckSchedulerShape,
  }))
}

/** One-off runs already carried out or in flight here (a refused attempt does not count). */
export async function selectLiveOneOffIds(q: Queryable): Promise<Set<string>> {
  const rows = await q
    .select({ oneOffId: checkRuns.oneOffId })
    .from(checkRuns)
    .where(and(isNotNull(checkRuns.oneOffId), sql`${checkRuns.status} <> 'refused'`))
  return new Set(rows.map((r) => r.oneOffId as string))
}

export interface NewRun {
  centreId: string
  kind: CheckSchedulerKind
  shape: CheckSchedulerShape
  terms: string[]
  reason: CheckSchedulerReason
  status: CheckSchedulerRunStatus
  tickAt: Date | null
  jobId: number | null
  rerunOf?: string | null
  oneOffId?: string | null
  errorCode?: string | null
}

/**
 * Records a run. A tick's row claims (tick_at, centre_id); a rerun's pending row is unique on
 * the degraded search. Returns false when the claim or the rerun already exists.
 */
export async function insertRun(q: Queryable, run: NewRun): Promise<boolean> {
  const rows = await q
    .insert(checkRuns)
    .values({
      centreId: run.centreId,
      kind: run.kind,
      shape: run.shape,
      terms: run.terms,
      reason: run.reason,
      status: run.status,
      tickAt: run.tickAt,
      jobId: run.jobId,
      rerunOf: run.rerunOf ?? null,
      oneOffId: run.oneOffId ?? null,
      errorCode: run.errorCode ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: checkRuns.id })
  return rows.length > 0
}

/** Sends a pending rerun: it takes the tick's claim for its region. */
export async function markRerun(
  q: Queryable,
  id: string,
  set: {
    status: CheckSchedulerRunStatus
    tickAt: Date
    jobId: number | null
    errorCode: string | null
  },
): Promise<void> {
  await q
    .update(checkRuns)
    .set(set)
    .where(and(eq(checkRuns.id, id), eq(checkRuns.status, 'pending'), isNull(checkRuns.tickAt)))
}

/** This module's runs by job ID, for the degraded-search handler and one-off settling. */
export async function selectRunsByJob(
  q: Queryable,
  jobIds: number[],
): Promise<
  Map<
    number,
    { reason: CheckSchedulerReason; kind: CheckSchedulerKind; shape: CheckSchedulerShape }
  >
> {
  if (jobIds.length === 0) return new Map()
  const rows = await q
    .select({
      jobId: checkRuns.jobId,
      reason: checkRuns.reason,
      kind: checkRuns.kind,
      shape: checkRuns.shape,
    })
    .from(checkRuns)
    .where(inArray(checkRuns.jobId, jobIds))
  return new Map(
    rows.map((r) => [
      r.jobId as number,
      {
        reason: r.reason as CheckSchedulerReason,
        kind: r.kind as CheckSchedulerKind,
        shape: r.shape as CheckSchedulerShape,
      },
    ]),
  )
}

/** Degraded searches by ID (`run_coverage.v_search_coverage`); empty while run-coverage is off. */
export async function selectDegradedSearches(
  q: Queryable,
  searchIds: string[],
): Promise<{ id: string; jobId: number; centreId: string | null; term: string | null }[]> {
  if (searchIds.length === 0) return []
  return q
    .select({
      id: vSearchCoverage.id,
      jobId: vSearchCoverage.jobId,
      centreId: vSearchCoverage.centreId,
      term: vSearchCoverage.term,
    })
    .from(vSearchCoverage)
    .where(and(inArray(vSearchCoverage.id, searchIds), eq(vSearchCoverage.status, 'degraded')))
}

/** One-off runs sent and not yet settled with search-planner. */
export async function selectOpenOneOffs(
  q: Queryable,
): Promise<{ oneOffId: string; jobId: number }[]> {
  const rows = await q
    .select({ oneOffId: checkRuns.oneOffId, jobId: checkRuns.jobId })
    .from(checkRuns)
    .where(and(isNotNull(checkRuns.oneOffId), eq(checkRuns.status, 'submitted')))
  return rows.map((r) => ({ oneOffId: r.oneOffId as string, jobId: r.jobId as number }))
}

/**
 * New listings per region since `since`: listings whose first fetch came at or after the run
 * that saw them, counted once, over this module's submitted runs (`v_check_runs` ×
 * listing-ingest's `v_sightings` and `v_listings`). Empty while listing-ingest is off.
 */
export async function selectYields(q: Queryable, since: Date): Promise<Map<string, number>> {
  const rows = await q
    .select({
      centreId: vCheckRuns.centreId,
      n: sql<string>`count(distinct ${vSightings.listingId})`,
    })
    .from(vCheckRuns)
    .innerJoin(vSightings, eq(vSightings.jobId, vCheckRuns.jobId))
    .innerJoin(vListings, eq(vListings.id, vSightings.listingId))
    .where(
      and(
        eq(vCheckRuns.status, 'submitted'),
        gte(vCheckRuns.createdAt, since),
        gte(vListings.firstFetchedAt, vCheckRuns.createdAt),
      ),
    )
    .groupBy(vCheckRuns.centreId)
  return new Map(rows.map((r) => [r.centreId, Number(r.n)]))
}
