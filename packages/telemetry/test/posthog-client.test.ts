import { describe, expect, it } from 'vitest'
import { shouldLoadPostHogClient } from '../src/posthog/client'

describe('shouldLoadPostHogClient', () => {
  it('is false with no key, consent or neither', () => {
    expect(shouldLoadPostHogClient(undefined, false)).toBe(false)
    expect(shouldLoadPostHogClient(undefined, true)).toBe(false)
    expect(shouldLoadPostHogClient('phc_test', false)).toBe(false)
  })

  it('is true only once both the key and consent are present', () => {
    expect(shouldLoadPostHogClient('phc_test', true)).toBe(true)
  })
})
