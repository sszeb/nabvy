'use client'

import { MailCheckIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'

/** UI only: task 4.0 wires both buttons to Better Auth (magic link and Google). */
export function SignInForm() {
  const [sentTo, setSentTo] = useState<string | null>(null)
  if (sentTo) {
    return (
      <div role="status" className="grid justify-items-center gap-3 text-center">
        <MailCheckIcon className="size-8 text-primary" aria-hidden />
        <p className="font-medium">Check your email</p>
        <p className="text-muted-foreground text-sm">
          We sent a sign-in link to {sentTo}. The link works once.
        </p>
        <Button variant="link" onClick={() => setSentTo(null)}>
          Use a different email
        </Button>
      </div>
    )
  }
  return (
    <div className="grid gap-5">
      <Button variant="outline" size="lg" className="w-full">
        <GoogleMark />
        Continue with Google
      </Button>
      <div className="flex items-center gap-3 text-muted-foreground text-xs">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          const email = new FormData(event.currentTarget).get('email')
          setSentTo(typeof email === 'string' ? email : '')
        }}
      >
        <Label htmlFor="sign-in-email">Email</Label>
        <Input id="sign-in-email" name="email" type="email" autoComplete="email" required />
        <Button type="submit" size="lg" className="w-full">
          Email me a sign-in link
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
