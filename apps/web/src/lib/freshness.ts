import type { Freshness } from '@/data/types'
import { formatTime } from './format'

export type FreshnessPart = { label: 'listed' | 'found' | 'delivered'; time: string; iso: string }

/**
 * The parts of a freshness stamp, "listed 14:02 · found 14:05 · delivered 14:05"
 * (docs/web-app.md). A stage that has not happened yet is left out rather than guessed.
 */
export function freshnessParts(freshness: Freshness): FreshnessPart[] {
  const parts: FreshnessPart[] = []
  const stages = [
    ['listed', freshness.listedAt],
    ['found', freshness.foundAt],
    ['delivered', freshness.deliveredAt],
  ] as const
  for (const [label, iso] of stages) {
    if (iso) parts.push({ label, iso, time: formatTime(iso) })
  }
  return parts
}

export function freshnessText(freshness: Freshness): string {
  return freshnessParts(freshness)
    .map((part) => `${part.label} ${part.time}`)
    .join(' · ')
}
