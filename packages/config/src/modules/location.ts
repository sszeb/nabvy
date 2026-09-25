import { z } from 'zod'

// Thresholds of the location module (rule 14 of docs/design/modules/_rules.md), validated with
// Zod like the env groups in ../env.ts.

const locationConfig = z.object({
  distanceRoundingKm: z.number().int().positive(),
  postcodeFetchTimeoutMs: z.number().int().positive(),
})

const config = locationConfig.parse({
  /**
   * distanceKm() rounds to the nearest multiple of this many km. Basis:
   * docs/design/modules/location.md — coordinates behind a distance are only `coarse` precision
   * (fb-scrap-engine dataset.json:447-451), so a finer figure would claim accuracy the data does
   * not have. Status: starting value.
   */
  distanceRoundingKm: 5,
  /**
   * How long pointForPostcode() waits for postcodes.io before refusing. Basis: no rule sets a
   * number; keeps a stalled provider from blocking the request that asked for a distance. Status:
   * starting value; not yet measured against a live postcodes.io call.
   */
  postcodeFetchTimeoutMs: 5000,
})

export const LOCATION_DISTANCE_ROUNDING_KM = config.distanceRoundingKm
export const LOCATION_POSTCODE_FETCH_TIMEOUT_MS = config.postcodeFetchTimeoutMs
