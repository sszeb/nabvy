import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { cn } from '@/lib/utils'

export const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 font-medium text-xs [&_svg]:size-3.5',
  {
    variants: {
      tone: {
        neutral: 'bg-muted text-muted-foreground',
        accent: 'bg-accent text-accent-foreground',
        success: 'bg-success text-success-foreground',
        warning: 'bg-warning text-warning-foreground',
        danger: 'bg-danger text-danger-foreground',
        info: 'bg-info text-info-foreground',
        outline: 'border border-border text-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props} />
}
