// Public API of the search-planner module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/search-planner' only, never from its internals. It decides
// what to search (verified centre x a few terms, never per user) and holds the one-off runs; it
// never schedules or submits a run (card, "Does / does not"). Everything runs inside
// withPipeline, as nabvy_pipeline; admin callers check the session and role first.
import { record } from '@nabvy/audit-log'
import {
  SEARCH_PLANNER_CONTAINER_TERMS,
  SEARCH_PLANNER_EVENT_BATCH_SIZE,
  SEARCH_PLANNER_MAX_ACTIVE_PAIRS,
} from '@nabvy/config/modules/search-planner'
import { createEvent, type EventEnvelope } from '@nabvy/contracts'
import {
  events,
  SearchPlannerAdminTestPairInput,
  type SearchPlannerOneOffRun,
  type SearchPlannerPlan,
  SearchPlannerRecordOneOffInput,
  SearchPlannerSetOneOffStatusInput,
  SearchPlannerTerm,
} from '@nabvy/contracts/modules/search-planner'
import type { Queryable } from '@nabvy/db'
import { state } from '@nabvy/switches'
import {
  canTransition,
  computePlan,
  diffPlan,
  type PlanRow,
  type PlanTermRow,
  planChangedKey,
  SearchPlannerRefused,
  termOf,
} from './domain'
import {
  applyPlanDiff,
  insertOneOffRun,
  selectAdminPair,
  selectCentres,
  selectLiveVerification,
  selectLiveVerificationCentres,
  selectOneOffRunsView,
  selectOneOffStatus,
  selectPlanView,
  selectStoredPlan,
  selectWantTerms,
  updateOneOffStatus,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/search-planner'
export {
  classOf,
  computePlan,
  diffPlan,
  planChangedKey,
  SearchPlannerRefused,
  termOf,
} from './domain'
export { onWantManagerChanged } from './handlers'

// ---------------------------------------------------------------------------------------------
// Ports (soft edges, injected so tests and callers without them still run)
// ---------------------------------------------------------------------------------------------

/**
 * Related-search terms from `side-discovery`, a soft edge (`docs/design/modules/soft-edges.json`
 * pattern): suggestions only (card). They are returned for an admin to look at and never enter
 * the plan; origin `pivot` stays unused until the owner decides how a suggestion is accepted
 * (docs/questions/search-planner.md).
 */
export type PivotSuggestions = (
  q: Queryable,
  centreIds: string[],
) => Promise<{ centreId: string; term: string }[]>

/** The documented stub while `side-discovery` is not built: no suggestions. */
export const noPivotSuggestions: PivotSuggestions = async () => []

export interface SearchPlannerDeps {
  pivotSuggestions?: PivotSuggestions
}

// ---------------------------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------------------------

function changedEvents(
  centreIds: string[],
  next: { terms: PlanTermRow[]; plans: PlanRow[] },
): EventEnvelope[] {
  const out: EventEnvelope[] = []
  for (let i = 0; i < centreIds.length; i += SEARCH_PLANNER_EVENT_BATCH_SIZE) {
    const batch = centreIds.slice(i, i + SEARCH_PLANNER_EVENT_BATCH_SIZE)
    out.push(
      createEvent(
        events,
        'search-planner.plan-changed',
        1,
        { centreIds: batch },
        { key: planChangedKey(batch, next) },
      ) as EventEnvelope,
    )
  }
  return out
}

async function replanWith(
  q: Queryable,
  adminChange?: {
    add?: { centreId: string; term: string }
    remove?: { centreId: string; term: string }
  },
): Promise<{ events: EventEnvelope[]; verificationRunIds: string[] }> {
  const [wantTerms, centres, stored, wantManager, liveVerifications] = await Promise.all([
    selectWantTerms(q),
    selectCentres(q),
    selectStoredPlan(q),
    state(q, 'want-manager'),
    selectLiveVerificationCentres(q),
  ])
  let adminPairs = stored.terms
    .filter((r) => r.origin === 'admin-test')
    .map(({ centreId, term }) => ({ centreId, term }))
  if (adminChange?.remove) {
    const { centreId, term } = adminChange.remove
    adminPairs = adminPairs.filter((p) => p.centreId !== centreId || p.term !== term)
  }
  if (adminChange?.add) adminPairs.push(adminChange.add)

  const next = computePlan({
    wantTerms,
    adminPairs,
    centres,
    dropAdminTest: wantManager === 'on',
    containerTerms: SEARCH_PLANNER_CONTAINER_TERMS,
    maxPairs: SEARCH_PLANNER_MAX_ACTIVE_PAIRS,
  })
  const diff = diffPlan(stored, next)
  await applyPlanDiff(q, diff)

  const verificationRunIds: string[] = []
  for (const v of next.verifications) {
    if (liveVerifications.has(v.centreId)) continue
    const id = await insertOneOffRun(q, {
      purpose: 'verification',
      input: { centreId: v.centreId, terms: [v.term] },
      centreId: v.centreId,
      approvedBy: null,
    })
    if (id) verificationRunIds.push(id)
  }
  return { events: changedEvents(diff.changedCentres, next), verificationRunIds }
}

/**
 * Recomputes the whole plan from want-manager's counts per centre, city-pages' centres and the
 * stored admin-test pairs, writes only what changed, and records a verification run for each
 * active, unverified centre a pair needs (no approval: the owner allowed them in general). A
 * replay writes nothing and returns no event. Off: writes nothing (card, "When off: no plan").
 * Returns the `plan-changed` envelopes for the caller to publish after its transaction commits.
 */
export async function replan(
  q: Queryable,
): Promise<{ events: EventEnvelope[]; verificationRunIds: string[] }> {
  if ((await state(q, 'search-planner')) === 'off') return { events: [], verificationRunIds: [] }
  return replanWith(q)
}

/** The runnable pairs (`search_planner.v_plan`), in budget rank order. */
export async function listPlan(q: Queryable): Promise<SearchPlannerPlan[]> {
  const rows = await selectPlanView(q)
  return rows.map((r) => ({
    centreId: r.centreId,
    term: r.term,
    class: r.class as SearchPlannerPlan['class'],
    origins: r.origins as SearchPlannerPlan['origins'],
    wantCount: r.wantCount,
    paidWantCount: r.paidWantCount,
    rank: r.rank,
  }))
}

/**
 * Related-search suggestions for these centres, from the injected `side-discovery` port, as
 * valid terms only. Suggestions only: nothing is written and no pair changes.
 */
export async function pivotSuggestions(
  q: Queryable,
  centreIds: string[],
  deps: SearchPlannerDeps = {},
): Promise<{ centreId: string; term: string }[]> {
  const raw = await (deps.pivotSuggestions ?? noPivotSuggestions)(q, centreIds)
  return raw.flatMap((s) => {
    const term = termOf(s.term)
    return term === null ? [] : [{ centreId: s.centreId, term }]
  })
}

// ---------------------------------------------------------------------------------------------
// The admin test hunt
// ---------------------------------------------------------------------------------------------

async function refuseUnlessUsable(q: Queryable): Promise<void> {
  if ((await state(q, 'search-planner')) === 'off') {
    throw new SearchPlannerRefused('search-planner.off', 'search-planner is off')
  }
}

/**
 * Enters the owner's test hunt as one admin pair with origin `admin-test` (card; task 1.2b),
 * audited in the same transaction. Refused once want-manager is on: from then the team's own
 * want carries the hunt, and `replan` drops any admin pair left. Idempotent: an existing pair
 * is not added again and writes no second audit row.
 */
export async function addAdminTestPair(
  q: Queryable,
  raw: SearchPlannerAdminTestPairInput,
): Promise<{ added: boolean; events: EventEnvelope[] }> {
  const input = SearchPlannerAdminTestPairInput.parse(raw)
  await refuseUnlessUsable(q)
  if ((await state(q, 'want-manager')) === 'on') {
    throw new SearchPlannerRefused(
      'search-planner.want_manager_on',
      'want-manager is on: the test hunt is a want, not an admin pair',
    )
  }
  if (await selectAdminPair(q, input.centreId, input.term)) return { added: false, events: [] }
  await record(q, {
    actorUserId: input.actorUserId,
    action: 'search-planner.admin-test-pair-added',
    target: `centre:${input.centreId}`,
    after: { term: input.term, origin: 'admin-test' },
    reason: input.reason,
  })
  const { events: out } = await replanWith(q, {
    add: { centreId: input.centreId, term: input.term },
  })
  return { added: true, events: out }
}

/** Removes an admin-test pair, audited. `search-planner.not_found` if there is none. */
export async function removeAdminTestPair(
  q: Queryable,
  raw: SearchPlannerAdminTestPairInput,
): Promise<{ events: EventEnvelope[] }> {
  const input = SearchPlannerAdminTestPairInput.parse(raw)
  await refuseUnlessUsable(q)
  if (!(await selectAdminPair(q, input.centreId, input.term))) {
    throw new SearchPlannerRefused('search-planner.not_found', 'no such admin-test pair')
  }
  await record(q, {
    actorUserId: input.actorUserId,
    action: 'search-planner.admin-test-pair-removed',
    target: `centre:${input.centreId}`,
    before: { term: input.term, origin: 'admin-test' },
    reason: input.reason,
  })
  const { events: out } = await replanWith(q, {
    remove: { centreId: input.centreId, term: input.term },
  })
  return { events: out }
}

// ---------------------------------------------------------------------------------------------
// One-off runs
// ---------------------------------------------------------------------------------------------

/**
 * Records a one-off run for `check-scheduler` to submit. A verification run needs no approval
 * and is held once per centre (a replay returns the live one). Every other purpose (gap-fill,
 * actor test, fixture) is refused without the owner's approval, which is written to the audit
 * log in the same transaction (card).
 */
export async function recordOneOffRun(
  q: Queryable,
  raw: SearchPlannerRecordOneOffInput,
): Promise<{ id: string; created: boolean }> {
  const input = SearchPlannerRecordOneOffInput.parse(raw)
  await refuseUnlessUsable(q)
  if (input.purpose === 'verification') {
    const centreId = input.input.centreId
    if (!centreId || !input.input.terms || input.input.terms.length !== 1) {
      throw new SearchPlannerRefused(
        'search-planner.invalid_transition',
        'a verification run names one centre and one term',
      )
    }
    const id = await insertOneOffRun(q, {
      purpose: 'verification',
      input: input.input,
      centreId,
      approvedBy: null,
    })
    if (id) return { id, created: true }
    const live = await selectLiveVerification(q, centreId)
    if (!live) throw new Error(`search-planner: verification of ${centreId} neither new nor live`)
    return { id: live, created: false }
  }
  if (!input.approval) {
    throw new SearchPlannerRefused(
      'search-planner.approval_required',
      `a ${input.purpose} run needs the owner's audited approval`,
    )
  }
  const id = await insertOneOffRun(q, {
    purpose: input.purpose,
    input: input.input,
    centreId: input.input.centreId ?? null,
    approvedBy: input.approval.actorUserId,
  })
  if (!id) throw new Error('search-planner: one-off run not inserted')
  await record(q, {
    actorUserId: input.approval.actorUserId,
    action: 'search-planner.one-off-approved',
    target: `one-off-run:${id}`,
    after: { purpose: input.purpose, input: input.input },
    reason: input.approval.reason,
  })
  return { id, created: true }
}

/**
 * Moves a one-off run along its life (pending → submitted → completed | failed; pending →
 * cancelled). For `check-scheduler`, which submits runs; this module never does. Keeps recording
 * while the module is off, so a run already submitted can still finish. The same status again is
 * a no-op.
 */
export async function setOneOffRunStatus(
  q: Queryable,
  raw: SearchPlannerSetOneOffStatusInput,
): Promise<void> {
  const input = SearchPlannerSetOneOffStatusInput.parse(raw)
  const current = await selectOneOffStatus(q, input.id)
  if (current === undefined) {
    throw new SearchPlannerRefused('search-planner.not_found', `no one-off run ${input.id}`)
  }
  if (!canTransition(current, input.status)) {
    throw new SearchPlannerRefused(
      'search-planner.invalid_transition',
      `a ${current} run cannot become ${input.status}`,
    )
  }
  if (current !== input.status) await updateOneOffStatus(q, input.id, input.status)
}

/** Every one-off run (`search_planner.v_one_off_runs`), oldest first; never the approver's ID. */
export async function listOneOffRuns(q: Queryable): Promise<SearchPlannerOneOffRun[]> {
  const rows = await selectOneOffRunsView(q)
  return rows.map((r) => ({
    id: r.id,
    purpose: r.purpose as SearchPlannerOneOffRun['purpose'],
    input: r.input as SearchPlannerOneOffRun['input'],
    approved: r.approved,
    status: r.status as SearchPlannerOneOffRun['status'],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }))
}

/** A valid term or a refusal; exported for admin forms. */
export function parseTerm(term: string): string {
  return SearchPlannerTerm.parse(term)
}
