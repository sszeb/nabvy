'use client'

import { MailCheckIcon } from 'lucide-react'
import { useState } from 'react'
import { authClient } from '@/lib/auth-client'
import { TurnstileWidget } from './turnstile-widget'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'

/**
 * Sign-in by magic link (task L1). services/auth's captcha plugin refuses the request with no
 * `x-captcha-response` token, so the form only submits once Turnstile has one. When
 * `siteKey` is null (Turnstile keys are not set in this environment; see
 * `docs/questions/L1-web.md`), the form says so instead of submitting to a request that would
 * fail. Google sign-in is UI only: task 4.0 wires it once `GOOGLE_OAUTH_*` is set.
 */
export function SignInForm({ siteKey }: { siteKey: string | null }) {
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  if (sentTo) {
    return (
      <div role="status" className="grid justify-items-center gap-3 text-center">
        <MailCheckIcon className="size-8 text-primary" aria-hidden />
        <p className="font-medium">Check your email</p>
        <p className="text-muted-foreground text-sm">
          We sent a sign-in link to {sentTo}. The link works once. With no email provider
          configured, the link is printed to the server terminal instead.
        </p>
        <Button variant="link" onClick={() => setSentTo(null)}>
          Use a different email
        </Button>
      </div>
    )
  }
  return (
    <div className="grid gap-5">
      <Button variant="outline" size="lg" className="w-full" disabled>
        <GoogleMark />
        Continue with Google
      </Button>
      <div className="flex items-center gap-3 text-muted-foreground text-xs">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <form
        className="grid gap-3"
        onSubmit={async (event) => {
          event.preventDefault()
          const email = new FormData(event.currentTarget).get('email')
          if (typeof email !== 'string' || !token) return
          setPending(true)
          setError(null)
          const { error: signInError } = await authClient.signIn.magicLink(
            { email, callbackURL: '/app' },
            { headers: { 'x-captcha-response': token } },
          )
          setPending(false)
          if (signInError) {
            setError(signInError.message ?? 'Something went wrong. Try again.')
            return
          }
          setSentTo(email)
        }}
      >
        <Label htmlFor="sign-in-email">Email</Label>
        <Input id="sign-in-email" name="email" type="email" autoComplete="email" required />
        {siteKey ? (
          <TurnstileWidget siteKey={siteKey} onToken={setToken} />
        ) : (
          <p className="text-muted-foreground text-xs">
            Sign-in is not configured in this environment: no Turnstile site key (see
            docs/questions/L1-web.md).
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" disabled={!token || pending}>
          {pending ? 'Sending…' : 'Email me a sign-in link'}
        </Button>
      </form>
    </div>
  )
}

/** A neutral "G" mark: Google's own logo is used only as its brand terms allow (task 4.0). */
function GoogleMark() {
  return (
    <span
      aria-hidden
      className="flex size-5 items-center justify-center rounded-full border border-input font-semibold text-xs"
    >
      G
    </span>
  )
}
