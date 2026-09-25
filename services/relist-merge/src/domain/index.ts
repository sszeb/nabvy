// Pure rules of relist-merge: no I/O. Which listing IDs are the same item listed again, and which
// group each joins (README.md, "Rules and thresholds"; fb-scrap-engine SELLER_DATA.md:147-152).
import { createHash } from 'node:crypto'
import type { RelistMergeBasis } from '@nabvy/contracts/modules/relist-merge'

const DAY_MS = 24 * 60 * 60 * 1000

/** What matching needs of a listing, from listing-ingest's `v_listings`. */
export interface ListingFacts {
  listingId: string
  source: string
  cityPageId: string | null
  /** Listed time (T0) when known, else the first fetch (T1), in ms. */
  fromMs: number
  /** Last sighting, in ms. */
  toMs: number
  /** T1 as ISO text, stored with the membership (rule 10). */
  firstFetchedAt: string
}

/** One piece of evidence that two listings show the same item. */
export interface Evidence {
  listingId: string
  otherListingId: string
  basis: Exclude<RelistMergeBasis, 'origin'>
}

/**
 * One seller key of a listing, as seller-key's `restricted_listing_keys` gives it. Used in memory
 * only, for tie-breaks and blocks, and never stored or published.
 */
export interface SellerKey {
  key: string
  keyType: 'numeric' | 'token'
  runId: string
}

/** A planned write: open a group on an earlier listing, or join an existing or planned group. */
export type Step =
  | {
      kind: 'open'
      ref: string
      origin: ListingFacts
      member: ListingFacts
      basis: Evidence['basis']
    }
  | {
      kind: 'join'
      group: { groupId: string } | { ref: string }
      member: ListingFacts
      matched: string
      basis: Evidence['basis']
    }

/** Gap in ms between two listings' sighting intervals; 0 when they overlap. */
export function gapMs(a: ListingFacts, b: ListingFacts): number {
  return Math.max(0, Math.max(a.fromMs, b.fromMs) - Math.min(a.toMs, b.toMs))
}

/**
 * Whether evidence between two listings may merge them at all: same source, the same known city
 * page, and within the window. Applies to description and photo matches alike (the brief's "within
 * the same city page and 7 days"; docs/questions/relist-merge.md).
 */
export function withinReach(a: ListingFacts, b: ListingFacts, windowDays: number): boolean {
  return (
    a.listingId !== b.listingId &&
    a.source === b.source &&
    a.cityPageId !== null &&
    a.cityPageId === b.cityPageId &&
    gapMs(a, b) <= windowDays * DAY_MS
  )
}

/** Two listings share a seller key. */
export function sharesKey(a: SellerKey[], b: SellerKey[]): boolean {
  return a.some((ka) => b.some((kb) => ka.key === kb.key))
}

/**
 * Different keys block a merge only when both are numeric IDs or were seen in the same run
 * (tokens rotate between runs, so different tokens from different runs say nothing). A shared key
 * never blocks. Unknown keys never block.
 */
export function blocked(a: SellerKey[], b: SellerKey[]): boolean {
  if (sharesKey(a, b)) return false
  return a.some((ka) =>
    b.some(
      (kb) =>
        ka.key !== kb.key &&
        ((ka.keyType === 'numeric' && kb.keyType === 'numeric') || ka.runId === kb.runId),
    ),
  )
}

const earlier = (a: ListingFacts, b: ListingFacts) =>
  a.fromMs !== b.fromMs ? a.fromMs - b.fromMs : a.listingId < b.listingId ? -1 : 1

const BASIS_RANK: Record<Evidence['basis'], number> = { description: 0, photo: 1 }

/**
 * Plans the merges for a batch. Listings are taken earliest first; a listing already in a group
 * is never moved. Each listing's candidates are filtered by `withinReach` and `blocked` (against
 * the candidate and every member of the candidate's group), then ranked: description before
 * photo, then a shared seller key (the tie-break between equal evidence), the smallest gap, the
 * lowest listing ID. The
 * best candidate's group is joined; if it has none, a group is opened with the earlier of the two
 * as its origin. Deterministic for the same inputs, so a replay plans nothing new.
 */
