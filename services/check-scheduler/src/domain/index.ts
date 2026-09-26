// Pure logic of check-scheduler: which run each region gets this tick, and the actor input it
// sends. No I/O, no clock: the tick passes `now` in (CLAUDE.md; _rules.md rule 2).

import type { CheckSchedulerSearchShapeConfig } from '@nabvy/config/modules/check-scheduler'
import type {
  CheckSchedulerKind,
  CheckSchedulerReason,
  CheckSchedulerShape,
  CheckSchedulerWaiting,
} from '@nabvy/contracts/modules/check-scheduler'
import type { SearchPlannerTermClass } from '@nabvy/contracts/modules/search-planner'
import {
  SPEND_GOVERNOR_LEVELS,
  type SpendGovernorLevel,
} from '@nabvy/contracts/modules/spend-governor'

/** The limits a tick works within; the defaults come from `@nabvy/config` (index.ts). */
export interface Limits {
  tickSeconds: number
  newestCadenceS: number
  sweepCadenceS: number
  activeHours: { from: number; to: number }
  slowFactor: number
  maxTermsPerRun: number
  listingsPerPage: number
  maxListings: number
  maxRequests: number
  timeoutMarginS: number
  shapes: Record<CheckSchedulerShape, CheckSchedulerSearchShapeConfig>
}

/** One runnable (centre, term) pair from search-planner's `v_plan`. */
export interface PlanPair {
  centreId: string
  term: string
  class: SearchPlannerTermClass
  paidWantCount: number
  rank: number
}

/** One row of this module's `schedule`. */
export interface ScheduleRow {
  centreId: string
  termClass: SearchPlannerTermClass
  kind: CheckSchedulerKind
  cadenceS: number
  nextDueAt: Date
  lastRunAt: Date | null
}

/** A rerun waiting for a tick (a `pending` row of `check_runs`). */
export interface PendingRerun {
  id: string
  centreId: string
  kind: CheckSchedulerKind
  shape: CheckSchedulerShape
  terms: string[]
}

/** A search-planner one-off run this module may carry out. */
export interface OneOff {
  id: string
  purpose: 'verification' | 'gap-fill' | 'actor-test' | 'fixture'
  centreId: string
  terms: string[]
}

/** What one region gets this tick. */
export interface Decision {
  centreId: string
  kind: CheckSchedulerKind
  shape: CheckSchedulerShape
  reason: CheckSchedulerReason
  terms: string[]
  /** The pending rerun row it sends. */
  rerunId?: string
  oneOffId?: string
  /** Schedule rows it satisfies, each with the cadence it is next due at. */
  schedule: { termClass: SearchPlannerTermClass; kind: CheckSchedulerKind; cadenceS: number }[]
  /** Ordering under the ramp cap: paid regions first, then the kind, then yield, then rank. */
  paid: boolean
  yield: number
  rank: number
}

export interface TickInput {
  now: Date
  tickAt: Date
  level: SpendGovernorLevel
  /** Term checks still allowed today under source-health's ramp. */
  remainingChecks: number
  plan: PlanPair[]
  schedule: ScheduleRow[]
  reruns: PendingRerun[]
  oneOffs: OneOff[]
  /** New listings found per region in the yield window (`v_check_runs` × `v_sightings`). */
  yields: Map<string, number>
}

export interface TickPlan {
  runs: Decision[]
  waiting: CheckSchedulerWaiting[]
}

const levelIndex = (level: SpendGovernorLevel) => SPEND_GOVERNOR_LEVELS.indexOf(level)
export const levelAtLeast = (level: SpendGovernorLevel, floor: SpendGovernorLevel) =>
  levelIndex(level) >= levelIndex(floor)

/** The tick slot `now` falls in: a retried tick in the same slot is the same tick. */
export function tickSlot(now: Date, tickSeconds: number): Date {
  const ms = tickSeconds * 1000
  return new Date(Math.floor(now.getTime() / ms) * ms)
}

function londonParts(date: Date): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) }
}

