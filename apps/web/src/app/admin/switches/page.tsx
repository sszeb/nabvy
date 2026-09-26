import { call } from '@orpc/server'
import type { Metadata } from 'next'
import { IncidentRetryForm } from '@/components/incident-retry-form'
import { PageHeader } from '@/components/page-header'
import { SwitchToggle } from '@/components/switch-toggle'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { requireAdmin } from '@/lib/admin-gate'
import { rpcCallOptions } from '@/rpc/call'
import { router } from '@/rpc/router'

export const metadata: Metadata = { title: 'Switches & spend' }

const usd = (micros: number | null) =>
  micros === null ? '—' : `$${(micros / 1_000_000).toFixed(4)}`

/**
 * Admin: switches, spend caps and incidents (task L1). Spend caps are read-only —
 * `@nabvy/spend-governor` exports no writer for a budget's limit yet (docs/questions/L1-web.md).
 * Incidents has no list function either, so retry takes an incident ID rather than showing a
 * queue (docs/questions/L1-web.md).
 */
export default async function SwitchesPage() {
  await requireAdmin()
  const options = await rpcCallOptions()
  const [switches, budgets, advice] = await Promise.all([
    call(router.admin.switches.list, undefined, options),
    call(router.admin.spend.budgets, undefined, options),
    call(router.admin.spend.advice, undefined, options),
  ])
  return (
    <>
      <PageHeader title="Switches & spend" description="Kill switches, spend caps and incidents." />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Switches</CardTitle>
            <CardDescription>Every module, provider, gate and flag.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Changed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {switches.map((s) => (
                  <TableRow key={s.name}>
                    <TableCell className="font-mono text-xs">{s.name}</TableCell>
                    <TableCell className="text-muted-foreground">{s.kind}</TableCell>
                    <TableCell>
                      <SwitchToggle name={s.name} kind={s.kind} state={s.state} />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{s.changedAt}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Spend caps</CardTitle>
            <CardDescription>
              Read-only: no writer exists yet to change a cap from this screen
              (docs/questions/L1-web.md).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Budget</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead className="text-right">Limit</TableHead>
                  <TableHead className="text-right">Committed</TableHead>
                  <TableHead className="text-right">Forecast</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {budgets.map((b) => (
                  <TableRow key={b.name}>
                    <TableCell className="font-mono text-xs">{b.name}</TableCell>
                    <TableCell className="text-muted-foreground">{b.level ?? '—'}</TableCell>
                    <TableCell className="text-right tabular">{usd(b.limitMicros)}</TableCell>
                    <TableCell className="text-right tabular">{usd(b.committedMicros)}</TableCell>
                    <TableCell className="text-right tabular">{usd(b.forecastMicros)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {advice.length > 0 ? (
              <ul className="mt-4 grid gap-1 text-muted-foreground text-sm">
                {advice.map((a) => (
                  <li key={`${a.budget}-${a.advice}`}>
                    {a.budget}: {a.advice.replace(/-/g, ' ')}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Incidents</CardTitle>
            <CardDescription>Retry by ID (no list yet — docs/questions/L1-web.md).</CardDescription>
          </CardHeader>
          <CardContent>
            <IncidentRetryForm />
          </CardContent>
        </Card>
      </div>
    </>
  )
}
