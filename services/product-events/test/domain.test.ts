import { describe, expect, it } from 'vitest'
import { isRecording, planTrack } from '../src/domain'

describe('isRecording', () => {
  it('is false only while the switch is off', () => {
    expect(isRecording({ state: 'off' })).toBe(false)
    expect(isRecording({ state: 'shadow' })).toBe(true)
    expect(isRecording({ state: 'on' })).toBe(true)
  })
})

describe('planTrack', () => {
  it('accepts a known event with exactly its declared properties', () => {
    const planned = planTrack({
      event: 'hunt_created',
      properties: { pack: 'gpu-pc', radius: 40, minDealScore: 70 },
    })
    expect(planned.ok).toBe(true)
    if (planned.ok) {
      expect(planned.value).toEqual({
        event: 'hunt_created',
        properties: { pack: 'gpu-pc', radius: 40, minDealScore: 70 },
      })
    }
  })

  it('refuses an event name docs/analytics.md does not list', () => {
    const planned = planTrack({ event: 'listing_viewed', properties: {} })
    expect(planned.ok).toBe(false)
    if (!planned.ok) expect(planned.error.code).toBe('product-events.invalid_input')
  })

  it('refuses a property no event declares, allowlist not denylist', () => {
    const planned = planTrack({
      event: 'onboarding_completed',
      properties: { pack: 'gpu-pc', radius: 40, channel: 'telegram', postcode: 'PO19 1SY' },
    })
    expect(planned.ok).toBe(false)
    if (!planned.ok) expect(planned.error.code).toBe('product-events.invalid_input')
  })

  it('refuses a known event missing a required property', () => {
    const planned = planTrack({ event: 'hunt_created', properties: { pack: 'gpu-pc' } })
    expect(planned.ok).toBe(false)
  })
})