/** The London calendar day, the unit of source-health's ramp cap. */
export const londonDay = (date: Date) => londonParts(date).day

/** The start of `date`'s London calendar day, as an instant. */
export function londonDayStart(date: Date): Date {
  const day = londonDay(date)
  // Midnight UTC of that date, moved back by London's offset at that midnight (0 or 1 hour).
  const utcMidnight = new Date(`${day}T00:00:00Z`)
  const hourThere = londonParts(utcMidnight).hour
  return new Date(utcMidnight.getTime() - hourThere * 3_600_000)
}

/** Newest-first checks run only in the active hours (card: "frequent, daytime"). */
export function inActiveHours(now: Date, hours: { from: number; to: number }): boolean {
  const { hour } = londonParts(now)
  return hour >= hours.from && hour < hours.to
}

/**
 * A check's cadence under the throttle, in the owner's order (`docs/decisions.md`, "favouring
 * paying subscribers"; `actor-integration.md` 2.12): `slow-free` slows newest checks that only
 * free wants need; `slow-paid` slows every newest check; `slow-sweeps` also slows sweeps;
 * `hold-new` keeps all of that and starts no new pair (`startsNew`).
 */
export function cadenceFor(
  kind: CheckSchedulerKind,
  paid: boolean,
  level: SpendGovernorLevel,
  limits: Pick<Limits, 'newestCadenceS' | 'sweepCadenceS' | 'slowFactor'>,
): number {
  if (kind === 'sweep') {
    return limits.sweepCadenceS * (levelAtLeast(level, 'slow-sweeps') ? limits.slowFactor : 1)
  }
  let factor = 1
  if (!paid && levelAtLeast(level, 'slow-free')) factor *= limits.slowFactor
  if (levelAtLeast(level, 'slow-paid')) factor *= limits.slowFactor
  return limits.newestCadenceS * factor
}

/** `hold-new` starts no new pair and no new one-off; queued work (reruns) still goes. */
export const startsNew = (level: SpendGovernorLevel) => !levelAtLeast(level, 'hold-new')

/** The gateway shape of a scheduled check. `catch-up` has none: T2 dropped it. */
export function shapeFor(kind: CheckSchedulerKind, termClass: SearchPlannerTermClass) {
  if (kind === 'newest') return 'newest-check' as const
  if (kind === 'sweep')
    return termClass === 'broad' ? ('sweep-broad' as const) : ('sweep-narrow' as const)
  return null
}

/**
 * The actor input of one search run (supabase/README.md, "Input rules"; source-adapters'
 * presets): searches only, details off (`includeDetails: false`, card), an explicit `sort` (the
 * schema states no default), pages shrunk so `maxListings` stays within the schema's 5,000, the
 * request budget of source-adapters' `requestBudget` (1 bootstrap + pages + 1 spare a term) under
 * the gateway's 1,000, detail cache and browser fallback off, the GB residential proxy.
 */
export function searchInput(
  centreId: string,
  terms: readonly string[],
  shape: CheckSchedulerShape,
  limits: Limits,
): { input: Record<string, unknown>; memoryMb: 512 | 1024 | 2048; timeoutSecs: number } {
  const cfg = limits.shapes[shape]
  const n = terms.length
  if (n === 0 || n > limits.maxTermsPerRun) {
    throw new RangeError(`a search run holds 1-${limits.maxTermsPerRun} terms, not ${n}`)
  }
  const pages = Math.max(
    1,
    Math.min(cfg.pages, Math.floor(limits.maxListings / (n * limits.listingsPerPage))),
  )
  return {
    input: {
      inputVersion: 3,
      searchTerms: [...terms],
      cityId: centreId,
      sort: cfg.sort,
      includeDetails: false,
      maxListings: n * pages * limits.listingsPerPage,
      maxPagesPerSearch: pages,
      maxRequests: Math.min(limits.maxRequests, n * (pages + 2)),
      maxRunSeconds: cfg.maxRunSeconds,
      browserFallback: false,
      useDetailCache: false,
      sourceDiagnostics: true,
      proxyConfiguration: {
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL'],
        apifyProxyCountry: 'GB',
      },
    },
    memoryMb: cfg.memoryMb,
    timeoutSecs: cfg.maxRunSeconds + limits.timeoutMarginS,
  }
}

