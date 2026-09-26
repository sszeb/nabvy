// Pure logic: no I/O, no database, no clock (the caller passes `now`). Weeks, counting and
// suppression (README.md, "Rules and thresholds").

/** One row of want-manager's `v_want_terms_by_centre`, as this module reads it. */
export interface WantTerm {
  centreId: string
  family: string
  wantCount: number
}

/**
 * One wanted or swap advert naming one family at one centre in the week. A listing naming two
 * families is two rows. `clusterKey` is copy-advert's cluster when the listing is a member of an
 * active one (null when it is not, or while copy-advert is off).
 */
export interface AdvertRow {
  listingId: string
  centreId: string
  family: string
  clusterKey: string | null
}

/** A cell ready to store: counts under the threshold are already null. */
export interface CellDraft {
  centreId: string
  family: string
  wants: number | null
  adverts: number | null
  suppressed: boolean
}

const DAY_MS = 86_400_000

/** The ISO date of the Monday (00:00 UTC) of the week holding `at`. */
export function weekStartOf(at: Date): string {
  const day = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())
  const isoDow = new Date(day).getUTCDay() || 7 // Monday 1 … Sunday 7
  return new Date(day - (isoDow - 1) * DAY_MS).toISOString().slice(0, 10)
}

/** The week's half-open range [from, to). */
export function weekRange(weekStart: string): { from: Date; to: Date } {
  const from = new Date(`${weekStart}T00:00:00.000Z`)
  return { from, to: new Date(from.getTime() + 7 * DAY_MS) }
}

/** A week is closed once its last instant has passed; only a closed week is published. */
export function isClosed(weekStart: string, now: Date): boolean {
  return weekRange(weekStart).to.getTime() <= now.getTime()
}

/** The latest closed week at `now`: the week before the one `now` falls in. */
export function lastClosedWeek(now: Date): string {
  return weekStartOf(new Date(now.getTime() - 7 * DAY_MS))
}

/** A count as stored and shown: itself at or above the threshold, else null. */
export function shownCount(count: number, threshold: number): number | null {
  return count >= threshold ? count : null
}

/**
 * The cells of one week. Wants are summed per centre and family (the view already groups them;
 * summing makes a duplicated input row harmless). Adverts are counted as distinct units per cell:
 * a copy-advert cluster is one unit, so a wanted advert posted in many towns counts once per cell,
 * and any other listing is its own unit. Every count under `threshold` becomes null; a cell whose
 * counts are both null is suppressed. Sorted by centre, then family, so output is deterministic.
 */
export function buildCells(
  wants: readonly WantTerm[],
  adverts: readonly AdvertRow[],
  threshold: number,
): CellDraft[] {
  const cells = new Map<
    string,
    { centreId: string; family: string; wants: number; units: Set<string> }
  >()
  const cell = (centreId: string, family: string) => {
    const key = JSON.stringify([centreId, family])
    let c = cells.get(key)
    if (!c) {
      c = { centreId, family, wants: 0, units: new Set() }
      cells.set(key, c)
    }
    return c
  }
  for (const w of wants) cell(w.centreId, w.family).wants += w.wantCount
  for (const a of adverts) {
    cell(a.centreId, a.family).units.add(a.clusterKey ? `c:${a.clusterKey}` : `l:${a.listingId}`)
  }
  return [...cells.values()]
    .map((c) => {
      const w = shownCount(c.wants, threshold)
      const ad = shownCount(c.units.size, threshold)
      return {
        centreId: c.centreId,
        family: c.family,
        wants: w,
        adverts: ad,
        suppressed: w === null && ad === null,
      }
    })
    .sort((a, b) =>
      a.centreId === b.centreId ? cmp(a.family, b.family) : cmp(a.centreId, b.centreId),
    )
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** The idempotency key of a week's `demand-signals.published` (rule 8: natural ID + version). */
export function publishedKey(weekStart: string, ruleVersion: string): string {
  return `demand-signals.published:${weekStart}@${ruleVersion}`
}
