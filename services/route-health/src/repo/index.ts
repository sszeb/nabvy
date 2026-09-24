// Database access. Own tables from '@nabvy/db/schema/route-health'; other modules (here,
// apify-gateway) only through their v_ views (packages/db/README.md). route-health holds no user
// rows, so no withUser scoping.
import type { RouteHealthRunEntry, RouteHealthState } from '@nabvy/contracts/modules/route-health'
import type { Queryable } from '@nabvy/db'
import { vJobs, vRunSummaries } from '@nabvy/db/schema/apify-gateway'
import { routeRuns, routeState } from '@nabvy/db/schema/route-health'
import { and, desc, eq, notInArray } from 'drizzle-orm'
import { toDetailRouteRun } from '../domain'
import type { DetailRouteRun } from '../domain/route-health'

/**
 * Inserts one run entry, keyed on its Apify run ID (the table's unique key): a retried scheduler
 * tick that resubmits the same run writes nothing new (CLAUDE.md, "Idempotent handlers"). A
 * replay leaves the stored row (and so the history `recommendDetailRoute` sees) unchanged.
 */
export async function insertRunEntry(
  db: Queryable,
  regionId: string,
  entry: RouteHealthRunEntry,
): Promise<void> {
  await db
    .insert(routeRuns)
    .values({
      regionId,
      apifyRunId: entry.apifyRunId,
      detailRoute: entry,
      at: new Date(entry.at),
    })
    .onConflictDoNothing({ target: routeRuns.apifyRunId })
}

/** The region's history, oldest first, as the domain function expects it. */
export async function selectHistory(
  db: Queryable,
  regionId: string,
  limit: number,
): Promise<DetailRouteRun[]> {
  const rows = await db
    .select({ detailRoute: routeRuns.detailRoute })
    .from(routeRuns)
    .where(eq(routeRuns.regionId, regionId))
    .orderBy(desc(routeRuns.at))
    .limit(limit)
  return rows.map((row) => toDetailRouteRun(row.detailRoute as RouteHealthRunEntry)).reverse()
}

/**
 * Prunes a region's history back to its most recent `keep` rows (card: "at least 11 entries kept
 * per region"). Deletes nothing when the region has `keep` rows or fewer.
 */
export async function pruneRuns(db: Queryable, regionId: string, keep: number): Promise<void> {
  const kept = await db
    .select({ id: routeRuns.id })
    .from(routeRuns)
    .where(eq(routeRuns.regionId, regionId))
    .orderBy(desc(routeRuns.at))
    .limit(keep)
  if (kept.length === 0) return
  await db.delete(routeRuns).where(
    and(
      eq(routeRuns.regionId, regionId),
      notInArray(
        routeRuns.id,
        kept.map((row) => row.id),
      ),
    ),
  )
}

export interface StoredDecision {
  state: RouteHealthState
  updatedAt: Date
}

export async function selectState(
  db: Queryable,
  regionId: string,
): Promise<StoredDecision | undefined> {
  const [row] = await db
    .select({ state: routeState.state, updatedAt: routeState.updatedAt })
    .from(routeState)
    .where(eq(routeState.regionId, regionId))
  return row ? { state: row.state as RouteHealthState, updatedAt: row.updatedAt } : undefined
}

/** Upserts a region's state (its whole `RouteHealthState`, `lastDecision` included). */
export async function upsertState(
  db: Queryable,
  regionId: string,
  state: RouteHealthState,
  at: Date,
): Promise<void> {
  await db
    .insert(routeState)
    .values({ regionId, state, updatedAt: at })
    .onConflictDoUpdate({ target: routeState.regionId, set: { state, updatedAt: at } })
}

/** The region an apify-gateway job was tagged with (card: "the region in the new jobs.tags column"). */
export async function selectJobRegion(db: Queryable, jobId: number): Promise<string | undefined> {
  const [row] = await db.select({ tags: vJobs.tags }).from(vJobs).where(eq(vJobs.id, jobId))
  const region = (row?.tags as Record<string, unknown> | undefined)?.region
  return typeof region === 'string' ? region : undefined
}

/** A collected job's `RUN_SUMMARY.detailRoute`, whatever shape the actor gave it. */
export async function selectRunSummaryDetailRoute(db: Queryable, jobId: number): Promise<unknown> {
  const [row] = await db
    .select({ detailRoute: vRunSummaries.detailRoute })
    .from(vRunSummaries)
    .where(eq(vRunSummaries.jobId, jobId))
  return row?.detailRoute
}
