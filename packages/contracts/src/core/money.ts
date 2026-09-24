import { z } from 'zod'

/**
 * Currencies Nabvy prices in. UK asks are GBP; Irish asks form their own EUR groups and are never
 * converted into GBP ones (docs/decisions.md, Precedence, "Region and currency").
 */
export const Currency = z.enum(['GBP', 'EUR'])
export type Currency = z.infer<typeof Currency>

/** Integer minor units (pence or cents); safe-integer range so it survives JSON and JavaScript. */
export const AmountMinor = z.int()
export type AmountMinor = z.infer<typeof AmountMinor>

/** An amount with its currency. Never a bare number: GBP and EUR are kept apart. */
export const Money = z.strictObject({ amountMinor: AmountMinor, currency: Currency })
export type Money<C extends Currency = Currency> = { amountMinor: number; currency: C }

/** A schema for money in one currency only, for groups that must not mix. */
export function moneyIn<const C extends Currency>(currency: C) {
  return z.strictObject({ amountMinor: AmountMinor, currency: z.literal(currency) })
}

export class CurrencyMismatchError extends Error {
  constructor(a: Currency, b: Currency) {
    super(`Cannot combine ${a} with ${b}: currencies are kept apart, never converted`)
    this.name = 'CurrencyMismatchError'
  }
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency)
}

function checked(amountMinor: number): number {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError(`Money amount ${amountMinor} is not a safe integer of minor units`)
  }
  return amountMinor
}

export function money<C extends Currency>(amountMinor: number, currency: C): Money<C> {
  return { amountMinor: checked(amountMinor), currency }
}

/** Adds amounts of one currency. Throws `CurrencyMismatchError` if they differ at runtime. */
export function addMoney<C extends Currency>(a: Money<C>, b: Money<C>): Money<C> {
  assertSameCurrency(a, b)
  return money(a.amountMinor + b.amountMinor, a.currency)
}

export function subtractMoney<C extends Currency>(a: Money<C>, b: Money<C>): Money<C> {
  assertSameCurrency(a, b)
  return money(a.amountMinor - b.amountMinor, a.currency)
}

/** Negative when a < b, zero when equal, positive when a > b. Throws across currencies. */
export function compareMoney<C extends Currency>(a: Money<C>, b: Money<C>): number {
  assertSameCurrency(a, b)
  return a.amountMinor - b.amountMinor
}
