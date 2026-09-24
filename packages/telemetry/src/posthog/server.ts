import { type EnvSource, safeLoadEnv } from '@nabvy/config'
import { ProductEventsEvent } from '@nabvy/contracts/modules/product-events'
import { PostHog } from 'posthog-node'

/**
 * Server-side capture and flag evaluation. `capture()` checks consent before every event and
 * validates it against `ProductEventsEvent` (docs/analytics.md:13,34; the property allow-list,
 * design section 5). Without `POSTHOG_KEY`/`POSTHOG_HOST`, `createPostHogServer()` returns the
 * no-op below: no client is built, so nothing is captured and no network call is made.
 */
export interface PostHogServer {
  readonly enabled: boolean
  /** Records a product event for `userId`, forwarded to PostHog only if `hasConsent`. */
  capture(userId: string, hasConsent: boolean, event: ProductEventsEvent): Promise<void>
  /** `undefined` when the flag is unknown or the client is disabled. */
  isFeatureEnabled(flagKey: string, userId: string): Promise<boolean | undefined>
  shutdown(): Promise<void>
}

const noopPostHogServer: PostHogServer = {
  enabled: false,
  async capture() {},
  async isFeatureEnabled() {
    return undefined
  },
  async shutdown() {},
}

export function createPostHogServer(source?: EnvSource): PostHogServer {
  const parsed = safeLoadEnv(['posthog'], source)
  if (!parsed.success) return noopPostHogServer

  const client = new PostHog(parsed.data.POSTHOG_KEY, { host: parsed.data.POSTHOG_HOST })

  return {
    enabled: true,
    async capture(userId, hasConsent, event) {
      if (!hasConsent) return
      // Re-validated at the boundary: a caller's object may not have gone through the schema.
      const validated = ProductEventsEvent.parse(event)
      client.capture({
        distinctId: userId,
        event: validated.event,
        properties: validated.properties,
      })
    },
    async isFeatureEnabled(flagKey, userId) {
      return client.isFeatureEnabled(flagKey, userId)
    },
    async shutdown() {
      await client.shutdown()
    },
  }
}
