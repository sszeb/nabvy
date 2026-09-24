import { ScanLineIcon } from 'lucide-react'
import type { Metadata } from 'next'
import { PageHeader } from '@/components/page-header'
import { Skeleton } from '@/components/ui/skeleton'

export const metadata: Metadata = { title: 'Scan' }

/**
 * A skeleton only: the scope of scan mode awaits the owner (single source, no per-user Facebook
 * fetches). It shows the layout: camera frame, progress list, result card.
 */
export default function ScanPage() {
  return (
    <>
      <PageHeader title="Scan" description="Not available yet." />
      <div className="grid gap-6 md:grid-cols-2" aria-hidden data-testid="scan-skeleton">
        <div className="flex aspect-[3/4] items-center justify-center rounded-2xl border border-dashed bg-placeholder text-placeholder-foreground">
          <ScanLineIcon className="size-10" />
        </div>
        <div className="grid content-start gap-4">
          <div className="grid gap-3 rounded-2xl border bg-card p-5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-5/6" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
          <div className="grid gap-3 rounded-2xl border bg-card p-5">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-2 w-full rounded-full" />
            <Skeleton className="h-3.5 w-3/4" />
          </div>
        </div>
      </div>
    </>
  )
}
