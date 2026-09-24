import { ArrowLeftIcon, ExternalLinkIcon, MapPinIcon, TruckIcon } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Checklist, CopyMessage, DealFeedback, MarkBought } from '@/components/deal-actions'
import { FactList } from '@/components/fact-list'
import { FreshnessStamp } from '@/components/freshness-stamp'
import { deliveryLabel } from '@/components/listing-card'
import { ListingPhoto } from '@/components/listing-photo'
import { PricePosition } from '@/components/price-position'
import { SuspectedLabel } from '@/components/suspected-label'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getAsOf, getDeal } from '@/data'
import { formatDistance, formatMoment, formatMoney } from '@/lib/format'

type Params = Promise<{ id: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const deal = await getDeal((await params).id)
  return { title: deal ? deal.listing.title : 'Deal' }
}

export default async function DealPage({ params }: { params: Params }) {
  const { id } = await params
  const [deal, asOf] = await Promise.all([getDeal(id), getAsOf()])
  if (!deal) notFound()
  const { listing } = deal
  const currencySymbol = listing.ask.currency === 'GBP' ? '£' : '€'
  return (
    <div className="grid gap-6">
      <Button variant="ghost" size="sm" className="w-fit -ml-2" asChild>
        <Link href="/app/deals">
          <ArrowLeftIcon aria-hidden />
          Deals
        </Link>
      </Button>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="grid content-start gap-6">
          <header className="grid gap-3">
            <p className="text-muted-foreground text-sm">{deal.matchReason}</p>
            <h1 className="text-balance font-semibold text-2xl tracking-tight">{listing.title}</h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground text-sm">
              <span className="inline-flex items-center gap-1">
                <MapPinIcon className="size-4" aria-hidden />
                {listing.town}, {formatDistance(listing.distanceKm)}
              </span>
              <span className="inline-flex items-center gap-1">
                <TruckIcon className="size-4" aria-hidden />
                {deliveryLabel[listing.delivery]}
              </span>
              {listing.condition ? <Badge>{listing.condition}</Badge> : null}
            </div>
            <p className="font-semibold text-4xl tabular">{formatMoney(listing.ask)}</p>
            <FreshnessStamp freshness={listing.freshness} className="text-sm" />
          </header>

          <div className="grid gap-3 lg:hidden">
            <OpenListing url={listing.listingUrl} />
            <MarkBought currencySymbol={currencySymbol} />
          </div>

          <ListingPhoto photoCount={listing.photoCount} variant="strip" />

          <Card>
            <CardHeader>
              <CardTitle>Asking-price position</CardTitle>
            </CardHeader>
            <CardContent>
              <PricePosition position={deal.position} />
            </CardContent>
          </Card>

          {deal.suspicions.length > 0 || deal.warnings.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Things to know</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                {deal.suspicions.map((suspicion) => (
                  <SuspectedLabel key={suspicion.id} suspicion={suspicion} />
                ))}
                {deal.warnings.length > 0 ? (
                  <ul className="grid gap-1.5 text-sm">
                    {deal.warnings.map((warning) => (
                      <li key={warning.id} className="flex items-center gap-2">
                        <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground" />
                        {warning.text}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>From the listing</CardTitle>
            </CardHeader>
            <CardContent>
              <FactList facts={listing.keyFacts} />
            </CardContent>
          </Card>

          {deal.priceChanges.length > 1 ? (
            <Card>
              <CardHeader>
                <CardTitle>Price on this listing</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="grid gap-2 text-sm">
                  {deal.priceChanges.map((change) => (
                    <li key={change.at} className="flex justify-between gap-4 tabular">
                      <time dateTime={change.at} className="text-muted-foreground">
                        {formatMoment(change.at, asOf)}
                      </time>
                      <span>{formatMoney(change.ask)}</span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <aside className="grid content-start gap-4 lg:sticky lg:top-20">
          <Card className="hidden lg:block">
            <CardContent className="grid gap-3">
              <OpenListing url={listing.listingUrl} />
              <MarkBought currencySymbol={currencySymbol} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Message to the seller</CardTitle>
            </CardHeader>
            <CardContent>
              <CopyMessage message={deal.preparedMessage} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Before you buy</CardTitle>
            </CardHeader>
            <CardContent>
              <Checklist items={deal.checklist} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Was this a deal</CardTitle>
            </CardHeader>
            <CardContent>
              <DealFeedback initial={deal.feedback} />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  )
}

function OpenListing({ url }: { url: string }) {
  return (
    <Button size="lg" asChild>
      <a href={url} target="_blank" rel="noopener noreferrer">
        Open on Facebook Marketplace
        <ExternalLinkIcon aria-hidden />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </Button>
  )
}
