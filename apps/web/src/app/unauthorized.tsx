import type { Metadata } from 'next'
import { ErrorPage } from '@/components/error-page'

// Rendered when a server component calls unauthorized() (401), e.g. after requireUser fails.
export const metadata: Metadata = { title: 'Sign in', robots: { index: false } }

export default function Unauthorized() {
  return <ErrorPage kind="401" />
}
