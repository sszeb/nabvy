import { describe, expect, it } from 'vitest'
import {
  checkShape,
  collectedKey,
  gatewayOpen,
  refusalMessage,
  runKindOfInput,
  settledKey,
  usdToMicros,
} from '../src/domain'

describe('gatewayOpen', () => {
  const on = { module: 'on', apify: 'on', pipeline: 'on', costMeter: 'on' } as const
  it('opens only with the module on or in shadow, and apify and pipeline on', () => {
    expect(gatewayOpen(on)).toBe(true)
    expect(gatewayOpen({ ...on, module: 'shadow' })).toBe(true)
    expect(gatewayOpen({ ...on, module: 'off' })).toBe(false)
    expect(gatewayOpen({ ...on, apify: 'off' })).toBe(false)
    expect(gatewayOpen({ ...on, pipeline: 'off' })).toBe(false)
  })
  it('does not depend on the cost meter (submitRun checks it; the watcher defers metering)', () => {
    expect(gatewayOpen({ ...on, costMeter: 'off' })).toBe(true)
  })
})

describe('run kind and shape', () => {
  it('reads searches or IDs, never both or neither', () => {
    expect(runKindOfInput({ searchTerms: ['gaming pc'] })).toBe('search')
    expect(runKindOfInput({ listingIds: ['28242423458759790'] })).toBe('details')
    expect(runKindOfInput({ searchTerms: ['a'], listingIds: ['1'] })).toBeNull()
    expect(runKindOfInput({ searchTerms: [], listingIds: [] })).toBeNull()
    expect(runKindOfInput({ searchTerms: 'gaming pc' })).toBeNull()
  })
  it('refuses an input that does not fetch what its shape says', () => {
    expect(checkShape('newest-check', { searchTerms: ['a'] })).toEqual({
      ok: true,
      value: 'search',
    })
    expect(checkShape('details-text', { listingIds: ['1'] })).toEqual({
      ok: true,
      value: 'details',
    })
    const wrong = checkShape('details-photo', { searchTerms: ['a'] })
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) expect(wrong.error.code).toBe('apify-gateway.shape_mismatch')
  })
})

describe('usdToMicros', () => {
  it('converts numeric(10, 4) text exactly', () => {
    expect(usdToMicros('0.0000')).toBe(0)
    expect(usdToMicros('0.0177')).toBe(17_700)
    expect(usdToMicros('0.3363')).toBe(336_300)
    expect(usdToMicros('5.2928')).toBe(5_292_800)
    expect(usdToMicros('150.0000')).toBe(150_000_000)
    expect(usdToMicros('7')).toBe(7_000_000)
  })
  it('refuses anything else', () => {
    for (const bad of ['', '-1.0000', '1e3', '0.0000001', 'abc']) {
      expect(() => usdToMicros(bad), bad).toThrow(RangeError)
    }
  })
})

describe('keys and messages', () => {
  it('keys each announcement by its job', () => {
    expect(collectedKey(6)).toBe('apify-gateway.run-collected:6')
    expect(settledKey(6)).toBe('apify-gateway.run-settled:6')
  })
  it("reports Postgres's own message, unwrapped from the driver's", () => {
    const pg = new Error('input.useDetailCache must be false')
    expect(refusalMessage(new Error('Failed query: select …', { cause: pg }))).toBe(
      'input.useDetailCache must be false',
    )
    expect(refusalMessage('x'.repeat(900))).toHaveLength(500)
  })
})
