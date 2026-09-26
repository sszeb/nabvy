'use client'

import Script from 'next/script'
import { useId, useRef, useState } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: { sitekey: string; callback: (token: string) => void },
      ) => string
      remove: (widgetId: string) => void
    }
  }
}

/**
 * The Cloudflare Turnstile widget the sign-in form needs (services/auth's `captcha` plugin
 * refuses `/sign-in/magic-link` and `/sign-in/social` with no `x-captcha-response` token —
 * services/auth/README.md, "Mounting in apps/web"). `siteKey` is not a secret (Cloudflare's own
 * docs: only the secret key must stay server-side), so it is passed down as a prop from a server
 * component that reads it through `@nabvy/config`, rather than read from the environment here.
 */
export function TurnstileWidget({
  siteKey,
  onToken,
}: {
  siteKey: string
  onToken: (token: string) => void
}) {
  const id = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const [rendered, setRendered] = useState(false)
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onReady={() => {
          if (rendered || !containerRef.current || !window.turnstile) return
          window.turnstile.render(containerRef.current, { sitekey: siteKey, callback: onToken })
          setRendered(true)
        }}
      />
      <div ref={containerRef} id={`turnstile-${id}`} />
    </>
  )
}
