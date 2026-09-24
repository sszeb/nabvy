// Pure logic: no I/O, no database, no clock or randomness passed in implicitly.
import type { RouteHealthRunEntry } from '@nabvy/contracts/modules/route-health'
import type { DetailRoute, DetailRouteRun } from './route-health'

export {
  type DetailRoute,
  type DetailRouteRun,
  ROUTE_HEALTH_DEFAULTS,
  type RouteDecision,
  type RouteHealthOptions,
  type RouteReason,
  recommendDetailRoute,
} from './route-health'

/**
 * Normalises a run's `RUN_SUMMARY.detailRoute` (untrusted: the actor's own output) into a stored
 * `RouteHealthRunEntry`. Anything other than `route: 'graphql'` is treated as a page-route run
 * (the domain function only reads replay stats off graphql runs; card: "it does not route photo
 * captures: those always use page").
 */
export function toRunEntry(
  apifyRunId: string,
  detailRoute: unknown,
  at: string,
): RouteHealthRunEntry {
  const raw = (detailRoute && typeof detailRoute === 'object' ? detailRoute : {}) as Record<
    string,
    unknown
  >
  const route: DetailRoute = raw.route === 'graphql' ? 'graphql' : 'page'
  const entry: RouteHealthRunEntry = { apifyRunId, route, at }
  if (route !== 'graphql') return entry
  if (typeof raw.detailRequests === 'number') entry.detailRequests = raw.detailRequests
  if (typeof raw.detailOk === 'number') entry.detailOk = raw.detailOk
  if (typeof raw.circuitOpen === 'boolean') entry.circuitOpen = raw.circuitOpen
  if (Array.isArray(raw.queryIds)) {
    entry.queryIds = raw.queryIds.filter((id): id is string => typeof id === 'string')
  }
  if (typeof raw.bootstraps === 'number') entry.bootstraps = raw.bootstraps
  if (typeof raw.failedBootstraps === 'number') entry.failedBootstraps = raw.failedBootstraps
  return entry
}

/** A stored `RouteHealthRunEntry`, as the domain function's history input. */
export function toDetailRouteRun(entry: RouteHealthRunEntry): DetailRouteRun {
  return {
    runId: entry.apifyRunId,
    route: entry.route,
    detailRequests: entry.detailRequests,
    detailOk: entry.detailOk,
    circuitOpen: entry.circuitOpen,
    queryIds: entry.queryIds,
    bootstraps: entry.bootstraps,
    failedBootstraps: entry.failedBootstraps,
  }
}

/** Whether a decision actually moved the region's route (what `route-health.route-switched` reports). */
export function routeChanged(previousRoute: DetailRoute, newRoute: DetailRoute): boolean {
  return newRoute !== previousRoute
}

/** Key for `route-health.route-switched`: one per region per switch, so a replay is dropped. */
export function switchedKey(regionId: string, at: string): string {
  return `route-health.route-switched:${regionId}@${at}`
}
