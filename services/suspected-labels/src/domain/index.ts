import type {
  SuspectedLabelsSignalState,
  SuspectedLabelsTgtbtPath,
  SuspectedLabelsTgtbtSignal,
  SuspectedLabelsTgtbtSupport,
} from '@nabvy/contracts/modules/suspected-labels'

/**
 * Signal detected in a listing for too-good-to-be-true evaluation.
 */
export interface SignalEvidenceItem {
  signal: SuspectedLabelsTgtbtSignal
  state: SuspectedLabelsSignalState
  support: SuspectedLabelsTgtbtSupport
  source: 'listing' | 'report'
  detail?: string
}

/**
 * Evaluates whether signals meet the criteria for a too-good-to-be-true label.
 * Requires two independent pieces of evidence via one of three paths:
 * - Path A: Two listing signals
 * - Path B: One report + one listing signal (but not price-only)
 * - Path C: Reports from independent people (threshold TBD)
 * - Path B-P: One report + price signal only (review-only, never shown automatically)
 */
export function evaluateTgtbtSignals(
  signals: SignalEvidenceItem[],
  reportCount: number = 0,
): { path: SuspectedLabelsTgtbtPath | null; would_show: boolean } {
  // Count signals by source
  const listingSignals = signals.filter((s) => s.source === 'listing' && s.state === 'present')
  const priceSignals = listingSignals.filter((s) => s.signal === 'ask_far_below_comparable')
  const nonPriceSignals = listingSignals.filter((s) => s.signal !== 'ask_far_below_comparable')

  // Path A: Two independent listing signals (different types)
  if (listingSignals.length >= 2) {
    const types = new Set(listingSignals.map((s) => s.signal))
    if (types.size >= 2) {
      return { path: 'A', would_show: true }
    }
  }

  // Path C: Multiple reports (threshold TBD, starting at 2)
  if (reportCount >= 2) {
    return { path: 'C', would_show: true }
  }

  // Path B-P: One report + price signal ONLY (review-only, does not show)
  if (reportCount > 0 && priceSignals.length >= 1 && nonPriceSignals.length === 0) {
    return { path: 'B-P', would_show: false }
  }

  // Path B: One report + one non-price listing signal
  if (reportCount > 0 && nonPriceSignals.length >= 1) {
    return { path: 'B', would_show: true }
  }

  return { path: null, would_show: false }
}

/**
 * Determines if a signal is present based on the listing's signals.
 */
export function hasSignal(
  signal: SuspectedLabelsTgtbtSignal,
  signals: SignalEvidenceItem[],
): boolean {
  return signals.some((s) => s.signal === signal && s.state === 'present')
}
