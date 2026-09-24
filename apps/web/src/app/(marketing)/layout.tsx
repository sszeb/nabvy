import type * as React from 'react'
import { MarketingFooter, MarketingHeader } from '@/components/marketing-chrome'

/** The layout for nabvy.com pages: landing, pricing, waitlist and sign-in. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <MarketingHeader />
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      <MarketingFooter />
    </div>
  )
}
