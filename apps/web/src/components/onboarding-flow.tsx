'use client'

import { ArrowLeftIcon, BellIcon, MailIcon, SendIcon } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import type { ChannelKind, Deal } from '@/data/types'
import { DealCard } from './deal-card'
import { EstimatesNote } from './estimates-note'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { FieldHint, Label } from './ui/label'
import { RadioCard, RadioGroup } from './ui/radio-group'

const steps = ['Your area', 'Your first hunt', 'Where alerts go', 'What alerts look like'] as const

const channelOptions: Array<{
  value: ChannelKind
  label: string
  hint: string
  icon: typeof BellIcon
}> = [
  {
    value: 'telegram',
    label: 'Telegram',
    hint: 'Fastest. Link with a one-time code.',
    icon: SendIcon,
  },
  {
    value: 'push',
    label: 'Notifications on this device',
    hint: 'On iPhone, add Nabvy to your Home Screen first.',
    icon: BellIcon,
  },
  { value: 'email', label: 'Email', hint: 'To your sign-in address.', icon: MailIcon },
]

/**
 * Postcode, default hunt, channel, preview (docs/web-app.md, Onboarding). UI only: task 4.1
 * saves each step through procedures.
 */
export function OnboardingFlow({ examples }: { examples: Deal[] }) {
  const [step, setStep] = useState(0)
  const [postcode, setPostcode] = useState('')
  const [channel, setChannel] = useState<ChannelKind>('telegram')
  const district = postcode.trim().toUpperCase().split(/\s+/)[0] || 'your area'
  const next = () => setStep((value) => Math.min(steps.length - 1, value + 1))

  return (
    <div className="grid gap-8">
      <div className="grid gap-3">
        <p className="text-muted-foreground text-sm" aria-live="polite">
          Step {step + 1} of {steps.length}: {steps[step]}
        </p>
        <div className="grid grid-cols-4 gap-1.5" aria-hidden>
          {steps.map((label, index) => (
            <span
              key={label}
              className={`h-1.5 rounded-full ${index <= step ? 'bg-primary' : 'bg-subtle'}`}
            />
          ))}
        </div>
      </div>

      {step === 0 ? (
        <form
          className="grid gap-6"
          onSubmit={(event) => {
            event.preventDefault()
            next()
          }}
        >
          <div className="grid gap-2">
            <h1 className="font-semibold text-2xl tracking-tight">Where do you buy</h1>
            <p className="text-muted-foreground">We look for listings around this postcode.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="onboarding-postcode">Postcode</Label>
            <Input
              id="onboarding-postcode"
              value={postcode}
              onChange={(event) => setPostcode(event.target.value)}
              autoComplete="postal-code"
              required
              className="h-12 uppercase"
              aria-describedby="onboarding-postcode-hint"
            />
            <FieldHint id="onboarding-postcode-hint">
              We keep only the first half, for example PO19.
            </FieldHint>
          </div>
          <Button type="submit" size="lg">
            Continue
          </Button>
        </form>
      ) : null}

      {step === 1 ? (
        <div className="grid gap-6">
          <div className="grid gap-2">
            <h1 className="font-semibold text-2xl tracking-tight">Your first hunt</h1>
            <p className="text-muted-foreground">A sensible start. You can change it any time.</p>
          </div>
          <dl className="grid gap-3 rounded-2xl border bg-card p-5 text-sm">
            {[
              ['Looking for', 'GPUs and gaming PCs'],
              ['Area', `Within 40 km of ${district}`],
              ['Delivery', 'Collection or delivery'],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          <Button size="lg" onClick={next}>
            Use this hunt
          </Button>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="grid gap-6">
          <div className="grid gap-2">
            <h1 className="font-semibold text-2xl tracking-tight">Where should alerts go</h1>
            <p className="text-muted-foreground">You can add more channels later.</p>
          </div>
          <RadioGroup
            aria-label="Alert channel"
            value={channel}
            onValueChange={(value) => setChannel(value as ChannelKind)}
          >
            {channelOptions.map((option) => (
              <RadioCard key={option.value} value={option.value}>
                <span className="inline-flex items-center gap-2 font-medium text-sm">
                  <option.icon className="size-4" aria-hidden />
                  {option.label}
                </span>
                <span className="text-muted-foreground text-sm">{option.hint}</span>
              </RadioCard>
            ))}
          </RadioGroup>
          <Button size="lg" onClick={next}>
            Continue
          </Button>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="grid gap-6">
          <div className="grid gap-2">
            <h1 className="font-semibold text-2xl tracking-tight">What alerts look like</h1>
            <p className="text-muted-foreground">Three examples from the last day.</p>
            <EstimatesNote />
          </div>
          <div className="grid gap-3">
            {examples.map((deal) => (
              <DealCard key={deal.id} deal={deal} />
            ))}
          </div>
          <Button size="lg" asChild>
            <Link href="/app">Go to your dashboard</Link>
          </Button>
        </div>
      ) : null}

      {step > 0 ? (
        <Button variant="ghost" className="w-fit" onClick={() => setStep((value) => value - 1)}>
          <ArrowLeftIcon aria-hidden />
          Back
        </Button>
      ) : null}
    </div>
  )
}
