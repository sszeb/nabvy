import { InboxIcon } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import type * as React from 'react'
import { CommandPaletteProvider } from '@/components/command-palette'
import { DealCard } from '@/components/deal-card'
import { EmptyState } from '@/components/empty-state'
import { FreshnessStamp } from '@/components/freshness-stamp'
import { HuntCard } from '@/components/hunt-card'
import { ListingCard } from '@/components/listing-card'
import { PricePosition } from '@/components/price-position'
import { SearchTrigger } from '@/components/search-trigger'
import { DealCardSkeleton, ListingCardSkeleton, TableSkeleton } from '@/components/skeletons'
import { StatusChip } from '@/components/status-chip'
import { SuspectedLabel } from '@/components/suspected-label'
import { ThemeToggle } from '@/components/theme-toggle'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Wordmark } from '@/components/wordmark'
import { getAsOf, listExampleDeals, listHunts } from '@/data'

export const metadata: Metadata = { title: 'Design system' }

const swatches = [
  ['background', 'bg-background'],
  ['surface', 'bg-surface'],
  ['card', 'bg-card'],
  ['muted', 'bg-muted'],
  ['subtle', 'bg-subtle'],
  ['primary', 'bg-primary'],
  ['accent', 'bg-accent'],
  ['success', 'bg-success'],
  ['warning', 'bg-warning'],
  ['danger', 'bg-danger'],
  ['info', 'bg-info'],
  ['placeholder', 'bg-placeholder'],
] as const

function Section({
  id,
  title,
  note,
  children,
}: {
  id: string
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="grid gap-4 border-t pt-8">
      <div className="grid gap-1">
        <h2 id={`${id}-title`} className="font-semibold text-lg">
          {title}
        </h2>
        {note ? <p className="max-w-2xl text-muted-foreground text-sm">{note}</p> : null}
      </div>
      {children}
    </section>
  )
}

