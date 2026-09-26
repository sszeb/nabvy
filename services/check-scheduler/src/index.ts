// Public API of the check-scheduler module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/check-scheduler' only, never from its internals.
//
// Decides when each region's search checks run and submits each as one batched run through
// apify-gateway (docs/design/modules/check-scheduler.md). `tick` is one scheduler tick;
// `onSearchDegraded` queues reruns; `listRuns` reads `v_check_runs`.

import { readJobs, submitRun } from '@nabvy/apify-gateway'
import {
  CHECK_SCHEDULER_ACTIVE_HOURS,
  CHECK_SCHEDULER_LISTINGS_PER_PAGE,
  CHECK_SCHEDULER_MAX_LISTINGS,
  CHECK_SCHEDULER_MAX_REQUESTS,
  CHECK_SCHEDULER_MAX_TERMS_PER_RUN,
  CHECK_SCHEDULER_NEWEST_CADENCE_S,
  CHECK_SCHEDULER_NEWEST_SHAPE,
  CHECK_SCHEDULER_SLOW_FACTOR,
  CHECK_SCHEDULER_SWEEP_CADENCE_S,
  CHECK_SCHEDULER_SWEEP_SHAPE,
  CHECK_SCHEDULER_TICK_SECONDS,
  CHECK_SCHEDULER_TIMEOUT_MARGIN_S,
  CHECK_SCHEDULER_VERIFICATION_SHAPE,
  CHECK_SCHEDULER_YIELD_WINDOW_DAYS,
} from '@nabvy/config/modules/check-scheduler'
import type { Result } from '@nabvy/contracts'
import type {
  ApifyGatewayError,
  ApifyGatewayJob,
  ApifyGatewaySubmitRunInput,
  ApifyGatewaySubmitted,
} from '@nabvy/contracts/modules/apify-gateway'
import {
  CheckSchedulerRun,
  type CheckSchedulerTickReport,
  type CheckSchedulerTickRun,
} from '@nabvy/contracts/modules/check-scheduler'
import type {
  SearchPlannerOneOffRun,
  SearchPlannerPlan,
  SearchPlannerSetOneOffStatusInput,
} from '@nabvy/contracts/modules/search-planner'
import type { SourceHealthRampStage } from '@nabvy/contracts/modules/source-health'
import type { SpendGovernorLevel } from '@nabvy/contracts/modules/spend-governor'
import type { Queryable } from '@nabvy/db'
import { vCheckRuns } from '@nabvy/db/schema/check-scheduler'
import { listOneOffRuns, listPlan, setOneOffRunStatus } from '@nabvy/search-planner'
import { recommendRampStage } from '@nabvy/source-health'
import { readThrottle } from '@nabvy/spend-governor'
import { isOn, state } from '@nabvy/switches'
import { asc } from 'drizzle-orm'
import {
  type Decision,
  type Limits,
  londonDayStart,
  type OneOff,
  planTick,
  searchInput,
  tickSlot,
} from './domain'
import {
  countChecksSince,
  deleteStaleSchedule,
  insertRun,
  lockTick,
  markRerun,
  selectClaimed,
  selectLiveOneOffIds,
  selectOpenOneOffs,
  selectPendingReruns,
  selectSchedule,
  selectYields,
  upsertSchedule,
} from './repo'

export { events, module } from '@nabvy/contracts/modules/check-scheduler'
export {
  cadenceFor,
  compareDecisions,
  inActiveHours,
  levelAtLeast,
  londonDay,
  planTick,
  searchInput,
  shapeFor,
  startsNew,
  tickSlot,
} from './domain'
export { onSearchDegraded } from './handlers'

const MODULE = 'check-scheduler'

