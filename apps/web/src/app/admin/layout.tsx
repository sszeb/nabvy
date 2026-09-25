import type { Metadata } from 'next'
import type * as React from 'react'
import { AppShell } from '@/components/app-shell'
import { requireAdmin } from '@/lib/admin-gate'

// Admin pages are never indexed, whatever the gate answers.
export const metadata: Metadata = { robots: { index: false, follow: false } }

/**
 * The admin shell. The gate runs here and again in every admin page: Next renders a layout and
 * its page independently, so a layout alone guards nothing (docs/design/admin-hardening.md, A1).
 * The navigation is chosen by this server layout, never by a client-side session (A12).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  return (
    <AppShell nav="admin" deals={[]} badge="Admin">
      {children}
    </AppShell>
  )
}
