import {
  EyeOffIcon,
  FileSearchIcon,
  GaugeIcon,
  ScaleIcon,
  SearchIcon,
  ShieldAlertIcon,
} from 'lucide-react'
import Link from 'next/link'
import { DealCard } from '@/components/deal-card'
import { FreshnessStamp } from '@/components/freshness-stamp'
import { Button } from '@/components/ui/button'
import { listExampleDeals } from '@/data'

const steps = [
  {
    icon: SearchIcon,
    title: 'Set a hunt',
    body: 'A postcode, a radius and what you are after: a graphics card, a gaming PC, a console.',
  },
  {
    icon: FileSearchIcon,
    title: 'Each listing is read',
    body: 'New Facebook Marketplace listings near you are checked for the facts that matter, and for what they leave out.',
  },
  {
    icon: GaugeIcon,
    title: 'You get the facts',
    body: 'An alert with the asking price, where it sits among comparable asks, any warning signs and when it was listed.',
  },
]

const principles = [
  {
    icon: ScaleIcon,
    title: 'Asking prices, compared with asking prices',
    body: 'We show where an ask sits among at least ten comparable asks. Asking prices, never presented as sale prices.',
  },
  {
    icon: ShieldAlertIcon,
    title: 'Suspicions, with their evidence',
    body: 'A label such as “Suspected trade seller” always shows the facts behind it, and you can report a mistake. No hidden scores.',
  },
  {
    icon: EyeOffIcon,
    title: 'No seller details',
    body: 'Nabvy never shows who is selling. Locations are shown to the town, or as a distance.',
  },
]

export default async function LandingPage() {
  const { deals } = await listExampleDeals()
  const example = deals[0]
  return (
    <>
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-14 pb-16 sm:px-6 lg:grid-cols-2 lg:pt-20">
        <div className="grid gap-6">
          <p className="w-fit rounded-full bg-accent px-3 py-1 font-medium text-accent-foreground text-xs">
            Public beta · Facebook Marketplace · UK and Ireland
          </p>
          <h1 className="text-balance font-semibold text-4xl tracking-tight sm:text-5xl">
            Second-hand deals near you, checked before they reach you.
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground">
            Nabvy watches Facebook Marketplace around your postcode, reads each new listing, and
            tells you where the asking price sits among comparable asks. You decide what to do.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" asChild>
              <Link href="/waitlist">Join the waitlist</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/sign-in">Sign in</Link>
            </Button>
          </div>
          <p className="text-muted-foreground text-sm">Estimates, not advice.</p>
        </div>
        <div className="grid gap-3 rounded-3xl border bg-surface p-4 sm:p-6">
          <p className="font-medium text-muted-foreground text-xs">An example alert</p>
          {example ? <DealCard deal={example} /> : null}
        </div>
      </section>

      <section id="how-it-works" className="border-y bg-surface">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6">
          <h2 className="font-semibold text-2xl tracking-tight">How it works</h2>
          <ol className="grid gap-4 md:grid-cols-3">
            {steps.map((step, index) => (
              <li
                key={step.title}
                className="grid content-start gap-3 rounded-2xl border bg-card p-5"
              >
                <span className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-full bg-accent text-accent-foreground">
                    <step.icon className="size-4" aria-hidden />
                  </span>
                  <span className="text-muted-foreground text-sm">Step {index + 1}</span>
                </span>
                <h3 className="font-medium">{step.title}</h3>
                <p className="text-muted-foreground text-sm">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6">
        <h2 className="font-semibold text-2xl tracking-tight">What we show, and what we do not</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {principles.map((item) => (
            <div key={item.title} className="grid content-start gap-3">
              <item.icon className="size-5 text-primary" aria-hidden />
              <h3 className="font-medium">{item.title}</h3>
              <p className="text-muted-foreground text-sm">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t bg-surface">
        <div className="mx-auto grid max-w-6xl gap-4 px-4 py-16 sm:px-6 md:grid-cols-2 md:items-center">
          <div className="grid gap-3">
            <h2 className="font-semibold text-2xl tracking-tight">Speed, measured and shown</h2>
            <p className="text-muted-foreground">
              Every alert carries its own freshness stamp: when the listing went up, when we found
              it and when it reached you. We will publish the daily median, measured, never
              promised.
            </p>
          </div>
          {example ? (
            <div className="rounded-2xl border bg-card p-5">
              <FreshnessStamp freshness={example.listing.freshness} className="text-sm" />
            </div>
          ) : null}
        </div>
      </section>
    </>
  )
}
