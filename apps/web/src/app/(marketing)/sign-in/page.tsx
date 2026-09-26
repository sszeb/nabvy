import { safeLoadEnv } from '@nabvy/config'
import type { Metadata } from 'next'
import Link from 'next/link'
import { SignInForm } from '@/components/sign-in-form'

export const metadata: Metadata = { title: 'Sign in' }

export default function SignInPage() {
  // Not a secret (Cloudflare's Turnstile docs: only the secret key must stay server-side), but
  // still read only through @nabvy/config, never the environment directly, per CLAUDE.md.
  const captcha = safeLoadEnv(['captcha'])
  const siteKey = captcha.success ? captcha.data.TURNSTILE_SITE_KEY : null
  return (
    <div className="mx-auto grid max-w-sm gap-8 px-4 py-16 sm:px-6">
      <div className="grid gap-2 text-center">
        <h1 className="font-semibold text-3xl tracking-tight">Sign in to Nabvy</h1>
        <p className="text-muted-foreground text-sm">No password needed.</p>
      </div>
      <SignInForm siteKey={siteKey} />
      <p className="text-center text-muted-foreground text-xs">
        New here?{' '}
        <Link href="/waitlist" className="text-link underline underline-offset-4">
          Join the waitlist
        </Link>
      </p>
    </div>
  )
}