export function plan(input: {
  arriving: string[]
  facts: Map<string, ListingFacts>
  evidence: Evidence[]
  groupOf: Map<string, string>
  membersOf: Map<string, string[]>
  keysOf: Map<string, SellerKey[]>
  windowDays: number
}): Step[] {
  const { facts, windowDays } = input
  const groupOf = new Map<string, string>(input.groupOf)
  const membersOf = new Map<string, string[]>(
    [...input.membersOf].map(([group, members]) => [group, [...members]]),
  )
  const keys = (id: string) => input.keysOf.get(id) ?? []
  const byListing = new Map<string, Map<string, Evidence['basis']>>()
  const note = (from: string, to: string, basis: Evidence['basis']) => {
    const seen = byListing.get(from) ?? new Map<string, Evidence['basis']>()
    const had = seen.get(to)
    if (!had || BASIS_RANK[basis] < BASIS_RANK[had]) seen.set(to, basis)
    byListing.set(from, seen)
  }
  for (const e of input.evidence) {
    note(e.listingId, e.otherListingId, e.basis)
    note(e.otherListingId, e.listingId, e.basis)
  }

  const steps: Step[] = []
  const arriving = [...new Set(input.arriving)]
    .flatMap((id) => {
      const f = facts.get(id)
      return f ? [f] : []
    })
    .sort(earlier)

  for (const listing of arriving) {
    if (groupOf.has(listing.listingId)) continue
    const options = [...(byListing.get(listing.listingId) ?? [])].flatMap(([otherId, basis]) => {
      const other = facts.get(otherId)
      if (!other || !withinReach(listing, other, windowDays)) return []
      const group = groupOf.get(otherId)
      const others = group ? (membersOf.get(group) ?? [otherId]) : [otherId]
      if (others.some((id) => blocked(keys(listing.listingId), keys(id)))) return []
      return [
        {
          other,
          basis,
          shared: others.some((id) => sharesKey(keys(listing.listingId), keys(id))),
          gap: gapMs(listing, other),
        },
      ]
    })
    options.sort(
      (a, b) =>
        BASIS_RANK[a.basis] - BASIS_RANK[b.basis] ||
        Number(b.shared) - Number(a.shared) ||
        a.gap - b.gap ||
        (a.other.listingId < b.other.listingId ? -1 : 1),
    )
    const best = options[0]
    if (!best) continue

    const group = groupOf.get(best.other.listingId)
    if (group) {
      steps.push({
        kind: 'join',
        group: group.startsWith('ref:') ? { ref: group } : { groupId: group },
        member: listing,
        matched: best.other.listingId,
        basis: best.basis,
      })
      groupOf.set(listing.listingId, group)
      membersOf.get(group)?.push(listing.listingId)
      continue
    }
    const [origin, member] = [listing, best.other].sort(earlier) as [ListingFacts, ListingFacts]
    const ref = `ref:${origin.listingId}`
    steps.push({ kind: 'open', ref, origin, member, basis: best.basis })
    groupOf.set(origin.listingId, ref)
    groupOf.set(member.listingId, ref)
    membersOf.set(ref, [origin.listingId, member.listingId])
  }
  return steps
}

/** SHA-256 hex of text. */
export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/**
 * The version of a set of groups (rule 8: "relist group ID and member-set hash"): each group's
 * ID with the hash of its sorted member IDs, sorted and hashed together. Derived from stored rows,
 * so a replay after a lost publish gives the same key.
 */
export function groupsVersion(groups: Map<string, string[]>): string {
  return sha256(
    [...groups]
      .map(([group, members]) => `${group}@${sha256([...members].sort().join('\n'))}`)
      .sort()
      .join('\n'),
  )
}

/** Splits an array into batches of at most `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Counts each item once (for index readers and the synthetic index case): keeps, of each group,
 * the member listed last (the live listing), and every listing in no group.
 */
export function onePerGroup<T extends { listingId: string; fromMs: number }>(
  rows: T[],
  groupOf: Map<string, string>,
): T[] {
  const kept = new Map<string, T>()
  for (const row of rows) {
    const key = groupOf.get(row.listingId) ?? `listing:${row.listingId}`
    const had = kept.get(key)
    if (
      !had ||
      row.fromMs > had.fromMs ||
      (row.fromMs === had.fromMs && row.listingId > had.listingId)
    ) {
      kept.set(key, row)
    }
  }
  return rows.filter(
    (row) => kept.get(groupOf.get(row.listingId) ?? `listing:${row.listingId}`) === row,
  )
}
