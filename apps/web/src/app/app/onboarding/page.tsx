import type { Metadata } from 'next'
import Link from 'next/link'
import { OnboardingFlow } from '@/components/onboarding-flow'
import { ThemeToggle } from '@/components/theme-toggle'
import { Wordmark } from '@/components/wordmark'
import { listExampleDeals } from '@/data'

export const metadata: Metadata = { title: 'Get started' }

export default async function OnboardingPage() {
  const { deals } = await listExampleDeals()
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
        <Link href="/" aria-label="Nabvy home">
          <Wordmark />
        </Link>
        <ThemeToggle />
      </header>
      <main id="main" className="mx-auto max-w-xl px-4 pt-6 pb-16">
        <OnboardingFlow examples={deals.slice(0, 3)} />
      </main>
    </div>
  )
}
