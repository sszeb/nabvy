import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'
import { ApifyGatewayRunShape } from './apify-gateway'
import { CityPageId } from './city-pages'
import { SearchPlannerTerm, SearchPlannerTermClass } from './search-planner'
import { SpendGovernorLevel } from './spend-governor'

// Contracts of the check-scheduler module (docs/design/modules/check-scheduler.md): when each
// region's search checks run, submitted as one batched run through apify-gateway. Import from
// '@nabvy/contracts/modules/check-scheduler'. The module publishes no events: its output is runs.

export const module = 'check-scheduler'

/**
 * The three check kinds of the card. `newest`: newest-first page 1, hourly in active hours.
 * `catch-up`: default order pages 1-4; actor test T2 dropped it ("Do not schedule it",
 * `docs/design/actor-app-guide.md` item 16) and the gateway has no shape for it, so it is never
 * scheduled; it stays in the vocabulary so the card's names are one list. `sweep`: the daily
 * full read of each active term.
 */
export const CHECK_SCHEDULER_KINDS = ['newest', 'catch-up', 'sweep'] as const
export const CheckSchedulerKind = z.enum(CHECK_SCHEDULER_KINDS)
export type CheckSchedulerKind = z.infer<typeof CheckSchedulerKind>

/** Why a run was sent (card, "Owns"). */
export const CHECK_SCHEDULER_REASONS = ['scheduled', 'rerun', 'one-off', 'verification'] as const
export const CheckSchedulerReason = z.enum(CHECK_SCHEDULER_REASONS)
export type CheckSchedulerReason = z.infer<typeof CheckSchedulerReason>

/**
 * A run's life here. `pending`: a rerun waiting for a tick. `submitted`: apify-gateway queued it
 * (`jobId` set). `refused`: the gateway refused it (`errorCode` says why). `shadow`: decided while
 * the module is in shadow, never sent.
 */
export const CHECK_SCHEDULER_RUN_STATUSES = ['pending', 'submitted', 'refused', 'shadow'] as const
export const CheckSchedulerRunStatus = z.enum(CHECK_SCHEDULER_RUN_STATUSES)
export type CheckSchedulerRunStatus = z.infer<typeof CheckSchedulerRunStatus>

/** The search shapes this module sends; details shapes belong to details-queue. */
export const CheckSchedulerShape = ApifyGatewayRunShape.extract([
  'verification',
  'newest-check',
  'sweep-narrow',
  'sweep-broad',
])
export type CheckSchedulerShape = z.infer<typeof CheckSchedulerShape>

/**
 * One row of `check_scheduler.v_check_runs` (internal): one run, its region, kind, shape and
 * terms. Terms are search-planner terms, never listing text; no user ID anywhere.
 */
export const CheckSchedulerRun = z.strictObject({
  id: Uuid,
  jobId: z.int().positive().nullable(),
  centreId: CityPageId,
  kind: CheckSchedulerKind,
  shape: CheckSchedulerShape,
  terms: z.array(SearchPlannerTerm).min(1).max(20),
  reason: CheckSchedulerReason,
  status: CheckSchedulerRunStatus,
  /** The tick slot that sent it; null for a rerun still pending. */
  tickAt: IsoTimestamp.nullable(),
  /** The degraded search a rerun repeats (`run_coverage.v_search_coverage.id`). */
  rerunOf: Uuid.nullable(),
  /** The search-planner one-off run it carries out. */
  oneOffId: Uuid.nullable(),
  errorCode: z.string().nullable(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
})
export type CheckSchedulerRun = z.infer<typeof CheckSchedulerRun>

/** One row of the module's `schedule`: when a region's check of one kind and term class is due. */
export const CheckSchedulerScheduleEntry = z.strictObject({
  centreId: CityPageId,
  termClass: SearchPlannerTermClass,
  kind: CheckSchedulerKind,
  cadenceS: z.int().positive(),
  nextDueAt: IsoTimestamp,
})
export type CheckSchedulerScheduleEntry = z.infer<typeof CheckSchedulerScheduleEntry>

/** What one tick decided for one region. */
export const CheckSchedulerTickRun = z.strictObject({
  centreId: CityPageId,
  kind: CheckSchedulerKind,
  shape: CheckSchedulerShape,
  reason: CheckSchedulerReason,
  terms: z.array(SearchPlannerTerm).min(1).max(20),
  status: CheckSchedulerRunStatus,
  jobId: z.int().positive().nullable(),
  errorCode: z.string().nullable(),
})
export type CheckSchedulerTickRun = z.infer<typeof CheckSchedulerTickRun>

/** A region with due work that waits: the ramp cap is reached, or the throttle holds new pairs. */
export const CheckSchedulerWaiting = z.strictObject({
  centreId: CityPageId,
  why: z.enum(['ramp-cap', 'hold-new']),
})
export type CheckSchedulerWaiting = z.infer<typeof CheckSchedulerWaiting>

/** The report of one tick (`tick`). */
export const CheckSchedulerTickReport = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('off') }),
  /** This tick slot already ran: a retried tick submits nothing. */
  z.strictObject({ status: z.literal('done'), tickAt: IsoTimestamp }),
  z.strictObject({
    status: z.literal('ran'),
    tickAt: IsoTimestamp,
    level: SpendGovernorLevel,
    maxChecksPerDay: z.int().positive(),
    runs: z.array(CheckSchedulerTickRun),
    waiting: z.array(CheckSchedulerWaiting),
  }),
])
export type CheckSchedulerTickReport = z.infer<typeof CheckSchedulerTickReport>

/** Error codes returned as values (docs/engineering.md, "Errors"). */
export const CheckSchedulerErrorCode = z.enum([
  'check-scheduler.off', // the module or the pipeline is off: nothing is scheduled
])
export type CheckSchedulerErrorCode = z.infer<typeof CheckSchedulerErrorCode>

/** Events this module publishes: none. Its output is runs through apify-gateway (card). */
export const events = defineEvents(module, {})
