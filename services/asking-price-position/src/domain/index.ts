// Pure positioning rules: no I/O. A listing's ask is placed among the counted asks of one
// asking-price-index group (README.md, "Rules and thresholds"). Nothing here says "worth", "fair"
// or "sale price", and nothing here is shown as a score (PARTS_INTELLIGENCE.md:365-367).

/** Exclusions the group decides; a member excluded only for one of these is still positioned. */
const GROUP_LEVEL = new Set(['relist', 'copy', 'seller', 'outlier'])

export interface Member {
  listingId: string
  askMinor: number
  counted: boolean
  excluded: string | null
}

/**
 * Whether a member gets a position: counted asks, and asks the group left out as a duplicate
 * (relist, copy, one per seller key) or an outlier. Asks left out for the listing's own reasons
 * (noise, sold, suppressed, stale, £0 and the rest) get none.
 */
export const positionable = (m: Member): boolean =>
  m.counted || (m.excluded !== null && GROUP_LEVEL.has(m.excluded))

export interface Placement {
  /** 1 for the lowest ask; equal asks share a rank. Null when the group has no counted ask. */
  rank: number | null
  /** Mid-rank percentile, 0-100, one decimal. Null when the group has no counted ask. */
  percentile: number | null
}

/**
 * Places `askMinor` among `counted` (the group's counted asks). The rank is one plus the number of
 * counted asks strictly lower; the percentile is (lower + half the equal) / n, which puts the 4th
 * of 12 distinct asks at 29.2 (PARTS_INTELLIGENCE.md:74-79: "about the 29th percentile").
 */
export function place(askMinor: number, counted: number[]): Placement {
  if (counted.length === 0) return { rank: null, percentile: null }
  let below = 0
  let equal = 0
  for (const a of counted) {
    if (a < askMinor) below++
    else if (a === askMinor) equal++
  }
  return {
    rank: below + 1,
    percentile: round((100 * (below + equal / 2)) / counted.length, 1),
  }
}

/** (ask − median) / (scale·MAD), two decimals; null without a median or with a zero MAD. */
export function robustZ(
  askMinor: number,
  median: number | null,
  mad: number | null,
  scale: number,
): number | null {
  if (median === null || mad === null || mad <= 0) return null
  return round((askMinor - median) / (scale * mad), 2)
}

const round = (x: number, places: number) => {
  const f = 10 ** places
  return Math.round(x * f) / f
}

/** Whether a position with this n is shown to users (nabvy/docs/decisions.md:15). */
export const shown = (n: number, minShownN: number): boolean => n >= minShownN

/**
 * The group key of the same item's new-condition group, or null when this group is already new.
 * Group keys are `<catalogue>|<context>|<condition>|<country>|<currency>|<n>d` (asking-price-index).
 */
export function newGroupKeyOf(groupKey: string): string | null {
  const parts = groupKey.split('|')
  if (parts.length !== 6 || parts[2] === 'new') return null
  parts[2] = 'new'
  return parts.join('|')
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
