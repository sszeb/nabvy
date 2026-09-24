import type * as React from 'react'
import { AppShell } from '@/components/app-shell'
import { listDeals } from '@/data'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const deals = await listDeals()
  return (
    <AppShell
      nav="app"
      deals={deals.slice(0, 5).map((deal) => ({
        id: deal.id,
        title: deal.listing.title,
        town: deal.listing.town,
      }))}
    >
      {children}
    </AppShell>
  )
}
