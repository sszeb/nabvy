import type { Metadata } from 'next'
import { ErrorPage } from '@/components/error-page'

export const metadata: Metadata = { title: 'Page not found', robots: { index: false } }

export default function NotFound() {
  return <ErrorPage kind="404" />
}
