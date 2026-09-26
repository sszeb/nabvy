// Database access. Own tables from '@nabvy/db/schema/search-planner'; other modules' data only
// through their v_ views: want-manager's `v_want_terms_by_centre` and city-pages' `v_centres`
// (packages/db/README.md). Runs as nabvy_pipeline inside withPipeline; no user rows.
import type { Queryable } from '@nabvy/db'
import { vCentres } from '@nabvy/db/schema/city-pages'
import { oneOffRuns, plans, planTerms, vOneOffRuns, vPlan } from '@nabvy/db/schema/search-planner'
import { vWantTermsByCentre } from '@nabvy/db/schema/want-manager'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { CentreState, PlanDiff, PlanRow, PlanTermRow, WantTermCount } from '../domain'

export async function selectWantTerms(q: Queryable): Promise<WantTermCount[]> {
  const rows = await q
    .select({
      centreId: vWantTermsByCentre.centreId,
      family: vWantTermsByCentre.family,
      wantCount: vWantTermsByCentre.wantCount,
      paidWantCount: vWantTermsByCentre.paidWantCount,
    })
    .from(vWantTermsByCentre)
  return rows.map((r) => ({
    ...r,
    wantCount: Number(r.wantCount),
    paidWantCount: Number(r.paidWantCount),
  }))
}

export async function selectCentres(q: Queryable): Promise<CentreState[]> {
  return q
    .select({
      cityPageId: vCentres.cityPageId,
      active: vCentres.active,
      verified: vCentres.verified,
    })
    .from(vCentres)
}

export async function selectStoredPlan(
  q: Queryable,
): Promise<{ terms: PlanTermRow[]; plans: PlanRow[] }> {
  const [termRows, planRows] = await Promise.all([
    q
      .select({
        centreId: planTerms.centreId,
        term: planTerms.term,
        origin: planTerms.origin,
        class: planTerms.class,
        wantCount: planTerms.wantCount,
        paidWantCount: planTerms.paidWantCount,
        inBudget: planTerms.inBudget,
        rank: planTerms.rank,
      })
      .from(planTerms),
    q.select({ centreId: plans.centreId, active: plans.active }).from(plans),
  ])
  return { terms: termRows as PlanTermRow[], plans: planRows }
}

/** Applies a plan diff: deletes, then upserts, in one statement per kind. */
export async function applyPlanDiff(q: Queryable, diff: PlanDiff): Promise<void> {
  for (const r of diff.deleteTerms) {
    await q
      .delete(planTerms)
      .where(
        and(
          eq(planTerms.centreId, r.centreId),
          eq(planTerms.term, r.term),
          eq(planTerms.origin, r.origin),
        ),
      )
  }
  if (diff.deletePlans.length > 0) {
    await q.delete(plans).where(inArray(plans.centreId, diff.deletePlans))
  }
  if (diff.upsertPlans.length > 0) {
    await q
      .insert(plans)
      .values(diff.upsertPlans)
      .onConflictDoUpdate({ target: plans.centreId, set: { active: sql`excluded.active` } })
  }
  if (diff.upsertTerms.length > 0) {
    await q
      .insert(planTerms)
      .values(diff.upsertTerms)
      .onConflictDoUpdate({
        target: [planTerms.centreId, planTerms.term, planTerms.origin],
        set: {
          class: sql`excluded.class`,
          wantCount: sql`excluded.want_count`,
          paidWantCount: sql`excluded.paid_want_count`,
          inBudget: sql`excluded.in_budget`,
          rank: sql`excluded.rank`,
        },
      })
  }
}

/** Centres holding a live (pending, submitted or completed) verification run. */
export async function selectLiveVerificationCentres(q: Queryable): Promise<Set<string>> {
  const rows = await q
    .select({ centreId: oneOffRuns.centreId })
    .from(oneOffRuns)
    .where(
      and(
        eq(oneOffRuns.purpose, 'verification'),
        inArray(oneOffRuns.status, ['pending', 'submitted', 'completed']),
      ),
    )
  return new Set(rows.map((r) => r.centreId).filter((id): id is string => id !== null))
}

/**
 * Inserts a one-off run. A second live verification of the same centre hits the partial unique
 * index and inserts nothing: returns undefined.
 */
export async function insertOneOffRun(
  q: Queryable,
  row: { purpose: string; input: unknown; centreId: string | null; approvedBy: string | null },
): Promise<string | undefined> {
  const [inserted] = await q
    .insert(oneOffRuns)
    .values(row)
    .onConflictDoNothing()
    .returning({ id: oneOffRuns.id })
  return inserted?.id
}

export async function selectLiveVerification(
  q: Queryable,
  centreId: string,
): Promise<string | undefined> {
  const [row] = await q
    .select({ id: oneOffRuns.id })
    .from(oneOffRuns)
    .where(
      and(
        eq(oneOffRuns.purpose, 'verification'),
        eq(oneOffRuns.centreId, centreId),
        inArray(oneOffRuns.status, ['pending', 'submitted', 'completed']),
      ),
    )
    .limit(1)
  return row?.id
}

export async function selectOneOffStatus(q: Queryable, id: string): Promise<string | undefined> {
  const [row] = await q
    .select({ status: oneOffRuns.status })
    .from(oneOffRuns)
    .where(eq(oneOffRuns.id, id))
    .limit(1)
  return row?.status
}

export async function updateOneOffStatus(q: Queryable, id: string, status: string): Promise<void> {
  await q.update(oneOffRuns).set({ status }).where(eq(oneOffRuns.id, id))
}

export async function selectAdminPair(
  q: Queryable,
  centreId: string,
  term: string,
): Promise<boolean> {
  const [row] = await q
    .select({ centreId: planTerms.centreId })
    .from(planTerms)
    .where(
      and(
        eq(planTerms.centreId, centreId),
        eq(planTerms.term, term),
        eq(planTerms.origin, 'admin-test'),
      ),
    )
    .limit(1)
  return row !== undefined
}

export async function selectPlanView(q: Queryable) {
  return q.select().from(vPlan).orderBy(vPlan.rank)
}

export async function selectOneOffRunsView(q: Queryable) {
  return q.select().from(vOneOffRuns).orderBy(vOneOffRuns.createdAt, vOneOffRuns.id)
}
