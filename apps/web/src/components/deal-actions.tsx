'use client'

import { CheckIcon, CopyIcon, ThumbsDownIcon, ThumbsUpIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './ui/dialog'
import { Input } from './ui/input'
import { FieldHint, Label } from './ui/label'

/** Copies the prepared message. Nabvy never sends it: the user pastes it themselves. */
export function CopyMessage({ message }: { message: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="grid gap-3">
      <p className="rounded-xl bg-muted p-3.5 text-sm">{message}</p>
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(message)
              setCopied(true)
            } catch {
              setCopied(false)
            }
          }}
        >
          {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
          {copied ? 'Copied' : 'Copy message'}
        </Button>
        <span className="text-muted-foreground text-xs" role="status">
          {copied ? 'Paste it into Marketplace to send it.' : ''}
        </span>
      </div>
    </div>
  )
}

export function Checklist({ items }: { items: string[] }) {
  const baseId = useId()
  return (
    <ul className="grid gap-3">
      {items.map((item, index) => {
        const id = `${baseId}-${index}`
        return (
          <li key={item} className="flex items-start gap-3">
            <Checkbox id={id} />
            <Label htmlFor={id} className="font-normal leading-snug">
              {item}
            </Label>
          </li>
        )
      })}
    </ul>
  )
}

/** UI only: task 4.1 records the purchase through a procedure. */
export function MarkBought({ currencySymbol }: { currencySymbol: string }) {
  const [saved, setSaved] = useState(false)
  return (
    <Dialog onOpenChange={(open) => (open ? setSaved(false) : undefined)}>
      <DialogTrigger asChild>
        <Button variant="outline">Mark as bought</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Mark as bought</DialogTitle>
        <DialogDescription>
          Record what you paid. Later, record what you sold it for to see your profit.
        </DialogDescription>
        {saved ? (
          <p
            className="mt-5 rounded-xl bg-success px-4 py-3 text-sm text-success-foreground"
            role="status"
          >
            Saved to your inventory.
          </p>
        ) : (
          <form
            className="mt-5 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              setSaved(true)
            }}
          >
            <Label htmlFor="paid">What you paid ({currencySymbol})</Label>
            <Input
              id="paid"
              name="paid"
              inputMode="decimal"
              required
              pattern="[0-9]+([.][0-9]{1,2})?"
              aria-describedby="paid-hint"
            />
            <FieldHint id="paid-hint">Only you see this.</FieldHint>
            <div className="flex justify-end">
              <Button type="submit">Save</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Feedback: real deal or not a deal. It tunes this user's hunts and our checks. */
export function DealFeedback({ initial }: { initial?: 'real_deal' | 'not_a_deal' }) {
  const [verdict, setVerdict] = useState(initial)
  const options = [
    { value: 'real_deal', label: 'Real deal', icon: ThumbsUpIcon },
    { value: 'not_a_deal', label: 'Not a deal', icon: ThumbsDownIcon },
  ] as const
  return (
    <div className="grid gap-2">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Was this a deal</legend>
        {options.map((option) => (
          <Button
            key={option.value}
            variant="outline"
            aria-pressed={verdict === option.value}
            onClick={() => setVerdict(option.value)}
            className={cn(
              verdict === option.value &&
                'border-primary bg-accent text-accent-foreground hover:bg-accent',
            )}
          >
            <option.icon aria-hidden />
            {option.label}
          </Button>
        ))}
      </fieldset>
      <p className="text-muted-foreground text-xs" role="status">
        {verdict ? 'Thanks. This helps tune your hunts.' : ''}
      </p>
    </div>
  )
}
