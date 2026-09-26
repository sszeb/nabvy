// Pure logic of the search-planner module: no I/O, no database, no clock. The plan is computed
// whole from want counts per centre, the centres' state and the admin-test pairs, then compared
// with what is stored, so a replay computes the same plan and writes nothing.
import { createHash } from 'node:crypto'
import {
  type SearchPlannerErrorCode,
  type SearchPlannerOrigin,
  SearchPlannerTerm,
  type SearchPlannerTermClass,
} from '@nabvy/contracts/modules/search-planner'

export class SearchPlannerRefused extends Error {
  constructor(
    readonly code: SearchPlannerErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'SearchPlannerRefused'
  }
}

/** One row of want-manager's `v_want_terms_by_centre`: counts per centre and family. */
export interface WantTermCount {
  centreId: string
  family: string
  wantCount: number
  paidWantCount: number
}

/** What the plan needs of a city-pages centre (`v_centres`). */
export interface CentreState {
  cityPageId: string
  active: boolean
  verified: boolean
}

/** One stored or computed `plan_terms` row. */
export interface PlanTermRow {
  centreId: string
  term: string
  origin: SearchPlannerOrigin
  class: SearchPlannerTermClass
  wantCount: number
  paidWantCount: number
  inBudget: boolean
  rank: number | null
}

export interface PlanRow {
  centreId: string
  active: boolean
}

export interface PlanInput {
  wantTerms: WantTermCount[]
  /** The admin-test pairs currently stored; dropped when `dropAdminTest` is set. */
  adminPairs: { centreId: string; term: string }[]
  centres: CentreState[]
  /** want-manager is `on`: the admin test hunt gives way to real wants (card; task 1.2b). */
  dropAdminTest: boolean
  containerTerms: readonly string[]
  maxPairs: number
}

export interface PlanOutput {
  terms: PlanTermRow[]
  plans: PlanRow[]
  /** Centres a want needs that are active but not verified: one verification run each. */
  verifications: { centreId: string; term: string }[]
}

/**
 * A family as a search term: lower case, spaces collapsed, trimmed ("RTX 5070 Ti" → "rtx 5070
 * ti"). Null when what is left is not a valid term; such a family names no pair. Never reads
 * listing text: families come from product-catalogue through want-manager's view.
 */
export function termOf(family: string): string | null {
  const term = family.toLowerCase().replace(/\s+/g, ' ').trim()
  return SearchPlannerTerm.safeParse(term).success ? term : null
}

export function classOf(term: string, containerTerms: readonly string[]): SearchPlannerTermClass {
  return containerTerms.includes(term) ? 'broad' : 'narrow'
}

const pairKey = (centreId: string, term: string) => `${centreId}\u0000${term}`

/**
 * The plan (README.md, "Rules and thresholds"):
 * - each family at a centre is a narrow pair counting its wants; the container terms are broad
 *   pairs at every centre with a family term, counting the most-wanted family's wants there (a
 *   lower bound: the view gives counts per family, and one want may name two families);
 * - admin-test pairs are kept as their own rows, counting no wants;
 * - a pair runs only at a centre that is active and verified in city-pages;
 * - runnable pairs are ranked, the admin test first, then paid wants, then all wants, then
 *   narrow before broad, then by centre and term, and the first `maxPairs` are in budget.
 * No user ID enters or leaves: the inputs are counts.
 */
