import { describe, expect, it } from 'vitest'
import { APIFY_SETTLE_DELAY_MS, MODEL_PRICES_NANO_USD } from '../../src/modules/cost-meter'

describe('modules/cost-meter', () => {
  it('keeps the settle delay at 10 minutes', () => {
    expect(APIFY_SETTLE_DELAY_MS).toBe(10 * 60 * 1000)
  })

  it('prices every model cost-meter must be able to bill', () => {
    expect(MODEL_PRICES_NANO_USD['claude-haiku-4-5-20251001']).toEqual({
      input: 1000,
      output: 5000,
      cacheWrite5m: 1250,
      cacheWrite1h: 2000,
      cacheRead: 100,
    })
    expect(MODEL_PRICES_NANO_USD['claude-sonnet-5']).toEqual({
      input: 2000,
      output: 10000,
      cacheWrite5m: 2500,
      cacheWrite1h: 4000,
      cacheRead: 200,
    })
    expect(MODEL_PRICES_NANO_USD.unknown).toBeUndefined()
  })
})
