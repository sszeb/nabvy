import { call } from '@orpc/server'
import { BarChart3Icon, UsersIcon } from 'lucide-react'
import type { Metadata } from 'next'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { ProviderSwitch } from '@/components/provider-switch'
import { StatusChip, toneFor } from '@/components/status-chip'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getAdminOverview } from '@/data'
import { requireAdmin } from '@/lib/admin-gate'
import { formatMoment } from '@/lib/format'
import { rpcCallOptions } from '@/rpc/call'
import { router } from '@/rpc/router'

export const metadata: Metadata = { title: 'Admin' }

const jobLabel = {
  search_newest: 'Search, newest first',
  search_catch_up: 'Search, catch-up',
  details: 'Details',
} as const

const statusLabel = {
  succeeded: 'Succeeded',
  running: 'Running',
  failed: 'Failed',
  aborted: 'Aborted',
  queued: 'Queued',
} as const

const usd = (value: number) => `$${value.toFixed(value < 0.1 && value > 0 ? 4 : 2)}`

export default async function AdminPage() {
  await requireAdmin() // before any read (docs/design/admin-hardening.md, H1)
  const [overview, switches] = await Promise.all([
    getAdminOverview(),
    call(router.admin.switches.list, undefined, await rpcCallOptions()),
  ])
  const apifySwitch = switches.find((s) => s.name === 'apify')
  const tiles = [
    {
      label: 'Actor spend today',
      value: `${usd(overview.spendTodayUsd)} of ${usd(overview.spendCapUsd)}`,
    },
    { label: 'Listed to delivered, p50', value: `${overview.freshnessP50Minutes} min` },
    { label: 'Listed to delivered, p95', value: `${overview.freshnessP95Minutes} min` },
    { label: 'Dead letters', value: String(overview.deadLetters) },
  ]
  return (
    <>
      <PageHeader title="Admin" description="Operations, quality, business and users." />
      <Tabs defaultValue="operations">
        <TabsList>
          <TabsTrigger value="operations">Operations</TabsTrigger>
          <TabsTrigger value="quality">Quality</TabsTrigger>
          <TabsTrigger value="business">Business</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
        </TabsList>
        <TabsContent value="operations" className="grid grid-cols-1 gap-6">
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {tiles.map((tile) => (
              <div key={tile.label} className="grid gap-1 rounded-2xl border bg-card p-4">
                <dt className="text-muted-foreground text-xs">{tile.label}</dt>
                <dd className="font-semibold text-lg tabular">{tile.value}</dd>
              </div>
            ))}
          </dl>
          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
              <div className="grid gap-1">
                <CardTitle>Facebook collection</CardTitle>
                <CardDescription>Actor runs through the Apify gateway</CardDescription>
              </div>
              <ProviderSwitch enabled={apifySwitch?.state === 'on'} />
            </CardHeader>
            <CardContent className="grid grid-cols-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Region</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead className="text-right">Rows</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.runs.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="font-mono text-xs">{run.id}</TableCell>
                      <TableCell>
                        <StatusChip tone={toneFor(run.status)}>
                          {statusLabel[run.status]}
                        </StatusChip>
                      </TableCell>
                      <TableCell>{run.region}</TableCell>
                      <TableCell className="text-muted-foreground">{jobLabel[run.job]}</TableCell>
                      <TableCell className="text-right tabular">{run.rows}</TableCell>
                      <TableCell className="text-right tabular">{usd(run.costUsd)}</TableCell>
                      <TableCell className="tabular text-muted-foreground">
                        <time dateTime={run.startedAt}>
                          {formatMoment(run.startedAt, overview.asOf)}
                        </time>
                      </TableCell>
                      <TableCell className="text-right tabular text-muted-foreground">
                        {run.durationSeconds === undefined ? '–' : `${run.durationSeconds} s`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="quality">
          <EmptyState
            icon={BarChart3Icon}
            title="Quality metrics arrive with task 4.8"
            description="Alert precision, extraction pass rate and label frequency."
          />
        </TabsContent>
        <TabsContent value="business">
          <EmptyState
            icon={BarChart3Icon}
            title="Business metrics arrive with billing"
            description="Waits for the owner's pricing decision."
          />
        </TabsContent>
        <TabsContent value="users">
          <EmptyState
            icon={UsersIcon}
            title="User search arrives with task 4.8"
            description="A read-only support view. No session impersonation."
          />
        </TabsContent>
      </Tabs>
    </>
  )
}
