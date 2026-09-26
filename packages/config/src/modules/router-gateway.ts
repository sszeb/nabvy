import { z } from 'zod'
import { EnvError, type EnvSource } from '../env'

// Configuration and thresholds of the router-gateway module (rule 14 of
// docs/design/modules/_rules.md; docs/decisions.md "Routing: openrouteservice first").
// The variables live here, not in ../env.ts, so this module's branch edits only its own files;
// docs/questions/router-gateway.md asks the coordinator to list them in docs/secrets.md.

const ROUTER_PROVIDERS = ['openrouteservice', 'osrm'] as const

const routerGatewayEnv = z.object({
  /** Which adapter runs. `openrouteservice` for a start (owner, 2026-09-25). */
  ROUTER_PROVIDER: z.enum(ROUTER_PROVIDERS).default('openrouteservice'),
  /** openrouteservice's hosted API host; a self-hosted router later sets its own. */
  ROUTER_BASE_URL: z
    .url({ protocol: /^https$/, error: 'must be an https:// URL' })
    .default('https://api.openrouteservice.org'),
  /** The provider key (secret, server-side only; the owner's openrouteservice account). */
  ROUTER_API_KEY: z.string().min(1),
})

export type RouterGatewayEnv = z.output<typeof routerGatewayEnv>

/** The router-gateway variables. Throws `EnvError`, which names variables but never values. */
export function loadRouterGatewayEnv(source: EnvSource = process.env): RouterGatewayEnv {
  const present = Object.fromEntries(
    Object.keys(routerGatewayEnv.shape).flatMap((name) => {
      const value = source[name]
      return value === undefined || value.trim() === '' ? [] : [[name, value]]
    }),
  )
  const result = routerGatewayEnv.safeParse(present)
  if (result.success) return result.data
  const missing: string[] = []
  const invalid: { name: string; reason: string }[] = []
  for (const issue of result.error.issues) {
    const name = String(issue.path[0])
    if (name in present) invalid.push({ name, reason: issue.message })
    else missing.push(name)
  }
  throw new EnvError(missing, invalid)
}

const cap = z.object({
  perDay: z.number().int().positive(),
  perMinute: z.number().int().positive(),
})

const routerGatewayConfig = z.object({
  quota: z.object({
    openrouteservice: z.object({ table: cap, route: cap }),
    osrm: z.object({ table: cap, route: cap }),
  }),
  maxTableLocations: z.number().int().positive(),
  maxRouteStops: z.number().int().min(2),
  timeoutMs: z.number().int().positive(),
  maxResponseBytes: z.number().int().positive(),
  healthWindowMinutes: z.number().int().positive(),
})

export const config = routerGatewayConfig.parse({
  quota: {
    /**
     * openrouteservice free Standard plan, as read on the plan page on 2026-09-25 (docs/decisions.md
     * "Routing: openrouteservice first"): Matrix V2 500 a day and 40 a minute, Directions V2 2000 a
     * day and 40 a minute. Days are UTC days. Change these when the plan changes.
     */
    openrouteservice: {
      table: { perDay: 500, perMinute: 40 },
      route: { perDay: 2000, perMinute: 40 },
    },
    /**
     * No self-hosted router exists yet, so no measured capacity: the same caps as the free plan,
     * a starting value to replace when one is built.
     */
    osrm: {
      table: { perDay: 500, perMinute: 40 },
      route: { perDay: 2000, perMinute: 40 },
    },
  },
  /**
   * Sources plus destinations in one `table()` call. Nabvy's own starting value, not a provider
   * limit (openrouteservice's per-request matrix limit is an open question); travel-time sends one
   * origin cell and a batch of places.
   */
  maxTableLocations: 50,
  /** Stops in one `route()` call: a one-day pickup haul. Starting value, not a provider limit. */
  maxRouteStops: 25,
  /** Give up on a provider call after this long and fall back. Starting value. */
  timeoutMs: 10_000,
  /**
   * Largest provider response read, in bytes. A 50-location matrix of two metrics with metadata
   * is well under 100 KB; 1 MB leaves room without letting a hostile body fill memory.
   */
  maxResponseBytes: 1_000_000,
  /** `health()` judges the provider on the calls logged in this many recent minutes. */
  healthWindowMinutes: 15,
})

export type RouterGatewayConfig = typeof config
export type RouterQuotaCap = z.output<typeof cap>
