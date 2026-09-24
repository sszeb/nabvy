import type { PostHog } from 'posthog-js'
import { describe, expect, it, vi } from 'vitest'
import { captureProductEvent, shouldLoadPostHogClient } from '../src/posthog/client'

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

describe('captureProductEvent', () => {
  const alertOpened = {
    event: 'alert_opened' as const,
    properties: {
      source: 'facebook',
      channel: 'telegram',
      dealScore: 82,
      freshnessSeconds: 45,
      valuationState: 'valued',
    },
  }

  it('forwards a valid event to the client', () => {
    const capture = vi.fn()
    captureProductEvent({ capture } as unknown as PostHog, alertOpened)
    expect(capture).toHaveBeenCalledWith('alert_opened', alertOpened.properties)
  })

  it('rejects a property outside the allow-list before it reaches the client', () => {
    const capture = vi.fn()
    const withEmail = {
      event: 'alert_opened' as const,
      properties: { ...alertOpened.properties, email: 'buyer@example.com' },
    }
    expect(() => captureProductEvent({ capture } as unknown as PostHog, withEmail)).toThrow()
    expect(capture).not.toHaveBeenCalled()
  })
})