/** The limits from `@nabvy/config` (rule 14). */
export const defaultLimits: Limits = {
  tickSeconds: CHECK_SCHEDULER_TICK_SECONDS,
  newestCadenceS: CHECK_SCHEDULER_NEWEST_CADENCE_S,
  sweepCadenceS: CHECK_SCHEDULER_SWEEP_CADENCE_S,
  activeHours: CHECK_SCHEDULER_ACTIVE_HOURS,
  slowFactor: CHECK_SCHEDULER_SLOW_FACTOR,
  maxTermsPerRun: CHECK_SCHEDULER_MAX_TERMS_PER_RUN,
  listingsPerPage: CHECK_SCHEDULER_LISTINGS_PER_PAGE,
  maxListings: CHECK_SCHEDULER_MAX_LISTINGS,
  maxRequests: CHECK_SCHEDULER_MAX_REQUESTS,
  timeoutMarginS: CHECK_SCHEDULER_TIMEOUT_MARGIN_S,
  shapes: {
    verification: CHECK_SCHEDULER_VERIFICATION_SHAPE,
    'newest-check': CHECK_SCHEDULER_NEWEST_SHAPE,
    'sweep-narrow': CHECK_SCHEDULER_SWEEP_SHAPE,
    'sweep-broad': CHECK_SCHEDULER_SWEEP_SHAPE,
  },
}

/**
 * The other modules' exported functions a tick calls, injectable so tests never submit a live
 * run (the gateway is a fake there).
 */
export interface CheckSchedulerPorts {
  submitRun(
    q: Queryable,
    request: ApifyGatewaySubmitRunInput,
  ): Promise<Result<ApifyGatewaySubmitted, ApifyGatewayError>>
  readJobs(q: Queryable, jobIds: number[]): Promise<ApifyGatewayJob[]>
  readThrottle(q: Queryable): Promise<{ level: SpendGovernorLevel }>
  recommendRampStage(q: Queryable): Promise<SourceHealthRampStage>
  listPlan(q: Queryable): Promise<SearchPlannerPlan[]>
  listOneOffRuns(q: Queryable): Promise<SearchPlannerOneOffRun[]>
  setOneOffRunStatus(q: Queryable, input: SearchPlannerSetOneOffStatusInput): Promise<void>
}

export const defaultPorts: CheckSchedulerPorts = {
  submitRun,
  readJobs,
  readThrottle,
  recommendRampStage,
  listPlan,
  listOneOffRuns,
  setOneOffRunStatus,
}

export interface TickDeps {
  ports?: CheckSchedulerPorts
  limits?: Limits
  /** The tick's clock; defaults to now. */
  now?: Date
}

/** A one-off run this module can carry out: a search at a centre, approved or a verification. */
function searchOneOff(run: SearchPlannerOneOffRun): OneOff | undefined {
  if (run.status !== 'pending') return undefined
  if (!run.approved && run.purpose !== 'verification') return undefined
  const { centreId, terms, listingIds } = run.input
  if (!centreId || !terms || listingIds) return undefined
  return { id: run.id, purpose: run.purpose, centreId, terms }
}

/**
 * Marks sent one-off runs completed or failed once their gateway job ends, through
 * search-planner's `setOneOffRunStatus` (this module submits them; search-planner records them).
 */
async function settleOneOffs(q: Queryable, ports: CheckSchedulerPorts): Promise<void> {
  const open = await selectOpenOneOffs(q)
  if (open.length === 0) return
  const jobs = new Map(
    (
      await ports.readJobs(
        q,
        open.map((o) => o.jobId),
      )
    ).map((j) => [j.id, j]),
  )
  for (const { oneOffId, jobId } of open) {
    const job = jobs.get(jobId)
    if (!job) continue
    if (job.status === 'succeeded') {
      await ports.setOneOffRunStatus(q, { id: oneOffId, status: 'completed' })
    } else if (job.status === 'failed' || job.status === 'refused') {
      await ports.setOneOffRunStatus(q, { id: oneOffId, status: 'failed' })
    }
  }
}

/**
 * One scheduler tick, in one pipeline transaction (the caller runs it inside `withPipeline`).
 * Off (module or pipeline): does nothing and writes nothing (card, "When off"). Otherwise, under
 * a transaction-scoped advisory lock: reads the spend throttle first and source-health's ramp
 * cap, then search-planner's plan and one-off runs, decides at most one run per region
 * (`planTick`) and submits each through apify-gateway's `submitRun`. Each run claims its region's
 * tick slot in the same transaction, so a retried tick in the same slot submits nothing twice.
 * Shadow: decides and records (`status: shadow`) but submits nothing.
 */
