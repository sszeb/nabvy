'use client'

import { RotateCwIcon } from 'lucide-react'
import { ErrorPage } from '@/components/error-page'
import { ThemeProvider } from '@/components/theme-provider'
import { Button } from '@/components/ui/button'
import './globals.css'

/** An error in the root layout itself: it replaces the whole document, so it brings its own. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <title>Something broke · Nabvy</title>
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
        </ThemeProvider>
      </body>
    </html>
  )
}
