// Public API of the location module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/location' only, never from its internals.
import { listCityPages } from '@nabvy/city-pages'
import { loadEnv } from '@nabvy/config'
import { LOCATION_POSTCODE_FETCH_TIMEOUT_MS } from '@nabvy/config/modules/location'
import type {
  LocationDistance,
  LocationDistanceBasis,
  LocationPoint,
} from '@nabvy/contracts/modules/location'
import type { Queryable } from '@nabvy/db'
import { state } from '@nabvy/switches'
import {
  distanceKm as computeDistanceKm,
  LocationRefused,
  normalizePostcode,
  townLabelFrom,
} from './domain'
import { insertCachedPostcode, selectCachedPostcode } from './repo'

export { events, module } from '@nabvy/contracts/modules/location'
export { LocationRefused } from './domain'

interface PostcodesIoResponse {
  status: number
  result?: { latitude: number; longitude: number }
}

async function fetchFromPostcodesIo(postcode: string): Promise<LocationPoint | undefined> {
  const { POSTCODES_IO_BASE } = loadEnv(['postcodes'])
  const url = `${POSTCODES_IO_BASE}/postcodes/${encodeURIComponent(postcode)}`
  let response: Response
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(LOCATION_POSTCODE_FETCH_TIMEOUT_MS),
    })
  } catch {
    throw new LocationRefused(
      'location.provider_unavailable',
      `postcodes.io unreachable for a postcode lookup`,
    )
  }
  if (response.status === 404) return undefined
  if (!response.ok) {
    throw new LocationRefused(
      'location.provider_unavailable',
      `postcodes.io returned ${response.status}`,
    )
  }
  const body = (await response.json()) as PostcodesIoResponse
  if (!body.result) return undefined
  return { lat: body.result.latitude, lng: body.result.longitude }
}

/**
 * A postcode's point: from the cache, or postcodes.io (`docs/secrets.md`, `POSTCODES_IO_BASE`),
 * cached forever afterwards because a postcode's coordinate does not move. Off (rule 11 of
 * `docs/design/modules/_rules.md`): no cache read or write, no network call, `undefined`
 * ("distance is unknown", README.md). An unknown postcode also returns `undefined`, never a
 * guess; an unreachable or misbehaving provider throws `LocationRefused`
 * (`location.provider_unavailable`).
 */
export async function pointForPostcode(
  q: Queryable,
  postcode: string,
): Promise<LocationPoint | undefined> {
  if ((await state(q, 'location')) === 'off') return undefined
  const normalized = normalizePostcode(postcode)
  const cached = await selectCachedPostcode(q, normalized)
  if (cached) return cached
  const point = await fetchFromPostcodesIo(normalized)
  if (!point) return undefined
  await insertCachedPostcode(q, { postcode: normalized, ...point })
  return point
}

/**
 * Straight-line distance between two points, rounded to the nearest
 * `LOCATION_DISTANCE_ROUNDING_KM` (pure; see `src/domain`). The caller resolves both points
 * itself — the listing's from pickup-location, coarse detail coordinates or the city page,
 * whichever it used, named by `basis` — and never from Facebook location text directly
 * (`docs/design/modules/location.md`, "Does / does not"). No SQL view calls this function.
 */
export function distanceKm(
  from: LocationPoint,
  to: LocationPoint,
  basis: LocationDistanceBasis,
): LocationDistance {
  return computeDistanceKm(from, to, basis)
}

/**
 * The town label (the city page's own name) for each of the given city-page IDs, read from
 * city-pages' `v_city_pages` (`@nabvy/city-pages`'s `listCityPages`). One call for the whole
 * batch, never one lookup per listing card (`CLAUDE.md`, "Batches, not items"). Off (rule 11):
 * an empty map, the same "no rows" shape as this module's other output. An ID city-pages does
 * not know, or that module's own switch is off for, is likewise simply missing from the map.
 */
export async function townLabel(
  q: Queryable,
  cityPageIds: readonly string[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>()
  if (cityPageIds.length === 0 || (await state(q, 'location')) === 'off') return labels
  const wanted = new Set(cityPageIds)
  const pages = await listCityPages(q)
  const byId = new Map(pages.map((page) => [page.cityPageId, page]))
  for (const id of wanted) {
    const label = townLabelFrom(byId, id)
    if (label !== undefined) labels.set(id, label)
  }
  return labels
}
