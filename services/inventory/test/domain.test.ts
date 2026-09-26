import { money } from '@nabvy/contracts'
import { describe, expect, it } from 'vitest'
import { checkCurrency, checkDates, dateOf, outcomeKey, profitMinor } from '../src/domain'

describe('dates', () => {
  it('a purchase today or earlier is fine; a purchase tomorrow is refused', () => {
    expect(checkDates({ boughtAt: '2026-09-25', today: '2026-09-25' })).toBeNull()
    expect(checkDates({ boughtAt: '2026-09-24', today: '2026-09-25' })).toBeNull()
    expect(checkDates({ boughtAt: '2026-09-26', today: '2026-09-25' })?.code).toBe(
      'inventory.date_order',
    )
  })

  it('a sale on the purchase day is fine; the day before, or tomorrow, is refused', () => {
    const base = { boughtAt: '2026-09-20', today: '2026-09-25' }
    expect(checkDates({ ...base, soldAt: '2026-09-20' })).toBeNull()
    expect(checkDates({ ...base, soldAt: '2026-09-25' })).toBeNull()
    expect(checkDates({ ...base, soldAt: '2026-09-19' })?.code).toBe('inventory.date_order')
    expect(checkDates({ ...base, soldAt: '2026-09-26' })?.code).toBe('inventory.date_order')
  })

  it('dateOf is the UTC calendar date', () => {
    expect(dateOf(new Date('2026-09-25T23:59:59.999Z'))).toBe('2026-09-25')
    expect(dateOf(new Date('2026-09-26T00:00:00.000Z'))).toBe('2026-09-26')
  })
})

describe('money', () => {
  it('a sale in another currency is refused, never converted', () => {
    expect(checkCurrency('GBP', money(100, 'GBP'))).toBeNull()
    expect(checkCurrency('GBP', money(100, 'EUR'))?.code).toBe('inventory.currency_mismatch')
  })

  it('profit is sold minus cost, and may be a loss', () => {
    expect(profitMinor(money(12000, 'GBP'), money(15000, 'GBP'))).toBe(3000)
    expect(profitMinor(money(12000, 'GBP'), money(9000, 'GBP'))).toBe(-3000)
    expect(profitMinor(money(0, 'GBP'), money(0, 'GBP'))).toBe(0)
  })
})

describe('event key', () => {
  it('is the item ID plus the sale as stored, so a correction changes it', () => {
    const sale = {
      id: '0190f1d2-0000-7000-8000-000000000001',
      soldMinor: 15000,
      currency: 'GBP',
      soldAt: '2026-09-25',
      soldOn: null,
    }
    expect(outcomeKey(sale)).toBe(
      'inventory.outcome-recorded:0190f1d2-0000-7000-8000-000000000001@15000GBP:2026-09-25:-',
    )
    expect(outcomeKey({ ...sale, soldOn: 'ebay' })).not.toBe(outcomeKey(sale))
    expect(outcomeKey({ ...sale, soldMinor: 15001 })).not.toBe(outcomeKey(sale))
  })
})
