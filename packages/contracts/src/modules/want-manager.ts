import { z } from 'zod'
import { defineEvents, IsoTimestamp } from '../index'

// Minimal contracts of the want-manager module (services/want-manager, not yet built; backlog
// task 1.8e; docs/design/modules/want-manager.md), scoped to what task 4.1q's cadence slider
// needs from the check-interval estimate. want-manager's own tables (WantManagerWant,
// WantManagerCriterion, WantManagerPreferences) and its `want-manager.changed` event are 1.8e's
// to define; this file declares no events yet. Import from '@nabvy/contracts/modules/want-manager'.
// Samples in fixtures/contracts/want-manager/.

export const module = 'want-manager'

/**
 * The check-interval ladder a want's cadence can be set to (docs/design/cadence-slider.md),
 * fastest last so a higher array index always means a faster check: 4 h, 2 h, 1 h, 30 min,
 * 15 min, 5 min, 1 min (seven steps; the names are settled in docs/design/cadence-slider.md).
 */
export const WANT_MANAGER_CADENCE_STEP_SECONDS = [14400, 7200, 3600, 1800, 900, 300, 60] as const
export const WantManagerCadenceSeconds = z.union(
  WANT_MANAGER_CADENCE_STEP_SECONDS.map((seconds) => z.literal(seconds)) as [
    z.ZodLiteral<(typeof WANT_MANAGER_CADENCE_STEP_SECONDS)[number]>,
    z.ZodLiteral<(typeof WANT_MANAGER_CADENCE_STEP_SECONDS)[number]>,
    ...z.ZodLiteral<(typeof WANT_MANAGER_CADENCE_STEP_SECONDS)[number]>[],
  ],
)
export type WantManagerCadenceSeconds = z.infer<typeof WantManagerCadenceSeconds>

/**
 * What the want-manager estimate procedure (not built yet, 1.8e; the web app passes `null` until
 * it ships) returns for a
 * chosen cadence: never computed in the browser (CLAUDE.md, "No invented numbers"). Optional
 * fields carry no meaning when absent, so they are `null`, never omitted:
 * `deliveredCadenceSeconds` is set only when the want's area currently delivers slower than
 * `chosenCadenceSeconds`; `unlockWatchersNeeded`/`unlockCadenceSeconds` are set together, only
 * when the next faster step is reachable by more watchers in the area rather than a plan
 * upgrade; `creditsRunOutDate` is set only when credits run out before the billing period ends.
 */
export const WantManagerCadenceEstimate = z
  .strictObject({
    chosenCadenceSeconds: WantManagerCadenceSeconds,
    /** The fastest cadence the want's plan allows without an upgrade. */
    planCeilingSeconds: WantManagerCadenceSeconds,
    creditsPerMonth: z.number().nonnegative(),
    deliveredCadenceSeconds: WantManagerCadenceSeconds.nullable(),
    unlockWatchersNeeded: z.int().positive().nullable(),
    unlockCadenceSeconds: WantManagerCadenceSeconds.nullable(),
    creditsRunOutDate: IsoTimestamp.nullable(),
  })
  .refine(
    (estimate) =>
      estimate.deliveredCadenceSeconds === null ||
      estimate.deliveredCadenceSeconds > estimate.chosenCadenceSeconds,
    {
      message: 'deliveredCadenceSeconds must be slower than chosenCadenceSeconds when set',
      path: ['deliveredCadenceSeconds'],
    },
  )
  .refine(
    (estimate) =>
      (estimate.unlockWatchersNeeded === null) === (estimate.unlockCadenceSeconds === null),
    {
      message: 'unlockWatchersNeeded and unlockCadenceSeconds are set together',
      path: ['unlockCadenceSeconds'],
    },
  )
export type WantManagerCadenceEstimate = z.infer<typeof WantManagerCadenceEstimate>

/**
 * A free account's burst-mode standing (docs/design/cadence-slider.md, "Burst mode"): the fixed
 * four-phase timeline itself is product copy, not user data, so it lives in the web app's own
 * constants (apps/web/src/lib/cadence.ts); only these per-user numbers cross the boundary.
 */
export const WantManagerCadenceBurstStatus = z.strictObject({
  usedThisWeek: z.int().nonnegative(),
  weeklyLimit: z.int().positive(),
  resetsInHours: z.number().nonnegative(),
  /** Minutes elapsed in the current burst, for the static position marker. */
  elapsedMinutes: z.number().nonnegative(),
})
export type WantManagerCadenceBurstStatus = z.infer<typeof WantManagerCadenceBurstStatus>

/** Declares no events yet: want-manager itself (1.8e) adds `want-manager.changed` when it ships. */
export const events = defineEvents(module, {})