const KIND_ORDER: Record<CheckSchedulerReason, number> = {
  rerun: 0,
  verification: 1,
  'one-off': 2,
  scheduled: 3,
}

/** Paid regions first, then reruns and one-offs, newest before sweep, yield, rank, centre. */
export function compareDecisions(a: Decision, b: Decision): number {
  return (
    Number(b.paid) - Number(a.paid) ||
    KIND_ORDER[a.reason] - KIND_ORDER[b.reason] ||
    Number(a.kind === 'sweep') - Number(b.kind === 'sweep') ||
    b.yield - a.yield ||
    a.rank - b.rank ||
    a.centreId.localeCompare(b.centreId)
  )
}

interface Region {
  centreId: string
  byClass: Map<SearchPlannerTermClass, PlanPair[]>
  paid: boolean
  rank: number
}

function regionsOf(plan: PlanPair[]): Map<string, Region> {
  const regions = new Map<string, Region>()
  const sorted = [...plan].sort((a, b) => a.rank - b.rank || a.term.localeCompare(b.term))
  for (const pair of sorted) {
    let region = regions.get(pair.centreId)
    if (!region) {
      region = { centreId: pair.centreId, byClass: new Map(), paid: false, rank: pair.rank }
      regions.set(pair.centreId, region)
    }
    const pairs = region.byClass.get(pair.class) ?? []
    pairs.push(pair)
    region.byClass.set(pair.class, pairs)
    region.paid ||= pair.paidWantCount > 0
  }
  return regions
}

// Broad terms are swept first: fast alerts for "Pc"-style listings depend on how often broad
// terms are swept (card; fb-scrap-engine/docs/design/SCALE_PLAN.md:50-53).
const SWEEP_ORDER: SearchPlannerTermClass[] = ['broad', 'narrow']
const NEWEST_ORDER: SearchPlannerTermClass[] = ['narrow', 'broad']

type Due = 'due' | 'not-due' | 'new'

function dueState(row: ScheduleRow | undefined, cadenceS: number, tickAt: Date): Due {
  if (!row?.lastRunAt) return 'new'
  return row.lastRunAt.getTime() + cadenceS * 1000 <= tickAt.getTime() ? 'due' : 'not-due'
}

/**
 * The region's one run this tick, if any (card: "All of a region's due terms go in one run"; the
 * test "one run per region per tick"), in this order: its oldest pending rerun; a pending
 * one-off; its newest-first check (in active hours, all due term classes together); one due
 * sweep (broad first). A pair never run before is new: `hold-new` holds it.
 */
