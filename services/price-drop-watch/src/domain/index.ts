// Pure logic of the price-drop-watch module: no I/O. A drop is only ever a comparison of two of
// listing-ingest's own observed prices; nothing here invents a number (README.md, "Rules").
import { createHash } from 'node:crypto'

export type Currency = 'GBP' | 'EUR'

/** A price drop: strictly lower, same currency, both non-negative (the schema's own checks). */
export function isDrop(previousMinor: number, priceMinor: number): boolean {
  return priceMinor < previousMinor
}

/** One listing's price-change candidate for a watch, before the relist-merge dedupe. */
export interface DropCandidate {
  watchId: string
  listingId: string
  watchCreatedAt: string
  fromMinor: number
  toMinor: number
  currency: Currency
  observedAt: string
  cardHash: string
  /** relist-merge's group ID for the listing at write time; null when ungrouped or off. */
  relistGroupId: string | null
}

export interface DropDecision extends DropCandidate {
  /** Whether this drop is announced in the batch's `dropped` event (see `dedupeAnnouncements`). */
  announce: boolean
}

/**
 * Every candidate is still written to `drops` (each watch keeps its own history), but relist-merge
 * "only stops the same item alerting twice" (README.md, catalogue question 21): when two or more
 * watches in one batch sit on listings relist-merge has put in the same group, and the batch's
 * price drop for them lands on the same new price, only the earliest watch (by `watchCreatedAt`,
 * then `watchId`) is announced. Candidates with no group (relist-merge off, or the listing
 * ungrouped) are never deduped against each other.
 */
export function dedupeAnnouncements(candidates: readonly DropCandidate[]): DropDecision[] {
  const groups = new Map<string, DropCandidate[]>()
  const ungrouped: DropCandidate[] = []
  for (const c of candidates) {
    if (c.relistGroupId === null) {
      ungrouped.push(c)
      continue
    }
    const key = `${c.relistGroupId}@${c.toMinor}`
    const group = groups.get(key)
    if (group) group.push(c)
    else groups.set(key, [c])
  }
  const decided: DropDecision[] = ungrouped.map((c) => ({ ...c, announce: true }))
  for (const group of groups.values()) {
    const ordered = [...group].sort(
      (a, b) =>
        a.watchCreatedAt.localeCompare(b.watchCreatedAt) || a.watchId.localeCompare(b.watchId),
    )
    decided.push(...ordered.map((c, i) => ({ ...c, announce: i === 0 })))
  }
  return decided
}

/**
 * Whether a price change was observed while the watch existed: at or after the watch's
 * `created_at`. A drop observed before the user started watching is never announced to them, nor
 * written to their watch's history (README.md, "Decisions"). Reactivating a watch keeps its
 * original `created_at`.
 */
export function observedDuringWatch(observedAt: string, watchCreatedAt: string): boolean {
  return Date.parse(observedAt) >= Date.parse(watchCreatedAt)
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * The trigger of a check pass as stored, hashed when longer than 400 characters so the outgoing
 * key stays within 512 (as listing-lifecycle's `triggerId`).
 */
export function triggerId(trigger: string): string {
  return trigger.length <= 400 ? trigger : createHash('sha256').update(trigger).digest('hex')
}

/** `price-drop-watch.dropped:<trigger>:<batch>`. */
export function eventKey(trigger: string, batch: number): string {
  return `price-drop-watch.dropped:${triggerId(trigger)}:${batch}`
}
