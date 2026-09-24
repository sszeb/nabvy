'use client'

import { Popover as PopoverPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '@/lib/utils'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger

export function PopoverContent({
  className,
  align = 'start',
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-80 max-w-[calc(100vw-2rem)] animate-enter rounded-xl border bg-popover p-4 text-popover-foreground shadow-soft outline-none',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}
