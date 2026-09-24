import { Label as LabelPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '@/lib/utils'

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn('font-medium text-foreground text-sm leading-none', className)}
      {...props}
    />
  )
}

export function FieldHint({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('text-muted-foreground text-sm', className)} {...props} />
}
