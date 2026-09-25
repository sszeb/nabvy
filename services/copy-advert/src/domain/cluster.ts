import { sha256Hex } from './fingerprint'

export interface Edge {
  a: string
  b: string
}

/**
 * Connected components over confirmed links (`exact_text`/`near_text` only; docs/design/drafts/copy-advert.md
 * 4.8, S8). A plain union-find: clusters in this module are small (copies are rare), so this
 * revisits at most the touched listings, well inside the platform's shallow-graph guidance.
 */
export function components(nodes: readonly string[], edges: readonly Edge[]): string[][] {
  const parent = new Map<string, string>(nodes.map((n) => [n, n]))
  const ensure = (x: string) => {
    if (!parent.has(x)) parent.set(x, x)
  }
  const find = (x: string): string => {
    ensure(x)
    let root = x
    while (parent.get(root) !== root) root = parent.get(root) as string
    let cur = x
    while (parent.get(cur) !== root) {
      const next = parent.get(cur) as string
      parent.set(cur, root)
      cur = next
    }
    return root
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const e of edges) union(e.a, e.b)
  const groups = new Map<string, string[]>()
  for (const n of parent.keys()) {
    const root = find(n)
    const arr = groups.get(root)
    if (arr) arr.push(n)
    else groups.set(root, [n])
  }
  return [...groups.values()]
}

export interface KeyMember {
  listingId: string
  sourceListingId: string
  listedAt: Date | null
}

/**
 * Deterministic cluster key: sha256(rule version | the source listing ID of the earliest-listed
 * member), ties broken by source listing ID so a replay always picks the same one (docs 4.8).
 */
export function clusterKey(ruleVersion: string, members: readonly KeyMember[]): string {
  if (members.length === 0) throw new Error('clusterKey: no members')
  const [earliest] = [...members].sort((a, b) => {
    const at = a.listedAt?.getTime() ?? Number.POSITIVE_INFINITY
    const bt = b.listedAt?.getTime() ?? Number.POSITIVE_INFINITY
    if (at !== bt) return at - bt
    return a.sourceListingId < b.sourceListingId
      ? -1
      : a.sourceListingId > b.sourceListingId
        ? 1
        : 0
  })
  if (!earliest) throw new Error('clusterKey: no members')
  return sha256Hex(`${ruleVersion}|${earliest.sourceListingId}`)
}

/** A cluster's version: sha256 of its sorted member listing IDs (docs 4.8). */
export function memberSetHash(listingIds: readonly string[]): string {
  return sha256Hex([...listingIds].sort().join(','))
}
