// Event handler. Thin: parse, call domain and repo, return (docs/design/modules/_rules.md, rule
// 2). source-health sits outside the T0–T7 chain (rule 10), so it stamps no T-timestamp; each
// `health_daily` row keeps its own `updated_at` instead.

import { SOURCE_HEALTH_RAMP_STAGES } from '@nabvy/config/modules/source-health'
import { createEvent, err, ok, type Result } from '@nabvy/contracts'
import { events as apifyGatewayEvents } from '@nabvy/contracts/modules/apify-gateway'
import {
  events,
  type SourceHealthAlertReason,
  type SourceHealthErrorCode,
} from '@nabvy/contracts/modules/source-health'
import type { Queryable } from '@nabvy/db'
import { withPipeline } from '@nabvy/db'
import { state } from '@nabvy/switches'
import { defineHandler } from '@nabvy/transport'
import {
  dayBefore,
  decideRampAdvance,
  emptyHealthDay,
  evaluateAlert,
  londonDay,
  mergeHealthDay,
  type SearchOutcome,
} from '../domain'
import {
  addJobToDay,
  type CollectedJob,
  claimAlerts,
  insertRampStage,
  type RegionDecision,
  seedRampIfMissing,
  selectCurrentRamp,
  selectJob,
  selectRampDayRead,
  selectRegionDecision,
  selectSearchRoutes,
  selectSellerPresence,
} from '../repo'

const MODULE = 'source-health'

export const alertedKey = (day: string, reasons: readonly SourceHealthAlertReason[]): string =>
  `source-health.alerted:${day}:${[...reasons].sort().join(',')}`

type RunCollectedPayload = { jobId: number; apifyRunId: string; kind: 'search' | 'details' }

export interface RunCollectedResult {
  day: string
  alerted: SourceHealthAlertReason[]
}

/**
 * What `handleRunCollected` needs to know about one collected job: its `v_jobs` row (region and
 * its own server-side time), its judged searches, its seller-presence flags and its region's
 * route-health decision. The default (`realRunCollectedReader`) is the real reads (`../repo`);
 * tests inject a fake one instead of writing `apify_gateway.jobs` directly, which only the
 * apify-gateway module may do (`services/apify-gateway/test/conventions.test.ts`) — the same
 * split route-health's `RunCollectedReader` uses (`services/route-health/src/handlers/index.ts`).
 */
export interface RunCollectedReader {
  job(db: Queryable, jobId: number): Promise<CollectedJob | undefined>
  searchRoutes(db: Queryable, jobId: number): Promise<SearchOutcome[]>
  sellerPresence(db: Queryable, jobId: number): Promise<boolean[]>
  regionDecision(db: Queryable, regionId: string): Promise<RegionDecision | undefined>
}

export const realRunCollectedReader: RunCollectedReader = {
  job: selectJob,
  searchRoutes: selectSearchRoutes,
  sellerPresence: selectSellerPresence,
  regionDecision: selectRegionDecision,
}

/**
 * Folds one collected apify-gateway search job into its Europe/London day's tally and evaluates
 * the alert (card: "Starting alert value" and "Tests and fixtures"). The day is the job's own
 * time from `v_jobs` (`CollectedJob.occurredAt`), never the delivery time `at`, which only
 * stamps `updated_at`. Rule 11: while `source-health` is off, acknowledges and writes nothing.
 * Details jobs are acknowledged and not counted: their rows are not search pages and their
 * searches are none (route-health filters by kind the same way). Idempotent (rule 8): the repo
 * claims the job ID in `processed_jobs` before adding anything, so a replay (same day or after
 * midnight) adds nothing and alerts nothing; it returns the same day with no new reasons.
 */
export async function handleRunCollected(
  db: Queryable,
  payload: RunCollectedPayload,
  at: string,
  reader: RunCollectedReader = realRunCollectedReader,
): Promise<
  Result<RunCollectedResult | undefined, { code: SourceHealthErrorCode; message: string }>
