import { SearchXIcon } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { DealCard } from '@/components/deal-card'
import { EmptyState } from '@/components/empty-state'
import { EstimatesNote } from '@/components/estimates-note'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { listDeals } from '@/data'

export const metadata: Metadata = { title: 'Deals' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

/**
 * The results feed (task L1): listing-card plus pickup-location, newest first. There is no
 * `spec-match` module yet, so filtering by hunt and by asking-price position is not offered —
 * neither exists to filter on (docs/questions/L1-web.md). Title search stays.
 */
export default async function DealsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const q = one(params.q)
  const deals = await listDeals({ q })
  return (
    <>
      <PageHeader title="Deals" description={<EstimatesNote className="text-sm" />} />
      <form className="mb-6 flex gap-3" aria-label="Filter deals">
        <label className="sr-only" htmlFor="deal-q">
          Search
        </label>
        <Input id="deal-q" name="q" type="search" defaultValue={q} placeholder="Search titles" />
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </form>
      {deals.length === 0 ? (
        <EmptyState
          icon={SearchXIcon}
          title="No deals match"
          description="Try fewer words. New listings arrive through the day."
          action={
            <Button variant="outline" asChild>
              <Link href="/app/deals">Clear filters</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3">
          <p className="text-muted-foreground text-sm" role="status">
            {deals.length} {deals.length === 1 ? 'deal' : 'deals'}
            {q ? ' match' : ', newest first'}
          </p>
          {deals.map((deal) => (
            <DealCard key={deal.id} deal={deal} />
          ))}
        </div>
      )}
    </>
  )
}
