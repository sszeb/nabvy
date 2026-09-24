import type { Metadata } from 'next'
import Link from 'next/link'
import { SignInForm } from '@/components/sign-in-form'

export const metadata: Metadata = { title: 'Sign in' }

export default function SignInPage() {
  return (
    <div className="mx-auto grid max-w-sm gap-8 px-4 py-16 sm:px-6">
      <div className="grid gap-2 text-center">
        <h1 className="font-semibold text-3xl tracking-tight">Sign in to Nabvy</h1>
        <p className="text-muted-foreground text-sm">No password needed.</p>
      </div>
      <SignInForm />
      <p className="text-center text-muted-foreground text-xs">
        New here?{' '}
        <Link href="/waitlist" className="text-link underline underline-offset-4">
          Join the waitlist
        </Link>
      </p>
    </div>
  )
}