export function computePlan(input: PlanInput): PlanOutput {
  const rows = new Map<string, PlanTermRow>()
  const add = (row: Omit<PlanTermRow, 'inBudget' | 'rank' | 'class'>) => {
    const key = `${pairKey(row.centreId, row.term)}\u0000${row.origin}`
    const existing = rows.get(key)
    if (existing) {
      existing.wantCount += row.wantCount
      existing.paidWantCount += row.paidWantCount
      return
    }
    rows.set(key, {
      ...row,
      class: classOf(row.term, input.containerTerms),
      inBudget: false,
      rank: null,
    })
  }

  const narrowByCentre = new Map<string, PlanTermRow[]>()
  for (const w of input.wantTerms) {
    const term = termOf(w.family)
    if (term === null || w.wantCount <= 0) continue
    add({
      centreId: w.centreId,
      term,
      origin: 'wants',
      wantCount: w.wantCount,
      paidWantCount: w.paidWantCount,
    })
  }
  for (const row of rows.values()) {
    if (row.class !== 'narrow') continue
    const list = narrowByCentre.get(row.centreId) ?? []
    list.push(row)
    narrowByCentre.set(row.centreId, list)
  }
  for (const [centreId, familyRows] of narrowByCentre) {
    const wantCount = Math.max(...familyRows.map((r) => r.wantCount))
    const paidWantCount = Math.max(...familyRows.map((r) => r.paidWantCount))
    for (const term of input.containerTerms) {
      const key = `${pairKey(centreId, term)}\u0000wants`
      const existing = rows.get(key)
      if (existing) {
        // A family that is itself a container term: keep the larger count, never a sum.
        existing.wantCount = Math.max(existing.wantCount, wantCount)
        existing.paidWantCount = Math.max(existing.paidWantCount, paidWantCount)
      } else {
        add({ centreId, term, origin: 'wants', wantCount, paidWantCount })
      }
    }
  }
  if (!input.dropAdminTest) {
    for (const pair of input.adminPairs) {
      add({ ...pair, origin: 'admin-test', wantCount: 0, paidWantCount: 0 })
    }
  }

  const centres = new Map(input.centres.map((c) => [c.cityPageId, c]))
  const runnable = (centreId: string) => {
    const c = centres.get(centreId)
    return c?.active === true && c.verified
  }

  // One budget slot per (centre, term), whatever its origins.
  const keys = new Map<
    string,
    { centreId: string; term: string; admin: boolean; paid: number; wants: number; cls: string }
  >()
  for (const row of rows.values()) {
    if (!runnable(row.centreId)) continue
    const key = pairKey(row.centreId, row.term)
    const k = keys.get(key) ?? {
      centreId: row.centreId,
      term: row.term,
      admin: false,
      paid: 0,
      wants: 0,
      cls: row.class,
    }
    k.admin ||= row.origin === 'admin-test'
    k.paid = Math.max(k.paid, row.paidWantCount)
    k.wants = Math.max(k.wants, row.wantCount)
    keys.set(key, k)
  }
  const ranked = [...keys.entries()].sort(
    ([, a], [, b]) =>
      Number(b.admin) - Number(a.admin) ||
      b.paid - a.paid ||
      b.wants - a.wants ||
      (a.cls === b.cls ? 0 : a.cls === 'narrow' ? -1 : 1) ||
      compare(a.centreId, b.centreId) ||
      compare(a.term, b.term),
  )
  const rankOf = new Map<string, number>()
  ranked.slice(0, Math.max(0, input.maxPairs)).forEach(([key], i) => {
    rankOf.set(key, i + 1)
  })
  for (const row of rows.values()) {
    const rank = rankOf.get(pairKey(row.centreId, row.term)) ?? null
    row.inBudget = rank !== null
    row.rank = rank
  }

  const terms = [...rows.values()].sort(compareRows)
  const centreIds = [...new Set(terms.map((r) => r.centreId))].sort(compare)
  const plans = centreIds.map((centreId) => ({ centreId, active: runnable(centreId) }))

  const verifications: PlanOutput['verifications'] = []
  for (const centreId of centreIds) {
    const c = centres.get(centreId)
    if (!c?.active || c.verified) continue
    const candidates = terms
      .filter((r) => r.centreId === centreId && r.class === 'narrow')
      .sort((a, b) => b.wantCount - a.wantCount || compare(a.term, b.term))
    const term = candidates[0]?.term ?? terms.find((r) => r.centreId === centreId)?.term
    if (term) verifications.push({ centreId, term })
  }
  return { terms, plans, verifications }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function compareRows(a: PlanTermRow, b: PlanTermRow): number {
  return compare(a.centreId, b.centreId) || compare(a.term, b.term) || compare(a.origin, b.origin)
}

const rowKey = (r: PlanTermRow) => `${pairKey(r.centreId, r.term)}\u0000${r.origin}`
const sameContent = (a: PlanTermRow, b: PlanTermRow) =>
  a.class === b.class &&
  a.wantCount === b.wantCount &&
  a.paidWantCount === b.paidWantCount &&
  a.inBudget === b.inBudget
const sameRow = (a: PlanTermRow, b: PlanTermRow) => sameContent(a, b) && a.rank === b.rank

export interface PlanDiff {
  upsertTerms: PlanTermRow[]
  deleteTerms: PlanTermRow[]
  upsertPlans: PlanRow[]
  deletePlans: string[]
  /**
   * Centres whose pairs, classes, counts, budget verdicts or activity change, sorted. A rank that
   * moves only because another centre changed is written but announces nothing, so one new want
   * does not wake the scheduler for every centre.
   */
  changedCentres: string[]
}

/** What to write to move the stored plan to `next`. Empty when nothing changed (a replay). */
export function diffPlan(
  stored: { terms: PlanTermRow[]; plans: PlanRow[] },
  next: { terms: PlanTermRow[]; plans: PlanRow[] },
): PlanDiff {
  const oldTerms = new Map(stored.terms.map((r) => [rowKey(r), r]))
  const newTerms = new Map(next.terms.map((r) => [rowKey(r), r]))
  const oldPlans = new Map(stored.plans.map((p) => [p.centreId, p]))
  const newPlans = new Map(next.plans.map((p) => [p.centreId, p]))
  const upsertTerms = next.terms.filter((r) => {
    const old = oldTerms.get(rowKey(r))
    return !old || !sameRow(old, r)
  })
  const deleteTerms = stored.terms.filter((r) => !newTerms.has(rowKey(r)))
  const upsertPlans = next.plans.filter((p) => oldPlans.get(p.centreId)?.active !== p.active)
  const deletePlans = stored.plans.filter((p) => !newPlans.has(p.centreId)).map((p) => p.centreId)
  const changedCentres = [
    ...new Set([
      ...upsertTerms
        .filter((r) => {
          const old = oldTerms.get(rowKey(r))
          return !old || !sameContent(old, r)
        })
        .map((r) => r.centreId),
      ...deleteTerms.map((r) => r.centreId),
      ...upsertPlans.map((p) => p.centreId),
      ...deletePlans,
    ]),
  ].sort(compare)
  return { upsertTerms, deleteTerms, upsertPlans, deletePlans, changedCentres }
}

/**
 * The `plan-changed` key for one batch of centres: the natural IDs plus the version of what
 * they now hold (rule 8), so replaying the same change yields the same key.
 */
export function planChangedKey(
  centreIds: string[],
  next: { terms: PlanTermRow[]; plans: PlanRow[] },
): string {
  const ids = new Set(centreIds)
  const state = {
    centres: [...ids].sort(compare),
    plans: next.plans.filter((p) => ids.has(p.centreId)),
    terms: next.terms.filter((r) => ids.has(r.centreId)),
  }
  const hash = createHash('sha256').update(JSON.stringify(state)).digest('hex')
  return `search-planner.plan-changed:${hash.slice(0, 16)}`
}

const TRANSITIONS: Record<string, readonly string[]> = {
  pending: ['submitted', 'failed', 'cancelled'],
  submitted: ['completed', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
}

/** Whether a one-off run may move from `from` to `to`; the same status is a no-op, allowed. */
export function canTransition(from: string, to: string): boolean {
  return from === to || (TRANSITIONS[from] ?? []).includes(to)
}
