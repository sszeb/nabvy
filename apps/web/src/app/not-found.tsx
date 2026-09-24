import { CompassIcon } from 'lucide-react'
import Link from 'next/link'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <main id="main" className="mx-auto grid min-h-dvh max-w-lg place-items-center px-4">
      <EmptyState
        icon={CompassIcon}
        title="Page not found"
        description="The link may be old, or the listing may have been removed."
        action={
          <Button asChild>
            <Link href="/app">Go to your dashboard</Link>
          </Button>
        }
        className="w-full"
      />
    </main>
  )
}
