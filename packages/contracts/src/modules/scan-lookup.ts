// Contracts of the scan-lookup module (services/scan-lookup, docs/design/modules/scan-lookup.md):
// prices a scanned item from shared data first, then eBay and CeX. In the MVP it reads Facebook
// asks only, as an asking-price position, never a value (docs/decisions.md:85); ebay-adapter,
// ebay-sold, cex-adapter and sold-price-book are off, and a missing row reads as unknown.
// Import from '@nabvy/contracts/modules/scan-lookup'. No schema here carries an invented number:
// every band comes from `asking-price-index`'s own figures over real comparables (CLAUDE.md).
import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'
import {
  AskingPriceIndexCondition,
  AskingPriceIndexContext,
  AskingPriceIndexCurrency,
} from './asking-price-index'
import { ProductCatalogueId } from './product-catalogue'

export const module = 'scan-lookup'

/**
 * Sources this module can price from. Only `facebook` (asking-price-index) is live in the MVP;
 * `ebay`, `ebay_sold` and `cex` name the soft providers that are off (README.md, "Inputs").
 */
export const ScanLookupSource = z.enum(['facebook', 'ebay', 'ebay_sold', 'cex'])
export type ScanLookupSource = z.infer<typeof ScanLookupSource>

/**
 * How a scan's lookup came out. `priced`: at least one band met the band minimum. `not_enough_asks`:
 * every source was queried (or absent) and none met it — never a guessed number (CLAUDE.md,
 * "No invented numbers").
 */
export const ScanLookupStatus = z.enum(['priced', 'not_enough_asks'])
export type ScanLookupStatus = z.infer<typeof ScanLookupStatus>

/**
 * One asking-price position band: the group's own figures, never a value and never "worth" or
 * "fair" (docs/decisions.md:15,21). `context`/`condition` are asking-price-index's; a future
 * ebay/cex band may carry different ones (this module never invents them).
 */
export const ScanLookupBand = z.strictObject({
  source: ScanLookupSource,
  context: AskingPriceIndexContext,
  condition: AskingPriceIndexCondition,
  label: z.string().min(1).max(200),
  n: z.int().min(10),
  median: z.int(),
  rangeLow: z.int(),
  rangeHigh: z.int(),
  currency: AskingPriceIndexCurrency,
})
export type ScanLookupBand = z.infer<typeof ScanLookupBand>

/** What `lookup()` takes: the identified scan's ID (scan-recognition's own scan ID). */
export const ScanLookupInput = z.strictObject({ scanId: Uuid })
export type ScanLookupInput = z.infer<typeof ScanLookupInput>

/** What `lookup()` returns, and the shape of the internal and user-facing views' rows. */
export const ScanLookupResult = z.strictObject({
  scanId: Uuid,
  catalogueId: ProductCatalogueId,
  status: ScanLookupStatus,
  bands: z.array(ScanLookupBand).max(20),
  /** Sources actually queried this lookup; a source with no adapter yet is left out (unknown). */
  sources: z.array(ScanLookupSource).max(4),
  /** Credits charged through `usage-ledger`'s `chargeUsage` (README.md, "Rules and thresholds"). */
  costCredits: z.int().min(0),
  latencyMs: z.int().min(0),
  at: IsoTimestamp,
})
export type ScanLookupResult = z.infer<typeof ScanLookupResult>

/** Row of the internal view `scan_lookup.v_results`: `ScanLookupResult` plus the owning user. */
export const ScanLookupInternalResult = ScanLookupResult.extend({ userId: Uuid })
export type ScanLookupInternalResult = z.infer<typeof ScanLookupInternalResult>

/** Error codes the module returns as values (rule 3 of docs/design/modules/_rules.md). */
export const ScanLookupErrorCode = z.enum([
  'scan-lookup.off', //                  the module is off: scans identify but do not price
  'scan-lookup.invalid_input', //        the input failed its schema
  'scan-lookup.account_restricted', //   the account is suspended or banned
  'scan-lookup.not_found', //            no such scan, or it was never identified
  'scan-lookup.insufficient_credit', //  usage-ledger refused the charge (see `balance`, `required`)
  'scan-lookup.charge_failed', //        usage-ledger refused for another reason (its own switch, standing)
])
export type ScanLookupErrorCode = z.infer<typeof ScanLookupErrorCode>

export const ScanLookupError = z.strictObject({
  code: ScanLookupErrorCode,
  message: z.string().min(1),
  balance: z.int().min(0).optional(),
  required: z.int().min(0).optional(),
})
export type ScanLookupError = z.infer<typeof ScanLookupError>

/**
 * This module emits no events (rule 7): its output is `chargeUsage()` calls on the user's own
 * ledger, run inside the caller's transaction (README.md, "Outputs").
 */
export const events = defineEvents(module, {})
