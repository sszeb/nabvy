import type { PricePosition } from '@/data/types'

/**
 * Asking-price position against comparable asks (docs/decisions.md, Precedence, "Price wording").
 * Shown only when there are at least MIN_COMPARABLE_ASKS comparable asks; the brief is split
 * between 10 and 5, and the conservative reading (10) applies until the owner decides
 * (docs/questions.md). The wording always speaks of asks: never what an item is worth, never a
 * fair value, never a sale price.
 */
export const MIN_COMPARABLE_ASKS = 10

export const NOT_ENOUGH_ASKS = 'Not enough comparable asks'

export type PositionView =
  | { kind: 'hidden'; text: typeof NOT_ENOUGH_ASKS; basis: string }
  | {
      kind: 'shown'
      /** Share of comparable asks that are higher than this ask, 0..100. */
      higherShare: number
      text: string
      band: 'low' | 'middle' | 'high'
      basis: string
      /** Marker and quartile positions on a 0..100 scale from the lowest to the highest ask. */
      scale: { marker: number; lowerQuartile: number; upperQuartile: number; median: number }
    }

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

export function describePosition(position: PricePosition): PositionView {
  const basis = `${position.comparableCount} ${position.comparableCount === 1 ? 'ask' : 'asks'} for ${position.comparableLabel}`
  if (position.comparableCount < MIN_COMPARABLE_ASKS) {
    return { kind: 'hidden', text: NOT_ENOUGH_ASKS, basis }
  }
  const higherShare = Math.round(clampPercent(100 - position.percentile))
  const band = position.percentile <= 25 ? 'low' : position.percentile >= 75 ? 'high' : 'middle'
  const text =
    band === 'low'
      ? `Lower than ${higherShare}% of comparable asks`
      : band === 'high'
        ? `Higher than ${Math.round(position.percentile)}% of comparable asks`
        : 'In the middle of comparable asks'
  const { lowestMinor, highestMinor } = position.range
  const span = Math.max(1, highestMinor - lowestMinor)
  const at = (minor: number) => clampPercent(((minor - lowestMinor) / span) * 100)
  return {
    kind: 'shown',
    higherShare,
    text,
    band,
    basis,
    scale: {
      marker: at(position.askMinor),
      lowerQuartile: at(position.range.lowerQuartileMinor),
      median: at(position.range.medianMinor),
      upperQuartile: at(position.range.upperQuartileMinor),
    },
  }
}
