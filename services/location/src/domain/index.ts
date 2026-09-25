// Pure logic: no I/O, no database, no clock or randomness passed in implicitly.
import { LOCATION_DISTANCE_ROUNDING_KM } from '@nabvy/config/modules/location'
import type {
  LocationDistance,
  LocationDistanceBasis,
  LocationErrorCode,
  LocationPoint,
} from '@nabvy/contracts/modules/location'

/** Thrown by an exported function when the provider cannot be reached; never a database error. */
export class LocationRefused extends Error {
  readonly code: LocationErrorCode
  constructor(code: LocationErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'LocationRefused'
  }
}

const EARTH_RADIUS_KM = 6371
const toRadians = (deg: number) => (deg * Math.PI) / 180

/**
 * Great-circle distance between two points, in km, at full precision. Never shown to a user
 * directly: distanceKm() below rounds it first, because the coordinates behind either point are
 * only ever `coarse` (card basis for the rounding step).
 */
export function haversineKm(from: LocationPoint, to: LocationPoint): number {
  const dLat = toRadians(to.lat - from.lat)
  const dLng = toRadians(to.lng - from.lng)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Rounds a non-negative value to the nearest multiple of `step` (`step` > 0). */
export function roundToNearest(value: number, step: number): number {
  return Math.round(value / step) * step
}

/**
 * Straight-line distance between two points, rounded to LOCATION_DISTANCE_ROUNDING_KM. The
 * caller says which basis the listing side of the distance used (`fromPoint`/`toPoint`);
 * location never picks a point itself (README.md, "Job").
 */
export function distanceKm(
  from: LocationPoint,
  to: LocationPoint,
  basis: LocationDistanceBasis,
): LocationDistance {
  return { km: roundToNearest(haversineKm(from, to), LOCATION_DISTANCE_ROUNDING_KM), basis }
}

/**
 * Normalises a postcode for cache lookups: trimmed, upper case, a single space before the
 * 3-character inward code (the standard UK postcode shape). Short or malformed input is upper
 * cased and returned as-is; postcodes.io does its own validation on the request.
 */
export function normalizePostcode(postcode: string): string {
  const compact = postcode.trim().toUpperCase().replace(/\s+/g, '')
  if (compact.length < 5) return compact
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`
}

/** The city page's own name (card: "townLabel() uses the city page's name"). Pure lookup. */
export function townLabelFrom(
  cityPages: ReadonlyMap<string, { name: string }>,
  cityPageId: string,
): string | undefined {
  return cityPages.get(cityPageId)?.name
}
