'use client'

import { AlertTriangleIcon } from 'lucide-react'
import { useId, useState } from 'react'
import type { Suspicion } from '@/data/types'
import { suspicionKindLabel as kindLabel } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './ui/dialog'
import { Textarea } from './ui/input'
import { Label } from './ui/label'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

/**
 * A suspected-behaviour label: always worded as a suspicion, followed by the facts, with the
 * evidence one click away and a route to report a mistake (docs/decisions.md, Precedence,
 * "Labels and scores"). Evidence is listing-level only; it never identifies a seller.
 */
export function SuspectedLabel({
  suspicion,
  className,
}: {
  suspicion: Suspicion
  className?: string
}) {
  return (
    <div
      className={cn(
        'grid gap-2 rounded-xl bg-warning px-3.5 py-3 text-warning-foreground',
        className,
      )}
      data-testid="suspected-label"
    >
      <p className="flex items-start gap-2 text-sm">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <span className="font-semibold">{kindLabel[suspicion.kind]}:</span> {suspicion.facts}
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-6 text-sm">
        <Popover>
          <PopoverTrigger className="rounded-sm font-medium underline underline-offset-4">
            See the evidence
          </PopoverTrigger>
          <PopoverContent>
            <p className="font-semibold text-sm">Why this label</p>
            <ul className="mt-2 grid gap-2 text-sm">
              {suspicion.evidence.map((item) => (
                <li key={`${item.label}-${item.detail}`} className="grid gap-0.5">
                  <span className="text-muted-foreground text-xs">{item.label}</span>
                  <span>{item.detail}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t pt-3 text-muted-foreground text-xs">
              {suspicion.rule}. A suspicion, not a finding.
            </p>
          </PopoverContent>
        </Popover>
        <ReportMistake label={kindLabel[suspicion.kind]} />
      </div>
    </div>
  )
}

export function ReportMistake({ label }: { label: string }) {
  const [sent, setSent] = useState(false)
  const fieldId = useId()
  return (
    <Dialog onOpenChange={(open) => (open ? setSent(false) : undefined)}>
      <DialogTrigger className="rounded-sm font-medium underline underline-offset-4">
        Report a mistake
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Report a mistake</DialogTitle>
        <DialogDescription>
          Tell us why “{label}” looks wrong. Your report goes to the review queue.
        </DialogDescription>
        {sent ? (
          <p
            className="mt-5 rounded-xl bg-success px-4 py-3 text-sm text-success-foreground"
            role="status"
          >
            Thanks. Your report is in the review queue.
          </p>
        ) : (
          <form
            className="mt-5 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              setSent(true)
            }}
          >
            <Label htmlFor={fieldId}>What is wrong</Label>
            <Textarea
              id={fieldId}
              name="reason"
              required
              placeholder="For example: this is a private sale, the warranty is the manufacturer’s"
            />
            <div className="flex justify-end">
              <Button type="submit">Send report</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
