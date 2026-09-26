import { z } from 'zod'
import { defineEvents, IsoTimestamp } from '../index'

// Contracts of the router-gateway module (docs/design/modules/router-gateway.md): the only client
// of a road-routing provider. Import from '@nabvy/contracts/modules/router-gateway'.
// Distances are metres and times seconds, always; a provider's own units never cross this line.

export const module = 'router-gateway'

/** Routing providers behind the `RouterProvider` adapter (owner, 2026-09-25). `osrm` is later. */
export const RouterProviderName = z.enum(['openrouteservice', 'osrm'])
export type RouterProviderName = z.infer<typeof RouterProviderName>

/** The three call kinds `router_calls` logs. */
export const RouterCallKind = z.enum(['table', 'route', 'health'])
export type RouterCallKind = z.infer<typeof RouterCallKind>

/** How a call ended, as logged in `router_calls.status`. */
export const RouterCallStatus = z.enum([
  'pending', // reserved against the quota, not yet answered
  'ok',
  'refused_quota', // refused by this gateway at the configured cap; the provider was not called
  'provider_quota', // the provider answered 429
  'http_error',
  'invalid_response', // failed the Zod schema or the size limit
  'timeout',
  'network_error',
])
export type RouterCallStatus = z.infer<typeof RouterCallStatus>

/** A WGS84 point. Never logged or stored by this module. */
export const RouterPoint = z.strictObject({
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
})
export type RouterPoint = z.infer<typeof RouterPoint>

/** `table()` input: every source to every destination. Sizes are capped in config, not here. */
export const RouterTableInput = z.strictObject({
  sources: z.array(RouterPoint).min(1),
  destinations: z.array(RouterPoint).min(1),
})
export type RouterTableInput = z.infer<typeof RouterTableInput>

const Metres = z.number().nonnegative()
const Seconds = z.number().nonnegative()

/**
 * `table()` output. `distancesM[i][j]` and `durationsS[i][j]` run from `sources[i]` to
 * `destinations[j]`; null where the provider found no road route.
 */
export const RouterTableResult = z.strictObject({
  provider: RouterProviderName,
  build: z.string().nullable(),
  distancesM: z.array(z.array(Metres.nullable())),
  durationsS: z.array(z.array(Seconds.nullable())),
})
export type RouterTableResult = z.infer<typeof RouterTableResult>

/** `route()` input: the stops in order, first to last. */
export const RouterRouteInput = z.strictObject({ points: z.array(RouterPoint).min(2) })
export type RouterRouteInput = z.infer<typeof RouterRouteInput>

/** `route()` output: the whole route's road distance and time. No geometry. */
export const RouterRouteResult = z.strictObject({
  provider: RouterProviderName,
  build: z.string().nullable(),
  distanceM: Metres,
  durationS: Seconds,
})
export type RouterRouteResult = z.infer<typeof RouterRouteResult>

/** `health()` output. `down` means the recent calls failed; callers fall back to estimates. */
export const RouterHealth = z.strictObject({
  provider: RouterProviderName,
  status: z.enum(['ok', 'unknown', 'off', 'quota', 'down', 'unconfigured']),
  build: z.string().nullable(),
  checkedAt: IsoTimestamp,
})
export type RouterHealth = z.infer<typeof RouterHealth>

/** Typed refusals and failures. Every one means "fall back to straight line × 1.3". */
export const RouterErrorCode = z.enum([
  'router.off', // module or provider switch not on
  'router.quota', // at a configured cap, or the provider answered 429
  'router.unconfigured', // ROUTER_API_KEY or another variable missing
  'router.too-large', // more locations than the configured limit
  'router.provider', // HTTP error, timeout or network failure
  'router.invalid-response', // failed validation or the size limit
])
export type RouterErrorCode = z.infer<typeof RouterErrorCode>

/** `router.build-changed` v1 payload: provider and its data build, identifiers only. */
export const RouterBuildChangedEvent = z.object({
  provider: RouterProviderName,
  osmBuild: z.string().min(1).max(100),
  at: IsoTimestamp,
})
export type RouterBuildChangedEvent = z.infer<typeof RouterBuildChangedEvent>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  'router.build-changed': { 1: RouterBuildChangedEvent },
})
