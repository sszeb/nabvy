import type * as React from 'react'
import { cn } from '@/lib/utils'

export const fieldClass =
  'w-full min-w-0 rounded-xl border border-input bg-background px-3.5 text-base text-foreground placeholder:text-muted-foreground transition-colors focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger-foreground sm:text-sm'

export function Input({ className, type = 'text', ...props }: React.ComponentProps<'input'>) {
  return (
    <input type={type} data-slot="input" className={cn(fieldClass, 'h-10', className)} {...props} />
  )
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldClass, 'min-h-24 py-2.5', className)}
      {...props}
    />
  )
}

/** A native select: fully keyboard and screen-reader friendly on every platform. */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <select data-slot="select" className={cn(fieldClass, 'h-10 pr-8', className)} {...props}>
      {children}
    </select>
  )
}