> {
  if ((await state(db, MODULE)) === 'off') return ok(undefined)
  if (payload.kind !== 'search') return ok(undefined)

  const job = await reader.job(db, payload.jobId)
  if (!job) {
    return err({
      code: 'source-health.job_not_found',
      message: `apify-gateway job ${payload.jobId} has no v_jobs row yet`,
    })
  }
  if (job.regionId === undefined) {
    return err({
      code: 'source-health.job_not_found',
      message: `apify-gateway job ${payload.jobId} has no region tag`,
    })
  }

  const [searches, sellerPresence, decision] = await Promise.all([
    reader.searchRoutes(db, payload.jobId),
    reader.sellerPresence(db, payload.jobId),
    reader.regionDecision(db, job.regionId),
  ])

  const day = londonDay(job.occurredAt)
  const contribution = mergeHealthDay(emptyHealthDay(), {
    jobId: payload.jobId,
    searches,
    breakerTripped: decision?.reason === 'circuit-open',
    newOperationIds: decision?.newQueryIds ?? [],
    sellerPresence,
  })
  const totals = await addJobToDay(db, day, payload.jobId, contribution, new Date(at))
  if (!totals) return ok({ day, alerted: [] })

  const alerted = await claimAlerts(db, day, evaluateAlert(totals))
  return ok({ day, alerted })
}

/** Consumes `apify-gateway.run-collected`; a Trigger.dev task file calls only `run` (trigger/README.md). */
export const onRunCollected = defineHandler({
  consumer: MODULE,
  registry: apifyGatewayEvents,
  type: 'apify-gateway.run-collected',
  async handle(event, ctx) {
    return withPipeline(async (db) => {
      const result = await handleRunCollected(db, event.payload, ctx.at)
      if (!result.ok) return result
      if (result.value && result.value.alerted.length > 0) {
        ctx.emit(
          createEvent(
            events,
            'source-health.alerted',
            1,
            { day: result.value.day, reasons: result.value.alerted },
            { key: alertedKey(result.value.day, result.value.alerted) },
          ),
        )
      }
      return ok(undefined)
    })
  },
})

export interface RampAssessment {
  day: string
  advanced: boolean
  stage: number
}

/**
 * Judges whether the ramp may move to its next stage, from the two most recent complete
 * Europe/London days (yesterday and the day before, by calendar day, not by `now - 24h`): their
 * degraded share and alerts (card: "volume rises in steps of 24-48 hours, and only while 302s and
 * fallbacks do not rise"; `decideRampAdvance` lists the refusals). Not wired to an event: like
 * apify-gateway's watcher before Trigger.dev's account existed (`services/apify-gateway/README.md`,
 * "the watcher task is not in trigger/ yet"), this is called by a scheduled task once built
 * (README.md, "Decisions"). Seeds the ramp at its lowest stage on the first call. Returns
 * `undefined` while `source-health` is off.
 */
export async function assessRamp(db: Queryable, now: Date): Promise<RampAssessment | undefined> {
  if ((await state(db, MODULE)) === 'off') return undefined
  await seedRampIfMissing(db, now)
  const current = await selectCurrentRamp(db)
  if (!current) throw new Error('source-health: ramp was not seeded')

  const yesterday = dayBefore(londonDay(now))
  const [yesterdayRead, baselineRead] = await Promise.all([
    selectRampDayRead(db, yesterday),
    selectRampDayRead(db, dayBefore(yesterday)),
  ])

  const decision = decideRampAdvance(
    current,
    now,
    yesterdayRead ?? null,
    baselineRead ?? null,
    SOURCE_HEALTH_RAMP_STAGES,
  )
  const nextConfig =
    decision.nextStage !== undefined ? SOURCE_HEALTH_RAMP_STAGES[decision.nextStage] : undefined
  if (!decision.advance || decision.nextStage === undefined || !nextConfig) {
    return { day: yesterday, advanced: false, stage: current.stage }
  }
  const advanced = await insertRampStage(
    db,
    decision.nextStage,
    now,
    nextConfig.maxChecksPerDay,
    yesterday,
  )
  if (!advanced) return { day: yesterday, advanced: false, stage: current.stage }
  return { day: yesterday, advanced: true, stage: decision.nextStage }
}
