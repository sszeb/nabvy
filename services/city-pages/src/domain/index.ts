// Pure logic: no I/O, no database, no clock or randomness passed in implicitly.
import type { CityPagesErrorCode } from '@nabvy/contracts/modules/city-pages'

/** Thrown by `verify()`: the change is refused and nothing is written. */
export class CityPagesRefused extends Error {
  constructor(
    readonly code: CityPagesErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'CityPagesRefused'
  }
}

export type SeedCityPage = {
  cityPageId: string
  name: string
  towns: string[]
  lat: number | null
  lng: number | null
  listingsSeen: number
  verifiedAsSearchCentre: boolean
}

export type GridPoint = { cityPageId: string; lat: number; lng: number }

/**
 * Great-circle distance in km (haversine, Earth radius 6371 km). The SQL view
 * `city_pages.v_area_membership` implements the same formula; `test/domain.test.ts` proves they
 * agree at the boundary the config threshold names.
 */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * The nearest of `centres` to `point`, or null if `centres` is empty. Mirrors the SQL view's
 * `order by distance_km limit 1`.
 */
export function nearestCentre(
  point: { lat: number; lng: number },
  centres: GridPoint[],
): { cityPageId: string; distanceKm: number } | null {
  let best: { cityPageId: string; distanceKm: number } | null = null
  for (const centre of centres) {
    const distanceKm = haversineKm(point, centre)
    if (!best || distanceKm < best.distanceKm) best = { cityPageId: centre.cityPageId, distanceKm }
  }
  return best
}

/**
 * Greedy farthest-point selection of a national grid from seed entries with coordinates: starts
 * from `forced` (city pages with no seed coordinate of their own, already known to be centres —
 * the module's verified centres whose coordinate comes only from Facebook's reported centre, not
 * the seed), then repeatedly adds the seed entry farthest from every centre chosen so far, until
 * none remains at least `minSeparationKm` from every chosen centre. Deterministic: ties break on
 * `cityPageId` so the result does not depend on object identity or iteration order.
 */
export function selectGrid(
  candidates: SeedCityPage[],
  forced: GridPoint[],
  minSeparationKm: number,
): string[] {
  const withCoords = candidates
    .filter(
      (c): c is SeedCityPage & { lat: number; lng: number } => c.lat !== null && c.lng !== null,
    )
    .sort((a, b) => a.cityPageId.localeCompare(b.cityPageId))
  const chosen: GridPoint[] = [...forced]
  const selected: string[] = []
  let remaining = withCoords
  for (;;) {
    let farthest: { candidate: (typeof withCoords)[number]; distanceKm: number } | null = null
    for (const candidate of remaining) {
      const nearest = chosen.length === 0 ? null : nearestCentre(candidate, chosen)
      const distanceKm = nearest ? nearest.distanceKm : Number.POSITIVE_INFINITY
      if (
        !farthest ||
        distanceKm > farthest.distanceKm ||
        (distanceKm === farthest.distanceKm && candidate.cityPageId < farthest.candidate.cityPageId)
      ) {
        farthest = { candidate, distanceKm }
      }
    }
    if (!farthest || (chosen.length > 0 && farthest.distanceKm < minSeparationKm)) break
    chosen.push(farthest.candidate)
    selected.push(farthest.candidate.cityPageId)
    remaining = remaining.filter((c) => c.cityPageId !== farthest?.candidate.cityPageId)
  }
  return selected
}

export type SeenRow = {
  cityPageId: string
  townLabel: string | null
  firstSeenAt: Date
}

export type NewCityPage = {
  cityPageId: string
  name: string
  towns: string[]
  firstSeenAt: Date
}

/**
 * City pages in `seen` (from listing-ingest's `v_city_pages_seen`) that are not yet in
 * `knownIds`. Never parses the town label: `name` and the one entry of `towns` are exactly what
 * listing-ingest reported (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:32-38). A page with no town
 * label yet (`townLabel` null) is named after its own ID, since the module has no other source
 * for a name and does not guess one.
 */
export function newCityPagesFrom(seen: SeenRow[], knownIds: ReadonlySet<string>): NewCityPage[] {
  const out: NewCityPage[] = []
  const added = new Set<string>()
  for (const row of seen) {
    if (knownIds.has(row.cityPageId) || added.has(row.cityPageId)) continue
    added.add(row.cityPageId)
    out.push({
      cityPageId: row.cityPageId,
      name: row.townLabel ?? row.cityPageId,
      towns: row.townLabel ? [row.townLabel] : [],
      firstSeenAt: row.firstSeenAt,
    })
  }
  return out
}
