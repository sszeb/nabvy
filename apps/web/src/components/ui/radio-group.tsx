'use client'

import { RadioGroup as RadioPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '@/lib/utils'

export function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioPrimitive.Root>) {
  return <RadioPrimitive.Root className={cn('grid gap-2', className)} {...props} />
}

/** A radio rendered as a selectable card: the whole card is the hit area. */
export function RadioCard({
  className,
  children,
  ...props
}: React.ComponentProps<typeof RadioPrimitive.Item>) {
  return (
    <RadioPrimitive.Item
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted data-[state=checked]:border-primary data-[state=checked]:bg-accent',
        className,
      )}
      {...props}
    >
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-input bg-background">
        <RadioPrimitive.Indicator className="block size-2 rounded-full bg-primary" />
      </span>
      <span className="grid gap-0.5">{children}</span>
    </RadioPrimitive.Item>
  )
}
