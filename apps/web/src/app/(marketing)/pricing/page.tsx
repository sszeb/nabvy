import type { Metadata } from 'next'
import { Skeleton } from '@/components/ui/skeleton'

export const metadata: Metadata = { title: 'Pricing' }

/**
 * A structural skeleton only. Plans, prices and tier wording are the owner's decision and are
 * not shown until it is made (docs/questions.md).
 */
export default function PricingPage() {
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6">
      <div className="grid max-w-2xl gap-2">
        <h1 className="font-semibold text-3xl tracking-tight">Pricing</h1>
        <p className="text-muted-foreground">Plans and prices are to be confirmed.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3" aria-hidden data-testid="pricing-skeleton">
        {['a', 'b', 'c'].map((key) => (
          <div key={key} className="grid gap-4 rounded-2xl border bg-card p-6">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-9 w-32" />
            <div className="grid gap-2.5">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-5/6" />
              <Skeleton className="h-3.5 w-4/6" />
              <Skeleton className="h-3.5 w-5/6" />
            </div>
            <Skeleton className="mt-2 h-10 w-full rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
