import type * as React from 'react'
import { cn } from '@/lib/utils'

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn('animate-skeleton rounded-lg bg-subtle', className)}
      {...props}
    />
  )
}
