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
import { decideRampAdvance, evaluateAlert, londonDay, mergeHealthDay } from '../domain'
import {
  insertRampStage,
  seedRampIfMissing,
  selectCurrentRamp,
  selectHealthDay,
  selectJobExists,
  selectJobRegion,
  selectPctDegraded,
  selectRegionDecision,
  selectSearchRoutes,
  selectSellerPresence,
  upsertHealthDay,
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
 * Folds one collected apify-gateway job into its Europe/London day's tally and evaluates the
 * alert (card: "Starting alert value" and "Tests and fixtures"). Rule 11: while `source-health`
 * is off, acknowledges and writes nothing. Idempotent (rule 8): a replayed job (same `jobId`)
 * changes nothing (`mergeHealthDay`), so a replayed event returns the same result.
 */
export async function handleRunCollected(
  db: Queryable,
  payload: RunCollectedPayload,
  at: string,
): Promise<Result<RunCollectedResult | undefined, { code: SourceHealthErrorCode; message: string }>> {
  if ((await state(db, MODULE)) === 'off') return ok(undefined)

  if (!(await selectJobExists(db, payload.jobId))) {
    return err({
      code: 'source-health.job_not_found',
      message: `apify-gateway job ${payload.jobId} has no v_jobs row yet`,
    })
  }
  const regionId = await selectJobRegion(db, payload.jobId)
  if (regionId === undefined) {
    return err({
      code: 'source-health.job_not_found',
      message: `apify-gateway job ${payload.jobId} has no region tag`,
    })
  }

  const [searches, sellerPresence, decision] = await Promise.all([
    selectSearchRoutes(db, payload.jobId),
    selectSellerPresence(db, payload.jobId),
    selectRegionDecision(db, regionId),
  ])

  const day = londonDay(at)
  const existing = await selectHealthDay(db, day)
  const merged = mergeHealthDay(existing, {
    jobId: payload.jobId,
    searches,
    breakerTripped: decision?.reason === 'circuit-open',
    newOperationIds: decision?.newQueryIds ?? [],
    sellerPresence,
  })
  const newReasons = evaluateAlert(merged)
  const final = { ...merged, alerted: [...merged.alerted, ...newReasons] }
  await upsertHealthDay(db, day, final, new Date(at))

  return ok({ day, alerted: newReasons })
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
 * Judges whether the ramp may move to its next stage, from the two most recent complete days'
 * degraded share (card: "volume rises in steps of 24-48 hours, and only while 302s and fallbacks
 * do not rise"). Not wired to an event: like apify-gateway's watcher before Trigger.dev's account
 * existed (`services/apify-gateway/README.md`, "the watcher task is not in trigger/ yet"), this is
 * called by a scheduled task once built (README.md, "Decisions"). Seeds the ramp at its lowest
 * stage on the first call. Returns `undefined` while `source-health` is off.
 */
export async function assessRamp(db: Queryable, now: Date): Promise<RampAssessment | undefined> {
  if ((await state(db, MODULE)) === 'off') return undefined
  await seedRampIfMissing(db, now)
  const current = await selectCurrentRamp(db)
  if (!current) throw new Error('source-health: ramp was not seeded')

  const yesterday = londonDay(new Date(now.getTime() - 24 * 3_600_000))
  const dayBefore = londonDay(new Date(now.getTime() - 2 * 24 * 3_600_000))
  const yesterdayPct = await selectPctDegraded(db, yesterday)
  if (yesterdayPct === undefined) return { day: yesterday, advanced: false, stage: current.stage }
  const dayBeforePct = await selectPctDegraded(db, dayBefore)

  const decision = decideRampAdvance(
    current,
    now,
    yesterdayPct,
    dayBeforePct ?? null,
    SOURCE_HEALTH_RAMP_STAGES,
  )
  if (!decision.advance || decision.nextStage === undefined) {
    return { day: yesterday, advanced: false, stage: current.stage }
  }
  await insertRampStage(
    db,
    decision.nextStage,
    now,
    SOURCE_HEALTH_RAMP_STAGES[decision.nextStage].maxChecksPerDay,
    yesterday,
  )
  return { day: yesterday, advanced: true, stage: decision.nextStage }
}
