/**
 * Forwards one tracked event to PostHog, once `track()` knows whether the user has consented.
 * Matches `@nabvy/telemetry`'s `createPostHogServer().capture(userId, hasConsent, event)`
 * structurally, so the real client can be passed in as `ctx.forwarder` without an adapter; this
 * module does not import `@nabvy/telemetry` itself (module card, "Depends on": switches, account
 * only) -- the web app or a task wires the real client in (services/product-events/README.md,
 * "Decisions").
 */
export interface ProductEventsForwarder {
  capture(
    userId: string,
    hasConsent: boolean,
    event: { event: string; properties: Record<string, unknown> },
  ): Promise<void>
}

/** Forwards nothing. `track()`'s default until a caller wires a real client in. */
export class NoopProductEventsForwarder implements ProductEventsForwarder {
  async capture(): Promise<void> {}
}

/** Records what it was asked to forward, for tests. */
export class InMemoryProductEventsForwarder implements ProductEventsForwarder {
  readonly captured: Array<{
    userId: string
    hasConsent: boolean
    event: string
    properties: Record<string, unknown>
  }> = []

  async capture(
    userId: string,
    hasConsent: boolean,
    event: { event: string; properties: Record<string, unknown> },
  ): Promise<void> {
    this.captured.push({ userId, hasConsent, event: event.event, properties: event.properties })
  }
}
