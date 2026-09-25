import { z } from 'zod'

// Thresholds of the city-pages module (rule 14 of docs/design/modules/_rules.md), validated with
// Zod like the env groups in ../env.ts.

const cityPagesConfig = z.object({
  areaKm: z.number().positive(),
  gridMinSeparationKm: z.number().positive(),
  gridTargetSeparationKm: z.number().positive(),
  eventBatchSize: z.number().int().min(1).max(500),
})

const config = cityPagesConfig.parse({
  /**
   * A city page counts as in a centre's area within this many km of it. Basis: a short local feed
   * holds listings within about 100 km, and newest-first reaches about 115 km
   * (fb-scrap-engine/README.md:117-130). Status: starting value.
   */
  areaKm: 100,
  /**
   * The national grid's centres are never closer together than this. Basis: the card's own
   * description of the grid, "about 80–100 km apart" (docs/design/modules/city-pages.md).
   * Status: starting value.
   */
  gridMinSeparationKm: 80,
  /** The grid selection algorithm's target spacing, the top of the same range. Status: starting value. */
  gridTargetSeparationKm: 100,
  /** City-page IDs per `changed` event. Basis: rule 7 (at most 500 IDs). Status: fixed. */
  eventBatchSize: 500,
})

export const CITY_PAGES_AREA_KM = config.areaKm
export const CITY_PAGES_GRID_MIN_SEPARATION_KM = config.gridMinSeparationKm
export const CITY_PAGES_GRID_TARGET_SEPARATION_KM = config.gridTargetSeparationKm
export const CITY_PAGES_EVENT_BATCH_SIZE = config.eventBatchSize
