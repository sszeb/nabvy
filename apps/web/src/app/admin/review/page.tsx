import type { Metadata } from 'next'
import { PageHeader } from '@/components/page-header'
import { StatusChip, toneFor } from '@/components/status-chip'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getAsOf, listReviewQueue } from '@/data'
import { formatMoment } from '@/lib/format'

export const metadata: Metadata = { title: 'Review console' }

const reasonLabel = {
  extraction_low_confidence: 'Low-confidence extraction',
  label_reported: 'Label reported by a user',
  spot_check: 'Spot check',
} as const

const statusLabel = { open: 'Open', corrected: 'Corrected', dismissed: 'Dismissed' } as const

/** The review console shell: quarantine, reported labels and spot checks (task 4.5). */
export default async function ReviewPage() {
  const [queue, asOf] = await Promise.all([listReviewQueue(), getAsOf()])
  const current = queue[0]
  return (
    <>
      <PageHeader
        title="Review console"
        description="Quarantine, reported labels and spot checks."
      />
      <div className="grid gap-6 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Queued</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Listing</TableHead>
              <TableHead>Field</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {queue.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="tabular text-muted-foreground">
                  <time dateTime={item.queuedAt}>{formatMoment(item.queuedAt, asOf)}</time>
                </TableCell>
                <TableCell>{reasonLabel[item.reason]}</TableCell>
                <TableCell className="max-w-56 truncate">
                  {item.listingTitle}
                  <span className="text-muted-foreground"> · {item.town}</span>
                </TableCell>
                <TableCell>{item.field}</TableCell>
                <TableCell>
                  <StatusChip tone={toneFor(item.status)}>{statusLabel[item.status]}</StatusChip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {current ? (
          <Card className="content-start">
            <CardHeader>
              <CardTitle>Correct a field</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              <p className="text-muted-foreground">{current.listingTitle}</p>
              <div className="grid gap-2">
                <Label htmlFor="review-value">{current.field}</Label>
                <Input id="review-value" defaultValue={current.extracted} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm">Save correction</Button>
                <Button size="sm" variant="outline">
                  Add as fixture
                </Button>
                <Button size="sm" variant="ghost">
                  Dismiss
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  )
}
