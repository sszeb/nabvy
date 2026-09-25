import type { CopyAdvertRuleConfig } from '@nabvy/contracts/modules/copy-advert'

const EARTH_RADIUS_KM = 6371

/** Great-circle distance between two coordinates, matching city-pages' own `haversineKm`. */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

export interface CityPageLabels {
  cityPageId: string
  labels: readonly string[]
}

/**
 * Two city pages count as one town when they share any label (docs 4.8): a union-find over city
 * pages, joined by label. Returns each city page ID's canonical town key (its group's smallest
 * city page ID, for determinism).
 */
export function townGroups(pages: readonly CityPageLabels[]): Map<string, string> {
  const parent = new Map<string, string>(pages.map((p) => [p.cityPageId, p.cityPageId]))
  const find = (x: string): string => {
    let root = x
    while (parent.get(root) !== root) root = parent.get(root) as string
    return root
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) return
    if (ra < rb) parent.set(rb, ra)
    else parent.set(ra, rb)
  }
  const byLabel = new Map<string, string[]>()
  for (const p of pages) {
    for (const label of p.labels) byLabel.set(label, [...(byLabel.get(label) ?? []), p.cityPageId])
  }
  for (const ids of byLabel.values()) {
    const [first] = ids
    if (first) for (let i = 1; i < ids.length; i++) union(first, ids[i] as string)
  }
  return new Map(pages.map((p) => [p.cityPageId, find(p.cityPageId)]))
}

export interface ClusterMember {
  listingId: string
  sourceListingId: string
  cityPageId: string | null
  listedAt: Date | null
  lat: number | null
  lng: number | null
}

/** A member's town key: its group from `townGroups`, or a private key when it has no city page. */
function townKeyOf(
  member: Pick<ClusterMember, 'listingId' | 'cityPageId'>,
  townOf: Map<string, string>,
) {
  if (!member.cityPageId) return `listing:${member.listingId}`
  return townOf.get(member.cityPageId) ?? member.cityPageId
}

export interface ClusterFacts {
  listingCount: number
  townCount: number
  spanDays: number
  spreadKm: number | null
  massPosted: boolean
}

/** Cluster-level facts, computed over active, unsuppressed, confirmed members (docs 4.8). */
export function clusterFacts(
  members: readonly ClusterMember[],
  townOf: Map<string, string>,
  rules: Pick<CopyAdvertRuleConfig, 'massPostedMinTowns'>,
): ClusterFacts {
  const towns = new Set(members.map((m) => townKeyOf(m, townOf)))
  const times = members
    .map((m) => m.listedAt?.getTime())
    .filter((t): t is number => t !== undefined)
  const spanDays =
    times.length > 0 ? Math.ceil((Math.max(...times) - Math.min(...times)) / 86_400_000) : 0
  const withCoords = members.filter(
    (m): m is ClusterMember & { lat: number; lng: number } => m.lat !== null && m.lng !== null,
  )
  let spreadKm: number | null = null
  for (let i = 0; i < withCoords.length; i++) {
    for (let j = i + 1; j < withCoords.length; j++) {
      const a = withCoords[i] as (typeof withCoords)[number]
      const b = withCoords[j] as (typeof withCoords)[number]
      const d = haversineKm(a, b)
      if (spreadKm === null || d > spreadKm) spreadKm = d
    }
  }
  return {
    listingCount: members.length,
    townCount: towns.size,
    spanDays,
    spreadKm,
    massPosted: towns.size >= rules.massPostedMinTowns,
  }
}

export interface ListingFacts {
  towns: number
  spanDays: number
}

/**
 * Per-listing facts (docs 4.8): computed from members in towns other than the listing's own, so a
 * same-town relist adds no town and no days. `towns` = 1 + the number of other towns; `spanDays` =
 * the spread of `listedAt` over the listing itself and the earliest member in each other town.
 */
export function listingFacts(
  target: ClusterMember,
  members: readonly ClusterMember[],
  townOf: Map<string, string>,
): ListingFacts {
  const ownTown = townKeyOf(target, townOf)
  const earliestByOtherTown = new Map<string, ClusterMember>()
  for (const m of members) {
    if (m.listingId === target.listingId) continue
    const town = townKeyOf(m, townOf)
    if (town === ownTown) continue
    const current = earliestByOtherTown.get(town)
    const mTime = m.listedAt?.getTime() ?? Number.POSITIVE_INFINITY
    const currentTime = current?.listedAt?.getTime() ?? Number.POSITIVE_INFINITY
    if (!current || mTime < currentTime) earliestByOtherTown.set(town, m)
  }
  const times = [
    target.listedAt?.getTime(),
    ...[...earliestByOtherTown.values()].map((m) => m.listedAt?.getTime()),
  ].filter((t): t is number => t !== undefined)
  const spanDays =
    times.length > 1 ? Math.ceil((Math.max(...times) - Math.min(...times)) / 86_400_000) : 0
  return { towns: 1 + earliestByOtherTown.size, spanDays }
}
