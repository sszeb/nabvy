// Public API of the scan-lookup module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/scan-lookup' only, never from its internals. It prices a
// scanned item from shared data first, then eBay and CeX (README.md). In the MVP it reads
// Facebook asks only, through asking-price-index; ebay-adapter, ebay-sold, cex-adapter and
// sold-price-book are off, and a missing row reads as unknown (README.md, "Inputs").
import { isActive } from '@nabvy/account'
import {
  SCAN_LOOKUP_COUNTRY,
  SCAN_LOOKUP_CREDIT_COST,
  SCAN_LOOKUP_CURRENCY,
  SCAN_LOOKUP_MIN_BAND_SIZE,
} from '@nabvy/config/modules/scan-lookup'
import { err, ok, type Result } from '@nabvy/contracts'
import {
  type ScanLookupBand,
  type ScanLookupError,
  ScanLookupInput,
  type ScanLookupInternalResult,
  type ScanLookupResult,
  type ScanLookupSource,
} from '@nabvy/contracts/modules/scan-lookup'
import type { Queryable } from '@nabvy/db'
import { state } from '@nabvy/switches'
import { chargeUsage } from '@nabvy/usage-ledger'
import { bandsFrom, statusOf } from './domain'
import { insertResult, type LookupRow, selectExisting, selectGroups, selectScan } from './repo'

export { events, module } from '@nabvy/contracts/modules/scan-lookup'
export { identifiedHandler, type ScanLookupHandlerDeps } from './handlers'

const MODULE = 'scan-lookup'
const CHARGE_ACTION = 'scan_lookup'

/**
 * Optional evidence from the soft providers that are not built yet (ebay-adapter, ebay-sold,
 * cex-adapter, sold-price-book): absent in the MVP, so every lookup reads Facebook asks only
 * (README.md, "Inputs"). Each returns the bands it found for this catalogue item, already in the
 * module's own contract shape; an absent function or an empty array both read as unknown, never
 * as a zero price.
 */
export interface ScanLookupProviders {
  ebayAsks?(q: Queryable, catalogueId: string): Promise<ScanLookupBand[]>
  ebaySold?(q: Queryable, catalogueId: string): Promise<ScanLookupBand[]>
  cexPrice?(q: Queryable, catalogueId: string): Promise<ScanLookupBand[]>
}

export interface ScanLookupOptions {
  providers?: ScanLookupProviders
  /** The time the lookup completes at; defaults to now. Tests pin it. */
  now?: Date
  /** The clock used to measure `latencyMs`; defaults to `Date.now`. Tests pin it. */
  clock?: () => number
}

function rowToResult(row: LookupRow): ScanLookupResult {
  return {
    scanId: row.scanId,
    catalogueId: row.catalogueId,
    status: row.status as ScanLookupResult['status'],
    bands: row.bands as ScanLookupBand[],
    sources: row.sources as ScanLookupSource[],
    costCredits: row.cost,
    latencyMs: row.latencyMs,
    at: row.at.toISOString(),
  }
}

/** `lookup()`'s result plus the owning user (the internal view's row shape). */
export function toInternalResult(row: LookupRow): ScanLookupInternalResult {
  return { ...rowToResult(row), userId: row.userId }
}

const refuse = (code: ScanLookupError['code'], message: string): Result<never, ScanLookupError> =>
  err({ code, message })

/**
 * Prices an identified scan: Facebook asks first (through asking-price-index), then the soft
 * eBay and CeX providers when supplied. Charges the scan through usage-ledger's `chargeUsage`,
 * with the price computed first, so nothing is charged for a scan this module cannot price
 * (docs/scan-mode.md, "Guardrails"). Safe to run twice: a replayed scan ID returns the stored
 * lookup and never recharges. Runs inside `withPipeline` (it calls usage-ledger and account,
 * both pipeline-only calls per their own READMEs).
 */
export async function lookup(
  q: Queryable,
  rawInput: ScanLookupInput,
  options: ScanLookupOptions = {},
): Promise<Result<ScanLookupResult, ScanLookupError>> {
  const parsed = ScanLookupInput.safeParse(rawInput)
  if (!parsed.success) return refuse('scan-lookup.invalid_input', parsed.error.message)
  const { scanId } = parsed.data

  const moduleState = await state(q, MODULE)
  if (moduleState === 'off') {
    return refuse('scan-lookup.off', 'Scans identify but do not price right now.')
  }

  const existing = await selectExisting(q, scanId)
  if (existing) return ok(rowToResult(existing))

  const scanRow = await selectScan(q, scanId)
  if (scanRow?.status !== 'identified' || !scanRow.identified) {
    return refuse('scan-lookup.not_found', 'This scan has not been identified yet.')
  }
  const { userId, identified: catalogueId } = scanRow

  if (!(await isActive(q, userId))) {
    return refuse('scan-lookup.account_restricted', 'The account may not price scans right now.')
  }

  const clock = options.clock ?? Date.now
  const startedAt = clock()
  const now = options.now ?? new Date()
  const providers = options.providers ?? {}

  const found: { source: ScanLookupSource; bands: ScanLookupBand[] }[] = [
    {
      source: 'facebook',
      bands: bandsFrom(
        await selectGroups(q, catalogueId, SCAN_LOOKUP_COUNTRY, SCAN_LOOKUP_CURRENCY),
        SCAN_LOOKUP_MIN_BAND_SIZE,
      ),
    },
  ]
  if (providers.ebayAsks)
    found.push({ source: 'ebay', bands: await providers.ebayAsks(q, catalogueId) })
  if (providers.ebaySold) {
    found.push({ source: 'ebay_sold', bands: await providers.ebaySold(q, catalogueId) })
  }
  if (providers.cexPrice)
    found.push({ source: 'cex', bands: await providers.cexPrice(q, catalogueId) })

  const bands = found.flatMap((f) => f.bands)
  const status = statusOf(bands)
  const sources = found.map((f) => f.source)
  const latencyMs = Math.max(0, Math.round(clock() - startedAt))

  // Shadow: computed and kept in the internal view for testing, but never charged — a shadow
  // charge would spend real credit while the user-facing view shows no row to explain it
  // (services/usage-ledger/README.md, "Decisions", the same reasoning applied to this module's
  // own switch).
  let costCredits = 0
  if (moduleState === 'on') {
    const charge = await chargeUsage(q, {
      userId,
      action: CHARGE_ACTION,
      credits: SCAN_LOOKUP_CREDIT_COST,
      refId: scanId,
    })
    if (!charge.ok) {
      if (charge.error.code === 'usage-ledger.insufficient') {
        return err({
          code: 'scan-lookup.insufficient_credit',
          message: charge.error.message,
          balance: charge.error.balance,
          required: charge.error.required,
        })
      }
      return refuse('scan-lookup.charge_failed', charge.error.message)
    }
    costCredits = SCAN_LOOKUP_CREDIT_COST
  }

  const inserted = await insertResult(q, {
    scanId,
    userId,
    catalogueId,
    status,
    sources,
    bands,
    cost: costCredits,
    latencyMs,
    at: now,
  })
  const row = inserted ?? (await selectExisting(q, scanId))
  if (!row) throw new Error(`scan-lookup: lookup ${scanId} was neither inserted nor found`)
  return ok(rowToResult(row))
}
