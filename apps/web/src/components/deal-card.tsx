import { AlertTriangleIcon, ArrowDownIcon, MapPinIcon } from 'lucide-react'
import Link from 'next/link'
import type { Deal } from '@/data/types'
import { formatDistance, formatMoney } from '@/lib/format'
import { suspicionText } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { FreshnessStamp } from './freshness-stamp'
import { ListingPhoto } from './listing-photo'
import { PricePosition } from './price-position'
import { Badge } from './ui/badge'

/**
 * A listing that matched one of the user's hunts: the ask up front, its position among
 * comparable asks, labels and the freshness stamp. No score of any kind.
 */
export function DealCard({ deal, className }: { deal: Deal; className?: string }) {
  const { listing } = deal
  const previous = deal.priceChanges.at(-2)
  return (
    <article
      className={cn(
        'relative grid gap-4 rounded-2xl border bg-card p-4 transition-colors hover:bg-muted/40 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-ring has-[a:focus-visible]:outline-offset-2 sm:grid-cols-[10rem_1fr]',
        className,
      )}
      data-testid="deal-card"
    >
      <ListingPhoto photoCount={listing.photoCount} className="hidden sm:flex" />
      <div className="grid min-w-0 gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <p className="text-muted-foreground text-xs">{deal.huntName}</p>
            <h3 className="font-medium leading-snug">
              <Link
                href={`/app/deal/${deal.id}`}
                className="after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none"
              >
                {listing.title}
              </Link>
            </h3>
            <p className="inline-flex items-center gap-1 text-muted-foreground text-xs">
              <MapPinIcon className="size-3.5" aria-hidden />
              {listing.town}, {formatDistance(listing.distanceKm)}
            </p>
          </div>
          <div className="grid shrink-0 justify-items-end gap-1 text-right">
            <p className="font-semibold text-2xl tabular leading-none">
              {formatMoney(listing.ask)}
            </p>
            {previous ? (
              <Badge tone="accent">
                <ArrowDownIcon aria-hidden />
                was {formatMoney(previous.ask)}
              </Badge>
            ) : null}
          </div>
        </div>
        <PricePosition position={deal.position} variant="compact" />
        {deal.suspicions.length > 0 || deal.warnings.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {deal.suspicions.map((suspicion) => (
              <li key={suspicion.id}>
                <Badge tone="warning" className="whitespace-normal">
                  <AlertTriangleIcon aria-hidden />
                  {suspicionText(suspicion)}
                </Badge>
              </li>
            ))}
            {deal.warnings.map((warning) => (
              <li key={warning.id}>
                <Badge>{warning.text}</Badge>
              </li>
            ))}
          </ul>
        ) : null}
        <FreshnessStamp freshness={listing.freshness} />
      </div>
    </article>
  )
}
