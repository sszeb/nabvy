// Pure logic of the inventory module: date order, profit and event keys. No I/O. Every number in
// here is one the user typed; nothing is estimated (CLAUDE.md, "No invented numbers").
import { type Currency, type Money, subtractMoney } from '@nabvy/contracts'
import type { InventoryError } from '@nabvy/contracts/modules/inventory'

/** The calendar date (`YYYY-MM-DD`, UTC) of a server instant. */
export const dateOf = (now: Date): string => now.toISOString().slice(0, 10)

/**
 * A purchase or sale date the user picked must not be after today (server time) and a sale must
 * not come before its purchase. Dates are ISO `YYYY-MM-DD`, so string order is date order.
 */
export function checkDates(input: {
  boughtAt: string
  soldAt?: string | null
  today: string
}): InventoryError | null {
  if (input.boughtAt > input.today) {
    return { code: 'inventory.date_order', message: 'The purchase date is in the future.' }
  }
  if (input.soldAt != null) {
    if (input.soldAt > input.today) {
      return { code: 'inventory.date_order', message: 'The sale date is in the future.' }
    }
    if (input.soldAt < input.boughtAt) {
      return { code: 'inventory.date_order', message: 'The sale date is before the purchase.' }
    }
  }
  return null
}

/** The sale must be in the item's own currency: amounts are never converted. */
export function checkCurrency(itemCurrency: Currency, sold: Money): InventoryError | null {
  if (sold.currency !== itemCurrency) {
    return {
      code: 'inventory.currency_mismatch',
      message: `The item was bought in ${itemCurrency}; record the sale in ${itemCurrency} too.`,
    }
  }
  return null
}

/** Profit in minor units: what it sold for minus what it cost, both the user's own numbers. */
export const profitMinor = (cost: Money, sold: Money): number =>
  subtractMoney(sold, cost).amountMinor

/**
 * The `inventory.outcome-recorded` event key: the item's ID and the sale as stored (rule 8 of
 * docs/design/modules/_rules.md: natural ID plus its version). Recording the same sale again
 * republishes the same key, which the transport drops; a corrected sale publishes a new one.
 */
export const outcomeKey = (sale: {
  id: string
  soldMinor: number
  currency: string
  soldAt: string
  soldOn: string | null
}): string =>
  `inventory.outcome-recorded:${sale.id}@${sale.soldMinor}${sale.currency}:${sale.soldAt}:${sale.soldOn ?? '-'}`
