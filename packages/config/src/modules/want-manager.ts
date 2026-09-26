import { z } from 'zod'

// Thresholds of the want-manager module (rule 14 of docs/design/modules/_rules.md). Each value
// carries a comment with its basis and is a starting value until the module's fixtures calibrate
// it. No prices here: the only money in this module is the user's own cap, which is input.

const wantManagerConfig = z.object({
  freeActiveWantLimit: z.number().int().min(0).max(100),
  defaultCadenceSeconds: z.number().int().min(60).max(14400),
  areaGridDegrees: z.number().positive().max(1),
  purgeBatch: z.number().int().min(100).max(500),
})

const config = wantManagerConfig.parse({
  /**
   * Active wants a user may hold while `subscriptions` is off (or not yet applied), so the Free
   * limit applies. Basis: docs/decisions.md, "Free-tier limits: 3 active hunts" and the card
   * (docs/design/modules/want-manager.md, "Does / does not"). Status: fixed by the decision.
   */
  freeActiveWantLimit: 3,
  /**
   * The cadence a want form starts at before the user picks one. Basis: the middle of the
   * seven-step ladder in docs/design/cadence-slider.md (15 min), the cheaper side of the card's
   * "checked every 5 minutes" example; the user picks freely. Status: starting value
   * (docs/questions/want-manager.md).
   */
  defaultCadenceSeconds: 900,
  /**
   * The grid `v_want_areas` rounds a want's point to, in degrees (0.05° is about 5.5 km of
   * latitude). Basis: the card's "point rounded to the postcode district" and `location`'s 5 km
   * distance rounding (docs/design/modules/location.md). Status: starting value.
   */
  areaGridDegrees: 0.05,
  /**
   * Users per `account.deleted` purge call. Basis: CLAUDE.md, "Batches, not items" (100–500).
   * Status: fixed by the rule.
   */
  purgeBatch: 500,
})

export const WANT_MANAGER_FREE_ACTIVE_WANT_LIMIT = config.freeActiveWantLimit
export const WANT_MANAGER_DEFAULT_CADENCE_SECONDS = config.defaultCadenceSeconds
export const WANT_MANAGER_AREA_GRID_DEGREES = config.areaGridDegrees
export const WANT_MANAGER_PURGE_BATCH = config.purgeBatch
