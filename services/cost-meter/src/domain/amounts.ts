import type { ModelPrice } from '@nabvy/config/modules/cost-meter'
import type { CostMeterCurrency, CostMeterModelUsage } from '@nabvy/contracts/modules/cost-meter'

// Integer micros (millionths of a currency unit) and their GBP conversion. Every rounding goes
// up, so the ledger never understates a cost. Pure: no I/O.

const MICROS_PER_UNIT = 1_000_000n

/**
 * Dollars as a provider reports them (Apify's `usageTotalUsd`, a float) to integer micros,
 * rounded up. Rounding to nano-dollars first removes float noise: 0.0177 is 17 700, not 17 701.
 */
export function unitsToMicros(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError(`Invalid cost ${amount}`)
  return Math.ceil(Math.round(amount * 1e9) / 1000)
}

/** The rate as integer millionths (0.79 is 790 000), the precision of `usd_gbp_rate`. */
export function rateMillionths(usdGbpRate: number): bigint {
  const millionths = Math.round(usdGbpRate * 1e6)
  if (!Number.isFinite(usdGbpRate) || millionths <= 0) {
    throw new RangeError(`USD_GBP_RATE must be positive, got ${usdGbpRate}`)
  }
  return BigInt(millionths)
}

/** The rate stored with a row: 1 for GBP amounts, else USD_GBP_RATE to six decimals. */
export function storedRate(currency: CostMeterCurrency, usdGbpRate: number): string {
  if (currency === 'GBP') return '1.000000'
  const millionths = rateMillionths(usdGbpRate)
  return `${millionths / MICROS_PER_UNIT}.${(millionths % MICROS_PER_UNIT).toString().padStart(6, '0')}`
}

/** GBP micros for an amount, converted with USD_GBP_RATE when it is USD, rounded up. */
export function toGbpMicros(
  micros: number,
  currency: CostMeterCurrency,
  usdGbpRate: number,
): number {
  if (currency === 'GBP') return micros
  const product = BigInt(micros) * rateMillionths(usdGbpRate)
  return Number((product + MICROS_PER_UNIT - 1n) / MICROS_PER_UNIT)
}

/** A model call's cost in USD micros: tokens × the price table, rounded up. */
export function modelCostMicros(usage: CostMeterModelUsage, price: ModelPrice): number {
  const nanos =
    BigInt(usage.inputTokens) * BigInt(price.input) +
    BigInt(usage.outputTokens) * BigInt(price.output) +
    BigInt(usage.cacheWrite5mTokens) * BigInt(price.cacheWrite5m) +
    BigInt(usage.cacheWrite1hTokens) * BigInt(price.cacheWrite1h) +
    BigInt(usage.cacheReadTokens) * BigInt(price.cacheRead)
  return Number((nanos + 999n) / 1000n)
}
