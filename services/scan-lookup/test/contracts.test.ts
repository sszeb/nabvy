import {
  events,
  module,
  ScanLookupBand,
  ScanLookupInput,
  ScanLookupResult,
} from '@nabvy/contracts/modules/scan-lookup'
import { describe, expect, it } from 'vitest'

describe('scan-lookup contracts', () => {
  it('declares its name', () => {
    expect(module).toBe('scan-lookup')
    expect(events.module).toBe('scan-lookup')
  })

  it('parses a well-formed input and refuses a non-UUID scan ID', () => {
    expect(
      ScanLookupInput.safeParse({ scanId: '11111111-1111-4111-8111-111111111111' }).success,
    ).toBe(true)
    expect(ScanLookupInput.safeParse({ scanId: 'not-a-uuid' }).success).toBe(false)
  })

  it('refuses a band below the band minimum (docs/decisions.md:15)', () => {
    const band = {
      source: 'facebook',
      context: 'standalone',
      condition: 'used_good',
      label: 'RTX 3090',
      n: 9,
      median: 25000,
      rangeLow: 23000,
      rangeHigh: 27000,
      currency: 'GBP',
    }
    expect(ScanLookupBand.safeParse(band).success).toBe(false)
    expect(ScanLookupBand.safeParse({ ...band, n: 10 }).success).toBe(true)
  })

  it('a result never carries seller data or a raw price (only bands, sources and credits)', () => {
    const result = ScanLookupResult.parse({
      scanId: '11111111-1111-4111-8111-111111111111',
      catalogueId: 'gpu:rtx3090',
      status: 'not_enough_asks',
      bands: [],
      sources: ['facebook'],
      costCredits: 1,
      latencyMs: 5,
      at: new Date().toISOString(),
    })
    expect(Object.keys(result).sort()).toEqual(
      [
        'at',
        'bands',
        'catalogueId',
        'costCredits',
        'latencyMs',
        'scanId',
        'sources',
        'status',
      ].sort(),
    )
  })

  it('emits no events (rule 7): its output is chargeUsage() calls, not an event (README.md)', () => {
    expect(Object.keys(events.definitions)).toEqual([])
  })
})
