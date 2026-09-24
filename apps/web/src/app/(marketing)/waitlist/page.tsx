import type { Metadata } from 'next'
import { WaitlistForm } from '@/components/waitlist-form'

export const metadata: Metadata = { title: 'Waitlist' }

export default function WaitlistPage() {
  return (
    <div className="mx-auto grid max-w-lg gap-6 px-4 py-14 sm:px-6">
      <div className="grid gap-2">
        <h1 className="font-semibold text-3xl tracking-tight">Join the waitlist</h1>
        <p className="text-muted-foreground">
          Nabvy is opening area by area. Tell us where you are and what you look for, and we will
          let you know when your area is covered.
        </p>
      </div>
      <WaitlistForm />
    </div>
  )
}
