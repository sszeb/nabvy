import { z } from 'zod'

// Thresholds of the route-health module (rule 14 of docs/design/modules/_rules.md), validated
// with Zod like the env groups in ../env.ts. The module's card: "The thresholds are the actor's
// defaults, kept as starting values" (docs/design/modules/route-health.md).

const routeHealthConfig = z.object({
  minSuccess: z.number().min(0).max(1),
  minAttempts: z.number().int().nonnegative(),
  windowRuns: z.number().int().positive(),
  probeEvery: z.number().int().positive(),
  minProbeAttempts: z.number().int().nonnegative(),
  minFailedBootstraps: z.number().int().nonnegative(),
  historyKeep: z.number().int().positive(),
})

const config = routeHealthConfig.parse({
  /** Stay on graphql while at least this share of replays succeed. Actor default. */
  minSuccess: 0.95,
  /** Judge success only once a region has at least this many replays in its window. Actor default. */
  minAttempts: 50,
  /** How many recent runs the success rate is computed over. Actor default. */
  windowRuns: 10,
  /** Probe graphql again every this many runs while on the page route. Actor default. */
  probeEvery: 10,
  /** Replays a recovery probe must gather before it can succeed. Actor default. */
  minProbeAttempts: 20,
  /** Failed bootstraps (no replay template at all) needed to call a run bootstrap-failing. Actor default. */
  minFailedBootstraps: 2,
  /**
   * Runs kept per region in `route_runs` (card: "at least 11 entries kept per region"). Basis:
   * `windowRuns` (10) + 1, the most `recommendDetailRoute` ever looks back (the query-ID lookback
   * window). Starting value.
   */
  historyKeep: 11,
})

export const ROUTE_HEALTH_MIN_SUCCESS = config.minSuccess
export const ROUTE_HEALTH_MIN_ATTEMPTS = config.minAttempts
export const ROUTE_HEALTH_WINDOW_RUNS = config.windowRuns
export const ROUTE_HEALTH_PROBE_EVERY = config.probeEvery
export const ROUTE_HEALTH_MIN_PROBE_ATTEMPTS = config.minProbeAttempts
export const ROUTE_HEALTH_MIN_FAILED_BOOTSTRAPS = config.minFailedBootstraps
export const ROUTE_HEALTH_HISTORY_KEEP = config.historyKeep
