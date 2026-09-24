import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ErrorPage } from '@/components/error-page'
import { errorPages, isErrorKind, staticErrorKinds } from '@/lib/errors'

/**
 * A static page per error (/errors/400 … /errors/504; /errors/restricted has its own route). The CDN, the proxy
 * and route handlers rewrite to these when Next's own boundaries do not apply (for example a 429
 * from the rate limiter or a 503 during maintenance); they are also the design reference.
 */
export const dynamicParams = false

export function generateStaticParams() {
  return staticErrorKinds.map((code) => ({ code }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>
}): Promise<Metadata> {
  const { code } = await params
  return {
    title: isErrorKind(code) ? errorPages[code].title : 'Error',
    robots: { index: false },
  }
}

export default async function ErrorCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  if (!isErrorKind(code) || code === 'restricted') notFound()
  return <ErrorPage kind={code} />
}
