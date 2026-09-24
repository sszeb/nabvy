import { PostHog } from 'posthog-node'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPostHogServer } from '../src/posthog/server'

const alertDelivered = {
  event: 'alert_delivered' as const,
  properties: {
    source: 'facebook',
    channel: 'telegram',
    dealScore: 82,
    freshnessSeconds: 45,
    valuationState: 'valued',
  },
}

const withKeys = { POSTHOG_KEY: 'phc_test', POSTHOG_HOST: 'https://eu.i.posthog.com' }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createPostHogServer', () => {
  it('does nothing and makes no client when POSTHOG_KEY is absent', async () => {
    const constructed = vi.spyOn(PostHog.prototype, 'capture')
    const server = createPostHogServer({})
    expect(server.enabled).toBe(false)
    await server.capture('user-1', true, alertDelivered)
    await expect(server.isFeatureEnabled('flag', 'user-1', true)).resolves.toBeUndefined()
    expect(constructed).not.toHaveBeenCalled()
  })

  it('does not capture without consent', async () => {
    const capture = vi.spyOn(PostHog.prototype, 'capture').mockImplementation(() => {})
    const server = createPostHogServer(withKeys)
    expect(server.enabled).toBe(true)
    await server.capture('user-1', false, alertDelivered)
    expect(capture).not.toHaveBeenCalled()
    await server.shutdown()
  })

  it('captures with consent, forwarding the validated event and properties', async () => {
    const capture = vi.spyOn(PostHog.prototype, 'capture').mockImplementation(() => {})
    const server = createPostHogServer(withKeys)
    await server.capture('user-1', true, alertDelivered)
    expect(capture).toHaveBeenCalledWith({
      distinctId: 'user-1',
      event: 'alert_delivered',
      properties: alertDelivered.properties,
    })
    await server.shutdown()
  })

  it('rejects an event carrying a property outside the allow-list, and never captures it', async () => {
    const capture = vi.spyOn(PostHog.prototype, 'capture').mockImplementation(() => {})
    const server = createPostHogServer(withKeys)
    const withEmail = {
      event: 'alert_delivered' as const,
      properties: { ...alertDelivered.properties, email: 'buyer@example.com' },
    }
    await expect(server.capture('user-1', true, withEmail)).rejects.toThrow()
    expect(capture).not.toHaveBeenCalled()
    await server.shutdown()
  })

  it('does not check a feature flag without consent', async () => {
    const isFeatureEnabled = vi.spyOn(PostHog.prototype, 'isFeatureEnabled')
    const server = createPostHogServer(withKeys)
    await expect(
      server.isFeatureEnabled('pricing-page-v2', 'user-1', false),
    ).resolves.toBeUndefined()
    expect(isFeatureEnabled).not.toHaveBeenCalled()
    await server.shutdown()
  })

  it('checks a feature flag with consent', async () => {
    const isFeatureEnabled = vi.spyOn(PostHog.prototype, 'isFeatureEnabled').mockResolvedValue(true)
    const server = createPostHogServer(withKeys)
    await expect(server.isFeatureEnabled('pricing-page-v2', 'user-1', true)).resolves.toBe(true)
    expect(isFeatureEnabled).toHaveBeenCalledWith('pricing-page-v2', 'user-1')
    await server.shutdown()
  })
})
