import type * as React from 'react'
import { AppShell } from '@/components/app-shell'

/** The admin shell. Role checks arrive with task 4.0; until then it renders fixtures only. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell nav="admin" deals={[]} badge="Admin">
      {children}
    </AppShell>
  )
}