function decideRegion(
  centreId: string,
  region: Region | undefined,
  input: TickInput,
  limits: Limits,
  bySchedule: Map<string, ScheduleRow>,
): { decision?: Decision; held: boolean } {
  const base = {
    centreId,
    paid: region?.paid ?? false,
    yield: input.yields.get(centreId) ?? 0,
    rank: region?.rank ?? Number.MAX_SAFE_INTEGER,
  }
  const rerun = input.reruns.find((r) => r.centreId === centreId)
  if (rerun) {
    return {
      held: false,
      decision: {
        ...base,
        kind: rerun.kind,
        shape: rerun.shape,
        reason: 'rerun',
        terms: rerun.terms,
        rerunId: rerun.id,
        schedule: [],
      },
    }
  }
  let held = false
  const oneOff = input.oneOffs.find((o) => o.centreId === centreId)
  if (oneOff) {
    if (!startsNew(input.level)) held = true
    else {
      const verification = oneOff.purpose === 'verification'
      return {
        held: false,
        decision: {
          ...base,
          kind: 'newest',
          shape: verification ? 'verification' : 'newest-check',
          reason: verification ? 'verification' : 'one-off',
          terms: oneOff.terms.slice(0, limits.maxTermsPerRun),
          oneOffId: oneOff.id,
          schedule: [],
        },
      }
    }
  }
  if (!region) return { held }

  const key = (termClass: string, kind: string) => `${centreId}|${termClass}|${kind}`
  const pick = (termClass: SearchPlannerTermClass, kind: CheckSchedulerKind) => {
    const pairs = region.byClass.get(termClass)
    if (!pairs) return undefined
    const paid = pairs.some((p) => p.paidWantCount > 0)
    const cadenceS = cadenceFor(kind, paid, input.level, limits)
    const state = dueState(bySchedule.get(key(termClass, kind)), cadenceS, input.tickAt)
    if (state === 'not-due') return undefined
    if (state === 'new' && !startsNew(input.level)) {
      held = true
      return undefined
    }
    return { termClass, kind, cadenceS, terms: pairs.map((p) => p.term) }
  }

  if (inActiveHours(input.now, limits.activeHours)) {
    const due = NEWEST_ORDER.map((c) => pick(c, 'newest')).filter((d) => d !== undefined)
    if (due.length > 0) {
      return {
        held: false,
        decision: {
          ...base,
          kind: 'newest',
          shape: 'newest-check',
          reason: 'scheduled',
          terms: due.flatMap((d) => d.terms).slice(0, limits.maxTermsPerRun),
          schedule: due.map(({ termClass, kind, cadenceS }) => ({ termClass, kind, cadenceS })),
        },
      }
    }
  }
  for (const termClass of SWEEP_ORDER) {
    const due = pick(termClass, 'sweep')
    if (!due) continue
    return {
      held: false,
      decision: {
        ...base,
        kind: 'sweep',
        shape: shapeFor('sweep', termClass) as CheckSchedulerShape,
        reason: 'scheduled',
        terms: due.terms.slice(0, limits.maxTermsPerRun),
        schedule: [{ termClass, kind: 'sweep', cadenceS: due.cadenceS }],
      },
    }
  }
  return { held }
}

/**
 * The tick's runs: at most one per region, ordered (paid first) and cut to source-health's ramp
 * cap, counted in term checks. A region that does not fit waits for a later tick; nothing queued
 * is dropped (card; `actor-integration.md` 2.12).
 */
export function planTick(input: TickInput, limits: Limits): TickPlan {
  const regions = regionsOf(input.plan)
  const bySchedule = new Map(
    input.schedule.map((r) => [`${r.centreId}|${r.termClass}|${r.kind}`, r] as const),
  )
  const centres = [
    ...new Set([
      ...input.reruns.map((r) => r.centreId),
      ...input.oneOffs.map((o) => o.centreId),
      ...regions.keys(),
    ]),
  ].sort()
  const decisions: Decision[] = []
  const waiting: CheckSchedulerWaiting[] = []
  for (const centreId of centres) {
    const { decision, held } = decideRegion(
      centreId,
      regions.get(centreId),
      input,
      limits,
      bySchedule,
    )
    if (decision) decisions.push(decision)
    else if (held) waiting.push({ centreId, why: 'hold-new' })
  }
  decisions.sort(compareDecisions)
  let remaining = input.remainingChecks
  const runs: Decision[] = []
  for (const decision of decisions) {
    if (decision.terms.length <= remaining) {
      runs.push(decision)
      remaining -= decision.terms.length
    } else {
      waiting.push({ centreId: decision.centreId, why: 'ramp-cap' })
    }
  }
  return { runs, waiting }
}

/** Degraded searches to rerun: only those of this module's own runs, and never a rerun's. */
export function rerunnable<T extends { jobId: number }>(
  searches: T[],
  runsByJob: Map<number, { reason: CheckSchedulerReason }>,
): T[] {
  return searches.filter((s) => {
    const run = runsByJob.get(s.jobId)
    return run !== undefined && run.reason !== 'rerun'
  })
}
