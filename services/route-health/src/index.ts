// Public API of the route-health module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/route-health' only, never from its internals.
import { isoNow } from '@nabvy/contracts'
import {
  type RouteHealthDecision,
  RouteHealthRegionId,
} from '@nabvy/contracts/modules/route-health'
import type { Queryable } from '@nabvy/db'
import { state as switchState } from '@nabvy/switches'
import { selectState } from './repo'

export type {
  RouteHealthDecision,
  RouteHealthErrorCode,
  RouteHealthReason,
  RouteHealthRegionId,
  RouteHealthRoute,
  RouteHealthRouteSwitchedEvent,
  RouteHealthRunDecision,
  RouteHealthRunEntry,
  RouteHealthState,
} from '@nabvy/contracts/modules/route-health'
export { events, module } from '@nabvy/contracts/modules/route-health'
export { onRunCollected, type RecordRunInput, type RecordRunResult, recordRun } from './handlers'

const MODULE = 'route-health'

const NO_DATA: Omit<RouteHealthDecision, 'regionId' | 'at'> = {
  route: 'graphql',
  reason: 'insufficient-data',
  successRate: null,
  attempts: 0,
  newQueryIds: [],
  alert: false,
}

/**
 * A region's current route decision (card: "recommendRoute(regionId)"), for `details-queue` to
 * call before it starts a run. While `route-health` is off, or before any run has been recorded
 * for the region, this is the actor's own default: graphql, `insufficient-data`
 * (docs/design/modules/route-health.md, "When off": "details-queue uses graphql, the actor's
 * default").
 */
export async function recommendRoute(q: Queryable, regionId: string): Promise<RouteHealthDecision> {
  const id = RouteHealthRegionId.parse(regionId)
  const at = isoNow()
  // Rule 11: shadow behaves like on for this module (no user-facing view); only off falls back.
  if ((await switchState(q, MODULE)) === 'off') return { ...NO_DATA, regionId: id, at }
  const stored = await selectState(q, id)
  if (!stored?.state.lastDecision) return { ...NO_DATA, regionId: id, at }
  return { ...stored.state.lastDecision, regionId: id, at: stored.updatedAt.toISOString() }
}
