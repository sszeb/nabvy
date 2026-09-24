// Event handler. Thin: parse, call domain and repo, return (docs/design/modules/_rules.md, rule
// 2). route-health sits outside the T0–T7 chain (rule 10), so it stamps no T-timestamp; each
// `route_runs` row keeps the run's own time instead.

import {
  ROUTE_HEALTH_HISTORY_KEEP,
  ROUTE_HEALTH_MIN_ATTEMPTS,
  ROUTE_HEALTH_MIN_FAILED_BOOTSTRAPS,
  ROUTE_HEALTH_MIN_PROBE_ATTEMPTS,
  ROUTE_HEALTH_MIN_SUCCESS,
  ROUTE_HEALTH_PROBE_EVERY,
  ROUTE_HEALTH_WINDOW_RUNS,
} from '@nabvy/config/modules/route-health'
import { createEvent, err, ok, type Result } from '@nabvy/contracts'
import { events as apifyGatewayEvents } from '@nabvy/contracts/modules/apify-gateway'
import {
  events,
  type RouteHealthDecision,
  type RouteHealthErrorCode,
} from '@nabvy/contracts/modules/route-health'
import type { Queryable } from '@nabvy/db'
import { withPipeline } from '@nabvy/db'
import { state } from '@nabvy/switches'
import { defineHandler } from '@nabvy/transport'
import { recommendDetailRoute, routeChanged, switchedKey, toRunEntry } from '../domain'
import {
  insertRunEntry,
  pruneRuns,
  selectHistory,
  selectJobRegion,
  selectRunSummaryDetailRoute,
  selectState,
  upsertState,
} from '../repo'

const MODULE = 'route-health'

const OPTIONS = {
  minSuccess: ROUTE_HEALTH_MIN_SUCCESS,
  minAttempts: ROUTE_HEALTH_MIN_ATTEMPTS,
  windowRuns: ROUTE_HEALTH_WINDOW_RUNS,
  probeEvery: ROUTE_HEALTH_PROBE_EVERY,
  minProbeAttempts: ROUTE_HEALTH_MIN_PROBE_ATTEMPTS,
  minFailedBootstraps: ROUTE_HEALTH_MIN_FAILED_BOOTSTRAPS,
}

export interface RecordRunInput {
  regionId: string
  apifyRunId: string
  detailRoute: unknown
  at: string
}

export interface RecordRunResult {
  decision: RouteHealthDecision
  switched: boolean
}

/**
 * Feeds one collected detail run into a region's route history and recomputes its decision.
 * Rule 11: while `route-health` is off, acknowledges and writes nothing (`undefined`).
 * Idempotent (rule 8): a replayed run leaves the stored history, and so the decision, unchanged
 * (`insertRunEntry` is keyed on `apifyRunId`, and `recommendDetailRoute` itself no-ops on a
 * repeated `runId`).
 */
export async function recordRun(
  db: Queryable,
  input: RecordRunInput,
): Promise<RecordRunResult | undefined> {
  // Rule 11: shadow behaves like on (route-health has no user-facing view; README, "Switch and
  // priority"), so only a true "off" (or an unreachable switches, which reads as off) skips this.
  if ((await state(db, MODULE)) === 'off') return undefined
  const entry = toRunEntry(input.apifyRunId, input.detailRoute, input.at)
  await insertRunEntry(db, input.regionId, entry)
  const stored = await selectState(db, input.regionId)
  const previousRoute = stored?.state.route ?? 'graphql'
  const history = await selectHistory(db, input.regionId, ROUTE_HEALTH_HISTORY_KEEP)
  const result = recommendDetailRoute(history, stored?.state ?? null, OPTIONS)
  const at = new Date(input.at)
  await upsertState(db, input.regionId, result.state, at)
  await pruneRuns(db, input.regionId, ROUTE_HEALTH_HISTORY_KEEP)
  return {
    decision: {
      regionId: input.regionId,
      route: result.route,
      reason: result.reason,
      successRate: result.successRate,
      attempts: result.attempts,
      newQueryIds: result.newQueryIds,
      alert: result.alert,
      at: input.at,
    },
    switched: routeChanged(previousRoute, result.route),
  }
}

type RunCollectedPayload = { jobId: number; apifyRunId: string; kind: 'search' | 'details' }

/**
 * Reads a collected job's region and `RUN_SUMMARY.detailRoute`. The default is the real
 * `apify_gateway.v_jobs` / `v_run_summaries` reads (`../repo`); `handleRunCollected` takes it as a
 * parameter so tests can inject a fake one instead of writing a job row. Only the apify-gateway
 * module may write `apify_gateway.jobs` (`services/apify-gateway/test/conventions.test.ts`), so a
 * route-health test cannot fabricate one; injecting the reader keeps the real read path exercised
 * in production while testing this handler's own logic (kind filtering, the region-missing
 * refusal, calling `recordRun`) against a plain database with no apify-gateway tables at all.
 */
export interface RunCollectedReader {
  jobRegion(db: Queryable, jobId: number): Promise<string | undefined>
  detailRoute(db: Queryable, jobId: number): Promise<unknown>
}

export const realRunCollectedReader: RunCollectedReader = {
  jobRegion: selectJobRegion,
  detailRoute: selectRunSummaryDetailRoute,
}

/** Loads a collected job's region and detail-route stats (via `reader`), then feeds `recordRun`. */
export async function handleRunCollected(
  db: Queryable,
  payload: RunCollectedPayload,
  at: string,
  reader: RunCollectedReader = realRunCollectedReader,
): Promise<
  Result<
    { regionId: string; switched: boolean } | undefined,
    { code: RouteHealthErrorCode; message: string }
  >
> {
  // Card: "it does not route photo captures: those always use page" — search runs carry no
  // detail-route stats at all either, so only detail runs feed the history.
  if (payload.kind !== 'details') return ok(undefined)
  const regionId = await reader.jobRegion(db, payload.jobId)
  if (regionId === undefined) {
    return err({
      code: 'route-health.region_missing',
      message: `apify-gateway job ${payload.jobId} has no region tag`,
    })
  }
  const detailRoute = await reader.detailRoute(db, payload.jobId)
  const recorded = await recordRun(db, {
    regionId,
    apifyRunId: payload.apifyRunId,
    detailRoute,
    at,
  })
  return ok(recorded && { regionId, switched: recorded.switched })
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
      if (result.value?.switched) {
        ctx.emit(
          createEvent(
            events,
            'route-health.route-switched',
            1,
            { regionId: result.value.regionId },
            { key: switchedKey(result.value.regionId, ctx.at) },
          ),
        )
      }
      return ok(undefined)
    })
  },
})
