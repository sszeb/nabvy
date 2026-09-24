import { ChevronRightIcon, DownloadIcon } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { getAccount } from '@/data'

export const metadata: Metadata = { title: 'Account' }

const methodLabel = { magic_link: 'Email link', google: 'Google' } as const

export default async function AccountPage() {
  const account = await getAccount()
  const rows = [
    { label: 'Email', value: account.email },
    { label: 'Home area', value: account.postcodeDistrict },
    {
      label: 'Sign-in',
      value: account.signInMethods.map((method) => methodLabel[method]).join(', '),
    },
  ]
  return (
    <div className="grid max-w-2xl gap-6">
      <PageHeader title="Account" />
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm">
            {rows.map((row) => (
              <div key={row.label} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid gap-1 p-2">
          {[
            { href: '/app/alerts', label: 'Alert channels', hint: 'Telegram, push and email' },
            {
              href: '/app/account/preferences',
              label: 'Preferences',
              hint: 'Emails, digest day and theme',
            },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center justify-between gap-4 rounded-xl px-3 py-3 hover:bg-muted"
            >
              <span className="grid gap-0.5">
                <span className="font-medium text-sm">{link.label}</span>
                <span className="text-muted-foreground text-xs">{link.hint}</span>
              </span>
              <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
            </Link>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Your data</CardTitle>
          <CardDescription>
            Download everything we hold about you, or delete your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Button variant="outline" className="w-fit">
            <DownloadIcon aria-hidden />
            Export my data
          </Button>
          <Separator />
          <div className="grid gap-2">
            <p className="text-muted-foreground text-sm">
              Deleting your account removes your hunts, alerts and inventory within 24 hours.
            </p>
            <Button variant="destructive" className="w-fit">
              Delete account
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
