import { SearchXIcon } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { DealCard } from '@/components/deal-card'
import { EmptyState } from '@/components/empty-state'
import { EstimatesNote } from '@/components/estimates-note'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect } from '@/components/ui/input'
import { listDeals, listHunts } from '@/data'

export const metadata: Metadata = { title: 'Deals' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

export default async function DealsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const q = one(params.q)
  const huntId = one(params.hunt)
  const lowAsksOnly = one(params.low) === '1'
  const [deals, hunts] = await Promise.all([listDeals({ q, huntId, lowAsksOnly }), listHunts()])
  const filtered = Boolean(q || huntId || lowAsksOnly)
  return (
    <>
      <PageHeader title="Deals" description={<EstimatesNote className="text-sm" />} />
      <form
        className="mb-6 grid gap-3 rounded-2xl border bg-surface p-3 sm:grid-cols-[1fr_14rem_auto_auto] sm:items-center"
        aria-label="Filter deals"
      >
        <label className="sr-only" htmlFor="deal-q">
          Search
        </label>
        <Input
          id="deal-q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search titles and facts"
        />
        <label className="sr-only" htmlFor="deal-hunt">
          Hunt
        </label>
        <NativeSelect id="deal-hunt" name="hunt" defaultValue={huntId ?? ''}>
          <option value="">All hunts</option>
          {hunts.map((hunt) => (
            <option key={hunt.id} value={hunt.id}>
              {hunt.name}
            </option>
          ))}
        </NativeSelect>
        <label className="flex items-center gap-2 px-1 text-sm">
          <input
            type="checkbox"
            name="low"
            value="1"
            defaultChecked={lowAsksOnly}
            className="size-4 accent-[var(--primary)]"
          />
          Lowest quarter of asks
        </label>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </form>
      {deals.length === 0 ? (
        <EmptyState
          icon={SearchXIcon}
          title="No deals match"
          description="Try fewer words, or another hunt. New listings arrive through the day."
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
            {filtered ? ' match' : ', newest first'}
          </p>
          {deals.map((deal) => (
            <DealCard key={deal.id} deal={deal} />
          ))}
        </div>
      )}
    </>
  )
}