export async function tick(q: Queryable, deps: TickDeps = {}): Promise<CheckSchedulerTickReport> {
  const ports = deps.ports ?? defaultPorts
  const limits = deps.limits ?? defaultLimits
  const now = deps.now ?? new Date()
  const tickAt = tickSlot(now, limits.tickSeconds)
  await lockTick(q)
  const mode = await state(q, MODULE)
  if (mode === 'off' || !(await isOn(q, 'pipeline'))) return { status: 'off' }
  const tickIso = tickAt.toISOString()

  // A retried tick finds every region it ran already claimed.
  const claimed = await selectClaimed(q, tickAt)

  // The throttle is read before anything is submitted (rule 13); it fails closed to hold-new.
  const { level } = await ports.readThrottle(q)
  const ramp = await ports.recommendRampStage(q)
  const used = await countChecksSince(q, londonDayStart(now))

  if (mode === 'on') await settleOneOffs(q, ports)

  const plan = await ports.listPlan(q)
  const liveOneOffs = await selectLiveOneOffIds(q)
  const oneOffs =
    mode === 'on'
      ? (await ports.listOneOffRuns(q))
          .map(searchOneOff)
          .filter((o): o is OneOff => o !== undefined && !liveOneOffs.has(o.id))
      : []
  await deleteStaleSchedule(
    q,
    plan.map((p) => ({ centreId: p.centreId, termClass: p.class })),
  )
  const yields = await selectYields(
    q,
    new Date(now.getTime() - CHECK_SCHEDULER_YIELD_WINDOW_DAYS * 86_400_000),
  )
  const unclaimed = <T extends { centreId: string }>(rows: T[]) =>
    rows.filter((r) => !claimed.has(r.centreId))
  const decided = planTick(
    {
      now,
      tickAt,
      level,
      remainingChecks: Math.max(0, ramp.maxChecksPerDay - used),
      plan: unclaimed(plan),
      schedule: await selectSchedule(q),
      reruns: unclaimed(await selectPendingReruns(q)),
      oneOffs: unclaimed(oneOffs),
      yields,
    },
    limits,
  )
  if (claimed.size > 0 && decided.runs.length === 0) return { status: 'done', tickAt: tickIso }

  const runs: CheckSchedulerTickRun[] = []
  for (const decision of decided.runs) {
    runs.push(await send(q, ports, limits, decision, tickAt, mode === 'on'))
  }
  return {
    status: 'ran',
    tickAt: tickIso,
    level,
    maxChecksPerDay: ramp.maxChecksPerDay,
    runs,
    waiting: decided.waiting,
  }
}

async function send(
  q: Queryable,
  ports: CheckSchedulerPorts,
  limits: Limits,
  decision: Decision,
  tickAt: Date,
  live: boolean,
): Promise<CheckSchedulerTickRun> {
  const { centreId, kind, shape, reason, terms } = decision
  let jobId: number | null = null
  let errorCode: string | null = null
  if (live) {
    const run = searchInput(centreId, terms, shape, limits)
    const submitted = await ports.submitRun(q, {
      shape,
      ...run,
      tags: { module: MODULE, region: centreId, purpose: `${reason}:${kind}` },
    })
    if (submitted.ok) jobId = submitted.value.jobId
    else errorCode = submitted.error.code
  }
  const status = !live ? 'shadow' : jobId !== null ? 'submitted' : 'refused'
  const record = { status, tickAt, jobId, errorCode } as const
  if (decision.rerunId) {
    await markRerun(q, decision.rerunId, record)
  } else {
    await insertRun(q, {
      centreId,
      kind,
      shape,
      terms,
      reason,
      oneOffId: decision.oneOffId ?? null,
      ...record,
    })
  }
  if (status !== 'refused') {
    for (const s of decision.schedule) {
      await upsertSchedule(q, { centreId, ...s, lastRunAt: tickAt })
    }
  }
  if (status === 'submitted' && decision.oneOffId) {
    await ports.setOneOffRunStatus(q, { id: decision.oneOffId, status: 'submitted' })
  }
  return { centreId, kind, shape, reason, terms, status, jobId, errorCode }
}

/** Every run this module decided (`check_scheduler.v_check_runs`), oldest first. */
export async function listRuns(q: Queryable): Promise<CheckSchedulerRun[]> {
  const rows = await q
    .select()
    .from(vCheckRuns)
    .orderBy(asc(vCheckRuns.createdAt), asc(vCheckRuns.id))
  const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString())
  return rows.map((r) =>
    CheckSchedulerRun.parse({
      ...r,
      tickAt: iso(r.tickAt),
      createdAt: iso(r.createdAt),
      updatedAt: iso(r.updatedAt),
    }),
  )
}
