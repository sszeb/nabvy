import { BellIcon, MailIcon, MapPinIcon, SendIcon } from 'lucide-react'
import Link from 'next/link'
import type { ChannelKind, Hunt } from '@/data/types'
import { formatMoment, formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import { StatusChip } from './status-chip'

const channelIcon: Record<ChannelKind, typeof BellIcon> = {
  telegram: SendIcon,
  push: BellIcon,
  email: MailIcon,
}

export const channelName: Record<ChannelKind, string> = {
  telegram: 'Telegram',
  push: 'Push',
  email: 'Email',
}

export function HuntCard({
  hunt,
  asOf,
  className,
}: {
  hunt: Hunt
  asOf: string
  className?: string
}) {
  return (
    <article
      className={cn(
        'relative grid gap-3 rounded-2xl border bg-card p-4 transition-colors hover:bg-muted/40 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-ring has-[a:focus-visible]:outline-offset-2',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <h3 className="font-medium leading-snug">
            <Link
              href={`/app/hunts/${hunt.id}`}
              className="after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none"
            >
              {hunt.name}
            </Link>
          </h3>
          <p className="inline-flex items-center gap-1 text-muted-foreground text-xs">
            <MapPinIcon className="size-3.5" aria-hidden />
            Within {hunt.radiusKm} km of {hunt.postcodeDistrict}
            {hunt.maxAsk ? ` · up to ${formatMoney(hunt.maxAsk)}` : ''}
          </p>
        </div>
        <StatusChip tone={hunt.status === 'active' ? 'success' : 'paused'}>
          {hunt.status === 'active' ? 'Active' : 'Paused'}
        </StatusChip>
      </div>
      <p className="truncate text-muted-foreground text-sm">{hunt.terms.join(', ')}</p>
      <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground text-xs">
        <span className="tabular">
          {hunt.alertsThisWeek} {hunt.alertsThisWeek === 1 ? 'alert' : 'alerts'} this week
          {hunt.lastAlertAt ? ` · last at ${formatMoment(hunt.lastAlertAt, asOf)}` : ''}
        </span>
        <span className="flex items-center gap-1.5">
          {hunt.channels.map((channel) => {
            const Icon = channelIcon[channel]
            return (
              <span key={channel} className="inline-flex items-center gap-1">
                <Icon className="size-3.5" aria-hidden />
                <span className="sr-only sm:not-sr-only">{channelName[channel]}</span>
              </span>
            )
          })}
        </span>
      </div>
    </article>
  )
}
