import { z } from 'zod'

// Thresholds of the scan-lookup module (rule 14 of docs/design/modules/_rules.md).

const scanLookupConfig = z.object({
  minBandSize: z.int().positive(),
  country: z.string().regex(/^[A-Z]{2}$/),
  currency: z.enum(['GBP', 'EUR']),
  creditCost: z.int().min(0),
})

const config = scanLookupConfig.parse({
  /**
   * A band is only shown at n >= this many counted asks, the same floor asking-price-index's own
   * user-facing bands use. Basis: docs/decisions.md:15 (owner's rule). Status: fixed, shared with
   * asking-price-index rather than re-derived, so the two never drift apart.
   */
  minBandSize: 10,
  /**
   * The beta is UK-only (docs/decisions.md, Precedence, "Region and currency": "For the beta: UK
   * only, Ireland skipped"). Status: fixed for this push.
   */
  country: 'GB',
  currency: 'GBP',
  /**
   * Credits charged per scan lookup through `usage-ledger`'s `chargeUsage`. Basis: none measured;
   * `pricing-console` (task 4.10b) does not exist yet to value it, the same gap `usage-ledger`
   * records for policy-valued grants (README.md, "pendingPricingConsole"). Status: starting value,
   * pending pricing-console (docs/questions/scan-lookup.md).
   */
  creditCost: 1,
})

export const SCAN_LOOKUP_MIN_BAND_SIZE = config.minBandSize
export const SCAN_LOOKUP_COUNTRY = config.country
export const SCAN_LOOKUP_CURRENCY = config.currency
export const SCAN_LOOKUP_CREDIT_COST = config.creditCost
