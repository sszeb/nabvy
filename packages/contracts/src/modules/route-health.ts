import { z } from 'zod'
import { defineEvents, IsoTimestamp } from '../index'

// Contracts of the route-health module (docs/design/modules/route-health.md): chooses each
// region's Facebook detail route (graphql or page) from recent runs, ported line for line from
// fb-scrap-engine/app/route-health.js (services/route-health/README.md). Import from
// '@nabvy/contracts/modules/route-health'. Samples in fixtures/contracts/route-health/.

export const module = 'route-health'

/** A Facebook acquisition region, as tagged on an apify-gateway job (`ApifyGatewayTags.region`). */
export const RouteHealthRegionId = z.string().min(1).max(100)
export type RouteHealthRegionId = z.infer<typeof RouteHealthRegionId>

export const RouteHealthRoute = z.enum(['graphql', 'page'])
export type RouteHealthRoute = z.infer<typeof RouteHealthRoute>

export const RouteHealthReason = z.enum([
  'healthy',
  'insufficient-data',
  'circuit-open',
  'bootstrap-failing',
  'low-success',
  'probe',
  'probe-failed',
  'probe-inconclusive',
  'recovered',
  'still-unhealthy',
])
export type RouteHealthReason = z.infer<typeof RouteHealthReason>

/**
 * One detail run's `RUN_SUMMARY.detailRoute` stats, tagged with its Apify run ID so a retried
 * scheduler tick cannot count a run twice (card: "Owns" `route_runs`). Absent numeric fields mean
 * the run carried no replay stats (a page-route run, or a run the actor reports nothing for).
 */
export const RouteHealthRunEntry = z.strictObject({
  apifyRunId: z.string().min(1).max(100),
  route: RouteHealthRoute,
  detailRequests: z.int().nonnegative().optional(),
  detailOk: z.int().nonnegative().optional(),
  circuitOpen: z.boolean().optional(),
  queryIds: z.array(z.string()).optional(),
  bootstraps: z.int().nonnegative().optional(),
  failedBootstraps: z.int().nonnegative().optional(),
  at: IsoTimestamp,
})
export type RouteHealthRunEntry = z.infer<typeof RouteHealthRunEntry>

/**
 * The pure decision itself, before a region and a time are attached. Matches the ported domain
 * function's `RouteDecision` (services/route-health/src/domain/route-health.ts) field for field,
 * so nothing is typed twice.
 */
export const RouteHealthRunDecision = z.strictObject({
  route: RouteHealthRoute,
  reason: RouteHealthReason,
  successRate: z.number().min(0).max(1).nullable(),
  attempts: z.int().nonnegative(),
  // New Facebook operation IDs (card: "so readers use newQueryIds directly" — the page route's
  // `alert` is always false even when new IDs appear, matching the ported actor behaviour).
  newQueryIds: z.array(z.string()),
  alert: z.boolean(),
})
export type RouteHealthRunDecision = z.infer<typeof RouteHealthRunDecision>

/** A region's current decision, as `v_decisions` shows it and `recommendRoute` returns it. */
export const RouteHealthDecision = RouteHealthRunDecision.extend({
  regionId: RouteHealthRegionId,
  at: IsoTimestamp,
})
export type RouteHealthDecision = z.infer<typeof RouteHealthDecision>

/**
 * The domain function's per-region memory between calls (services/route-health/src/domain/route-health.ts),
 * stored whole in `route_state.state` so a later call resumes exactly where the last one left off.
 * Not Zod-validated: it is never read by another module, only round-tripped by this one, and its
 * shape is the ported actor's own bookkeeping (probe counters, the last run's key). `lastDecision`
 * is the decision before a region and a time are attached.
 */
export interface RouteHealthState {
  route: RouteHealthRoute
  runsSinceSwitch: number
  switched?: boolean
  probing?: boolean
  probeRuns?: number
  probeAttempts?: number
  probeOk?: number
  runKey?: string | null
  lastDecision?: RouteHealthRunDecision
}

/** A region's route actually changed (graphql to page, or back). Payload carries no route: the
 * receiver reads the new one from `v_decisions` (rule 7, thin events). */
export const RouteHealthRouteSwitchedEvent = z.strictObject({ regionId: RouteHealthRegionId })
export type RouteHealthRouteSwitchedEvent = z.infer<typeof RouteHealthRouteSwitchedEvent>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  'route-health.route-switched': { 1: RouteHealthRouteSwitchedEvent },
})

/** Error codes the handler returns as values (docs/engineering.md, "Errors"). */
export const RouteHealthErrorCode = z.enum([
  // the collected job has no v_jobs row yet, or no region tag to key its history on
  'route-health.region_missing',
])
export type RouteHealthErrorCode = z.infer<typeof RouteHealthErrorCode>
