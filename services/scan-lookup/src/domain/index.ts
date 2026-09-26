// Pure logic: no I/O, no database, no clock or randomness passed in implicitly.
import type {
  AskingPriceIndexCondition,
  AskingPriceIndexContext,
  AskingPriceIndexCurrency,
} from '@nabvy/contracts/modules/asking-price-index'
import type { ScanLookupBand, ScanLookupStatus } from '@nabvy/contracts/modules/scan-lookup'

/** One row of `asking_price_index.v_groups`, filtered to one catalogue item, country and currency. */
export interface GroupFigures {
  context: AskingPriceIndexContext
  condition: AskingPriceIndexCondition
  currency: AskingPriceIndexCurrency
  label: string
  n: number | null
  median: number | null
  p25: number | null
  p75: number | null
}

/**
 * Turns asking-price-index's groups into bands: only groups whose figures are complete and whose
 * `n` reaches the band minimum (docs/decisions.md:15) become a band. No invented number: a group
 * with no median (nothing counted yet) is left out, never shown as zero (CLAUDE.md).
 */
export function bandsFrom(rows: GroupFigures[], minN: number): ScanLookupBand[] {
  return rows
    .filter(
      (r): r is GroupFigures & { n: number; median: number; p25: number; p75: number } =>
        r.n !== null && r.n >= minN && r.median !== null && r.p25 !== null && r.p75 !== null,
    )
    .map((r) => ({
      source: 'facebook' as const,
      context: r.context,
      condition: r.condition,
      label: r.label,
      n: r.n,
      median: r.median,
      rangeLow: r.p25,
      rangeHigh: r.p75,
      currency: r.currency,
    }))
}

/** `priced` once at least one source found a band meeting the minimum; else "not enough asks". */
export function statusOf(bands: ScanLookupBand[]): ScanLookupStatus {
  return bands.length > 0 ? 'priced' : 'not_enough_asks'
}
