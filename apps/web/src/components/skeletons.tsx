import { Skeleton } from './ui/skeleton'

export function DealCardSkeleton() {
  return (
    <div className="grid gap-4 rounded-2xl border bg-card p-4 sm:grid-cols-[10rem_1fr]">
      <Skeleton className="hidden aspect-[4/3] rounded-xl sm:block" />
      <div className="grid gap-3">
        <div className="flex justify-between gap-4">
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-7 w-16" />
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
        <Skeleton className="h-3 w-56" />
      </div>
    </div>
  )
}

export function ListingCardSkeleton() {
  return (
    <div className="grid gap-3 rounded-2xl border bg-card p-3">
      <Skeleton className="aspect-[4/3] rounded-xl" />
      <Skeleton className="h-6 w-20" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  )
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-xl border">
      <Skeleton className="h-10 rounded-none" />
      {Array.from({ length: rows }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
        <div key={index} className="flex gap-4 px-3 py-3">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  )
}

/** A whole-page loading state, used by the route loading.tsx files. */
export function PageSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true">
      <span className="sr-only" role="status">
        Loading
      </span>
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4">
        <DealCardSkeleton />
        <DealCardSkeleton />
        <DealCardSkeleton />
      </div>
    </div>
  )
}
