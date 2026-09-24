import { z } from 'zod'

// Thresholds of the spend-governor module (rule 14 of docs/design/modules/_rules.md), validated
// with Zod like the env groups in ../env.ts. The budgets themselves (limits, units, who set them)
// are owner decisions and live in the database, seeded by the module's migration.

const spendGovernorConfig = z
  .object({
    levelAtPercent: z.object({
      'slow-free': z.number().int().min(1).max(100),
      'slow-paid': z.number().int().min(1).max(100),
      'slow-sweeps': z.number().int().min(1).max(100),
      'hold-new': z.number().int().min(1).max(100),
    }),
    refreshAfterMs: z.number().int().positive(),
    validForMs: z.number().int().positive(),
    forecastMinElapsedMs: z.number().int().positive(),
    scalePlanMonthlyUsdMicros: z.number().int().positive(),
  })
  .refine(
    (c) =>
      c.levelAtPercent['slow-free'] < c.levelAtPercent['slow-paid'] &&
      c.levelAtPercent['slow-paid'] < c.levelAtPercent['slow-sweeps'] &&
      c.levelAtPercent['slow-sweeps'] < c.levelAtPercent['hold-new'],
    'throttle levels must rise with spend',
  )
  .refine((c) => c.refreshAfterMs < c.validForMs, 'a recompute must refresh before it goes stale')

const config = spendGovernorConfig.parse({
  /**
   * Share of a budget committed at which each throttle level starts. Basis: the brief throttles at
   * 80% of the month's budget (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:202-203;
   * actor-integration.md 2.12); the later steps are spread evenly between 80% and 100% so every
   * level acts before the gateway's hard cap refuses a run. Status: starting value
   * (docs/questions/spend-governor.md).
   */
  levelAtPercent: { 'slow-free': 80, 'slow-paid': 85, 'slow-sweeps': 90, 'hold-new': 95 },
  /**
   * A recompute that changes nothing still rewrites its row this long after the last write, so
   * the row stays valid. Basis: a quarter of `validForMs`. Status: starting value.
   */
  refreshAfterMs: 15 * 60 * 1000,
  /**
   * A throttle row older than this reads `hold-new` (fail closed: a governor that stopped running
   * must not leave paid work unthrottled). Basis: an hour covers a missed recompute or two.
   * Status: starting value, to set against the recompute task's schedule.
   */
  validForMs: 60 * 60 * 1000,
  /**
   * The forecast extrapolates as if at least this much of the period had passed, so one run on
   * the first morning of a month does not forecast thirty. Basis: one day. Status: starting value.
   */
  forecastMinElapsedMs: 24 * 60 * 60 * 1000,
  /**
   * A forecast at or above this monthly Apify spend is reported as "a Scale plan may pay". Basis:
   * Scale pays above about $199 a month (fb-scrap-engine/docs/design/SCALE_PLAN.md:84-86;
   * actor-integration.md 2.12). Status: the brief's figure; the owner decides.
   */
  scalePlanMonthlyUsdMicros: 199_000_000,
})

export const SPEND_GOVERNOR_LEVEL_AT_PERCENT = config.levelAtPercent
export const SPEND_GOVERNOR_REFRESH_AFTER_MS = config.refreshAfterMs
export const SPEND_GOVERNOR_VALID_FOR_MS = config.validForMs
export const SPEND_GOVERNOR_FORECAST_MIN_ELAPSED_MS = config.forecastMinElapsedMs
export const SPEND_GOVERNOR_SCALE_PLAN_USD_MICROS = config.scalePlanMonthlyUsdMicros
