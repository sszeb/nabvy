// Event handlers. Each takes a batch (100-500 items), is idempotent (key
// source + sourceListingId + contentHash, or the natural id + version) and stamps its
// T-timestamps (CLAUDE.md; _rules.md rules 8-10).

/**
 * Handler for warning-signs.found events. Evaluates listings for too-good-to-be-true signals.
 */
export async function evaluateWarningSignals(_listingIds: string[]): Promise<void> {
  // Placeholder for warning signals evaluation
  // Will read warning-signs facts and update candidates
}

/**
 * Handler for copy-advert.clustered events. Uses copy spread for too-good-to-be-true evidence.
 */
export async function evaluateCopyAdvert(_listingIds: string[]): Promise<void> {
  // Placeholder for copy-advert evaluation
  // Will check for widespread copies as evidence of too-good-to-be-true
}

/**
 * Handler for seller-reply-reports.recorded events. Uses user reports as evidence.
 */
export async function evaluateReports(_listingIds: string[]): Promise<void> {
  // Placeholder for user report evaluation
  // Will aggregate reports and create candidates
}

/**
 * Handler for asking-price-index.updated events. Uses price signals for evaluation.
 */
export async function evaluatePriceSignals(_groupKeys: string[]): Promise<void> {
  // Placeholder for price signal evaluation
  // Will check if asks are far below comparable
}
