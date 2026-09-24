import { ArrowRightIcon } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { DealCard } from '@/components/deal-card'
import { EstimatesNote } from '@/components/estimates-note'
import { HomeSearch } from '@/components/home-search'
import { HuntCard } from '@/components/hunt-card'
import { Button } from '@/components/ui/button'
import { getDashboardSummary, listDeals, listHunts } from '@/data'

export const metadata: Metadata = { title: 'Home' }

export default async function DashboardPage() {
  const [summary, deals, hunts] = await Promise.all([
    getDashboardSummary(),
    listDeals(),
    listHunts(),
  ])
  const stats = [
    { label: 'Alerts today', value: String(summary.alertsToday) },
    { label: 'Active hunts', value: String(summary.activeHunts) },
    {
      label: 'Median listed to delivered, today',
      value: `${summary.medianListedToDeliveredMinutes} min`,
    },
  ]
  return (
    <div className="grid gap-12">
      <section className="grid gap-6 pt-4 text-center sm:pt-10">
        <h1 className="font-semibold text-2xl tracking-tight sm:text-3xl">
          What are you looking for
        </h1>
        <HomeSearch hunts={hunts} />
      </section>

      <section aria-labelledby="today" className="grid gap-3">
        <h2 id="today" className="sr-only">
          Today
        </h2>
        <dl className="grid grid-cols-3 gap-3">
          {stats.map((stat) => (
            <div key={stat.label} className="grid gap-1 rounded-2xl border bg-card p-4">
              <dt className="text-muted-foreground text-xs">{stat.label}</dt>
              <dd className="font-semibold text-xl tabular">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="latest" className="grid gap-4">
        <div className="flex items-end justify-between gap-3">
          <div className="grid gap-1">
            <h2 id="latest" className="font-semibold text-lg">
              Latest deals
            </h2>
            <EstimatesNote />
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/app/deals">
              All deals
              <ArrowRightIcon aria-hidden />
            </Link>
          </Button>
        </div>
        <div className="grid gap-3">
          {deals.slice(0, 4).map((deal) => (
            <DealCard key={deal.id} deal={deal} />
          ))}
        </div>
      </section>

      <section aria-labelledby="hunts" className="grid gap-4">
        <div className="flex items-end justify-between gap-3">
          <h2 id="hunts" className="font-semibold text-lg">
            Your hunts
          </h2>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/app/hunts">
              Manage hunts
              <ArrowRightIcon aria-hidden />
            </Link>
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {hunts.map((hunt) => (
            <HuntCard key={hunt.id} hunt={hunt} asOf={summary.asOf} />
          ))}
        </div>
      </section>
    </div>
  )
}
