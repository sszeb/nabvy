'use client'

import { RotateCwIcon } from 'lucide-react'
import { ErrorPage } from '@/components/error-page'
import { Button } from '@/components/ui/button'

/** Any uncaught error below the root layout: a 500 page with "Try again" and a reference. */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorPage
      kind="500"
      reference={error.digest}
      action={
        <Button size="lg" onClick={() => reset()}>
          <RotateCwIcon aria-hidden />
          Try again
        </Button>
      }
    />
  )
}
