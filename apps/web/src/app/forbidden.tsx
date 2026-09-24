import type { Metadata } from 'next'
import { ErrorPage } from '@/components/error-page'

// Rendered when a server component or procedure calls forbidden() (403). The account-restricted
// notice has its own page, /errors/restricted, so this one never hints at a restriction.
export const metadata: Metadata = { title: 'No access', robots: { index: false } }

export default function Forbidden() {
  return <ErrorPage kind="403" />
}
