import posthog, { type PostHog } from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

/** Pulled out of the effect below so the consent gate is testable without a DOM renderer. */
export function shouldLoadPostHogClient(posthogKey: string | undefined, consent: boolean): boolean {
  return Boolean(posthogKey) && consent
}

export interface PostHogClientProviderProps {
  /**
   * The PostHog project key, read server-side by `@nabvy/config` and passed down through a
   * server component -- never a `NEXT_PUBLIC_` variable (design section 5, "Browser key").
   * `undefined` when the key is not configured.
   */
  posthogKey: string | undefined
  /** Analytics consent for this visitor (docs/analytics.md:8). */
  consent: boolean
  children?: ReactNode
}

/**
 * Loads `posthog-js` only once both `posthogKey` and `consent` are present, through the app's
 * own `/ingest` rewrite to `eu.i.posthog.com` (design section 5) so ad blockers do not drop
 * events. Renders `children` unchanged, with no PostHog context and no script load, until then:
 * a page with no key or no consent makes no network call.
 */
export function PostHogClientProvider({
  posthogKey,
  consent,
  children,
}: PostHogClientProviderProps) {
  const clientRef = useRef<PostHog | null>(null)
  const [client, setClient] = useState<PostHog | null>(null)

  useEffect(() => {
    if (clientRef.current || !shouldLoadPostHogClient(posthogKey, consent) || !posthogKey) return
    posthog.init(posthogKey, {
      api_host: '/ingest',
      // EU cloud is reached only through the app's own rewrite; posthog-js never talks to it
      // directly from the browser (docs/analytics.md:34).
      ui_host: 'https://eu.posthog.com',
      person_profiles: 'identified_only',
      capture_pageview: false,
      // Session replay is masked by default (design section 5); listing text is masked by CSS
      // class where the deal card and scan screen apply it (docs/analytics.md:36).
      session_recording: { maskAllInputs: true },
    })
    clientRef.current = posthog
    setClient(posthog)
  }, [posthogKey, consent])

  if (!client) return children
  return <PostHogProvider client={client}>{children}</PostHogProvider>
}
