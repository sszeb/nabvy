import type { Metadata } from 'next'
import Link from 'next/link'
import { ChannelCard } from '@/components/channel-card'
import { channelName } from '@/components/hunt-card'
import { PageHeader } from '@/components/page-header'
import { StatusChip, toneFor } from '@/components/status-chip'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getAsOf, listAlertDeliveries, listChannels } from '@/data'
import { formatMoment } from '@/lib/format'

export const metadata: Metadata = { title: 'Alerts' }

const statusLabel = { delivered: 'Delivered', queued: 'Queued', failed: 'Failed' } as const

export default async function AlertsPage() {
  const [channels, deliveries, asOf] = await Promise.all([
    listChannels(),
    listAlertDeliveries(),
    getAsOf(),
  ])
  return (
    <div className="grid gap-10">
      <section className="grid gap-4">
        <PageHeader
          title="Alerts"
          description="Where your alerts go, and what was sent."
          className="mb-2"
        />
        <h2 className="font-semibold text-lg">Channels</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {channels.map((channel) => (
            <ChannelCard key={channel.kind} channel={channel} />
          ))}
        </div>
      </section>
      <section className="grid grid-cols-1 gap-4">
        <h2 className="font-semibold text-lg">Recent alerts</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sent</TableHead>
              <TableHead>Listing</TableHead>
              <TableHead className="hidden sm:table-cell">Hunt</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliveries.map((delivery) => (
              <TableRow key={delivery.id}>
                <TableCell className="text-muted-foreground tabular">
                  <time dateTime={delivery.at}>{formatMoment(delivery.at, asOf)}</time>
                </TableCell>
                <TableCell className="max-w-56 truncate">
                  <Link href={`/app/deal/${delivery.dealId}`} className="text-link hover:underline">
                    {delivery.listingTitle}
                  </Link>
                </TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">
                  {delivery.huntName}
                </TableCell>
                <TableCell>{channelName[delivery.channel]}</TableCell>
                <TableCell>
                  <StatusChip
                    tone={toneFor(
                      delivery.status === 'failed' ? 'failed_delivery' : delivery.status,
                    )}
                  >
                    {statusLabel[delivery.status]}
                  </StatusChip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  )
}
