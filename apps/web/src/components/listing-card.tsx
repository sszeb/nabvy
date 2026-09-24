import { MapPinIcon, TruckIcon } from 'lucide-react'
import Link from 'next/link'
import type { DeliveryMethod, ListingSummary } from '@/data/types'
import { formatDistance, formatMoment, formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ListingPhoto } from './listing-photo'
import { Badge } from './ui/badge'

export const deliveryLabel: Record<DeliveryMethod, string> = {
  collection: 'Collection',
  posted: 'Delivery',
  both: 'Collection or delivery',
  unknown: 'Delivery not stated',
}

/**
 * A marketplace listing: price up front, then title, key facts, town and time. No seller
 * identity is ever part of this card; the type does not carry any.
 */
export function ListingCard({
  listing,
  asOf,
  href,
  className,
  layout = 'grid',
}: {
  listing: ListingSummary
  asOf: string
  href?: string
  className?: string
  layout?: 'grid' | 'row'
}) {
  const stated = listing.keyFacts.filter((fact) => fact.status === 'stated').slice(0, 3)
  const title = href ? (
    <Link
      href={href}
      className="rounded-sm after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none"
    >
      {listing.title}
    </Link>
  ) : (
    listing.title
  )
  return (
    <article
      className={cn(
        'group relative rounded-2xl border bg-card p-3 transition-colors has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-ring has-[a:focus-visible]:outline-offset-2',
        href && 'hover:bg-muted/50',
        layout === 'row' ? 'flex gap-3' : 'grid gap-3',
        className,
      )}
    >
      <ListingPhoto
        photoCount={listing.photoCount}
        className={layout === 'row' ? 'w-28 shrink-0 sm:w-36' : undefined}
      />
      <div className="grid min-w-0 content-start gap-1">
        <p className="font-semibold text-xl tabular leading-tight">{formatMoney(listing.ask)}</p>
        <h3 className="line-clamp-2 font-medium text-sm leading-snug">{title}</h3>
        {stated.length > 0 ? (
          <p className="truncate text-muted-foreground text-xs">
            {stated.map((fact) => fact.value).join(' · ')}
          </p>
        ) : null}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
          <span className="inline-flex items-center gap-1">
            <MapPinIcon className="size-3.5" aria-hidden />
            {listing.town}, {formatDistance(listing.distanceKm)}
          </span>
          <span className="tabular">
            Listed{' '}
            <time dateTime={listing.freshness.listedAt}>
              {formatMoment(listing.freshness.listedAt, asOf)}
            </time>
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <Badge tone="outline">
            <TruckIcon aria-hidden />
            {deliveryLabel[listing.delivery]}
          </Badge>
          {listing.condition ? <Badge>{listing.condition}</Badge> : null}
        </div>
      </div>
    </article>
  )
}
