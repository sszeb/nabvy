import { z } from 'zod'
import { defineEvents } from '../index'

// Contracts of the location module (docs/design/modules/location.md): points from postcodes and
// city pages, straight-line distances between them, and town labels. Import from
// '@nabvy/contracts/modules/location'. Nothing here is finer than town or distance
// (docs/decisions.md, "Precedence", "Location precision"): no other module's contract may carry a
// coordinate on its way to a user.

export const module = 'location'

const Latitude = z.number().min(-90).max(90)
const Longitude = z.number().min(-180).max(180)

/** A resolved point: a postcode's coordinate, or a city page's. Internal only; never sent to a user. */
export const LocationPoint = z.strictObject({
  lat: Latitude,
  lng: Longitude,
})
export type LocationPoint = z.infer<typeof LocationPoint>

/** Which point the caller used for the listing side of a distance (README.md, "Job"). */
export const LocationDistanceBasis = z.enum(['coordinates', 'city_page'])
export type LocationDistanceBasis = z.infer<typeof LocationDistanceBasis>

/** A distance shown beside a listing card: rounded, with the basis it was computed from. */
export const LocationDistance = z.strictObject({
  km: z.number().nonnegative(),
  basis: LocationDistanceBasis,
})
export type LocationDistance = z.infer<typeof LocationDistance>

/** Error codes the module returns as values (never thrown for a plain "not found"). */
export const LocationErrorCode = z.enum([
  // postcodes.io could not be reached, or returned something other than 200/404.
  'location.provider_unavailable',
])
export type LocationErrorCode = z.infer<typeof LocationErrorCode>

/** Events this module publishes. It publishes none (README.md, "Outputs"). */
export const events = defineEvents(module, {})