/** Every component in the kit, in each of its states. Screenshot-tested in both themes. */
export default async function DesignPage() {
  const [{ deals, irish }, hunts, asOf] = await Promise.all([
    listExampleDeals(),
    listHunts(),
    getAsOf(),
  ])
  const [low, trade, thin, copied, high] = [deals[0], deals[1], deals[2], deals[3], deals[4]]
  if (!low || !trade || !thin || !copied || !high) throw new Error('design fixtures missing')
  return (
    <CommandPaletteProvider
      deals={deals.map((deal) => ({
        id: deal.id,
        title: deal.listing.title,
        town: deal.listing.town,
      }))}
    >
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" aria-label="Nabvy home">
            <Wordmark />
          </Link>
          <span className="text-muted-foreground text-sm">Design system</span>
          <span className="ml-auto" />
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6">
        <div className="grid gap-2">
          <h1 className="font-semibold text-3xl tracking-tight">Nabvy design system</h1>
          <p className="max-w-2xl text-muted-foreground">
            Neutral greys, one accent colour (deep teal), system fonts. Every fixture on this page
            is invented. Listing photos are behind a flag that is off, so each listing shows a
            placeholder.
          </p>
        </div>

        <Section
          id="colours"
          title="Colours"
          note="Tokens in src/app/globals.css; test/tokens.test.ts checks WCAG AA contrast for every text pair in both themes."
        >
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {swatches.map(([name, className]) => (
              <li key={name} className="grid gap-1.5">
                <span className={`h-12 rounded-xl border ${className}`} />
                <span className="text-muted-foreground text-xs">{name}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="type" title="Type">
          <div className="grid gap-2">
            <p className="font-semibold text-4xl tracking-tight">£210</p>
            <p className="font-semibold text-2xl tracking-tight">Page title</p>
            <p className="font-semibold text-lg">Section title</p>
            <p>Body text in the system font. Plain UK English, no exclamation marks.</p>
            <p className="text-muted-foreground text-sm">Secondary text for bases and hints.</p>
          </div>
        </Section>

        <Section id="controls" title="Buttons and inputs">
          <div className="flex flex-wrap gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Delete</Button>
            <Button variant="link">Link</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="grid max-w-md gap-4">
            <div className="grid gap-2">
              <Label htmlFor="design-input">Label</Label>
              <Input id="design-input" placeholder="Rounded input" />
            </div>
            <div className="flex items-center gap-3">
              <Switch id="design-switch" defaultChecked />
              <Label htmlFor="design-switch">Switch</Label>
            </div>
          </div>
        </Section>

        <Section
          id="chips"
          title="StatusChip and badges"
          note="Text carries the meaning; colour only reinforces it."
        >
          <div className="flex flex-wrap gap-2">
            <StatusChip tone="success">Succeeded</StatusChip>
            <StatusChip tone="running">Running</StatusChip>
            <StatusChip tone="warning">Aborted</StatusChip>
            <StatusChip tone="danger">Failed</StatusChip>
            <StatusChip tone="paused">Paused</StatusChip>
            <StatusChip tone="neutral">Queued</StatusChip>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>Neutral</Badge>
            <Badge tone="accent">Accent</Badge>
            <Badge tone="outline">Outline</Badge>
            <Badge tone="warning">Warning</Badge>
          </div>
        </Section>

        <Section
          id="listing-card"
          title="ListingCard"
          note="Price up front, then title, key facts, town and time. No seller identity."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {deals.slice(0, 4).map((deal) => (
              <ListingCard
                key={deal.id}
                listing={deal.listing}
                asOf={asOf}
                href={`/app/deal/${deal.id}`}
              />
            ))}
          </div>
          <ListingCard listing={trade.listing} asOf={asOf} layout="row" className="max-w-xl" />
        </Section>

        <Section
          id="deal-card"
          title="DealCard"
          note="A listing that matched a hunt. No score of any kind."
        >
          <div className="grid gap-3">
            <DealCard deal={low} />
            <DealCard deal={copied} />
          </div>
        </Section>

        <Section
          id="price-position"
          title="PricePosition"
          note="The asking price against comparable asks. Shown only from 10 comparable asks; otherwise it reads “Not enough comparable asks”."
        >
          <div className="grid gap-4 md:grid-cols-2">
            {(
              [
                ['Low, 23 asks', low],
                ['High, 18 asks', high],
                ['Fewer than 10 asks', thin],
                ['Ireland, EUR asks only', irish],
              ] as const
            ).map(([caption, deal]) => (
              <div key={caption} className="grid gap-3 rounded-2xl border bg-card p-5">
                <p className="text-muted-foreground text-xs">{caption}</p>
                {/* This design-only fixture set always carries a position. */}
                <PricePosition position={deal.position as NonNullable<typeof deal.position>} />
              </div>
            ))}
          </div>
        </Section>

        <Section
          id="suspected-label"
          title="SuspectedLabel"
          note="Always “Suspected …:” followed by the facts, the evidence in a popover and a way to report a mistake. Evidence is listing-level; it never identifies a seller."
        >
          <div className="grid max-w-2xl gap-3">
            {[...trade.suspicions, ...copied.suspicions].map((suspicion) => (
              <SuspectedLabel key={suspicion.id} suspicion={suspicion} />
            ))}
          </div>
        </Section>

        <Section id="freshness" title="FreshnessStamp">
          <div className="grid gap-2">
            <FreshnessStamp freshness={low.listing.freshness} className="text-sm" />
            <FreshnessStamp
              freshness={{
                listedAt: low.listing.freshness.listedAt,
                foundAt: low.listing.freshness.foundAt,
              }}
              className="text-sm"
            />
          </div>
        </Section>

        <Section id="hunt-card" title="HuntCard">
          <div className="grid gap-3 md:grid-cols-3">
            {hunts.map((hunt) => (
              <HuntCard key={hunt.id} hunt={hunt} asOf={asOf} />
            ))}
          </div>
        </Section>

        <Section id="empty-state" title="EmptyState">
          <EmptyState
            icon={InboxIcon}
            title="No deals yet"
            description="New listings that match your hunts appear here."
            action={<Button variant="outline">Edit hunts</Button>}
          />
        </Section>

        <Section id="skeletons" title="Skeletons" note="Pulse stops when reduced motion is on.">
          <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
            <DealCardSkeleton />
            <ListingCardSkeleton />
          </div>
          <TableSkeleton rows={3} />
        </Section>

        <Section
          id="command-palette"
          title="Command palette"
          note="Ctrl+K or Cmd+K anywhere in the app."
        >
          <SearchTrigger />
        </Section>
      </main>
    </CommandPaletteProvider>
  )
}
