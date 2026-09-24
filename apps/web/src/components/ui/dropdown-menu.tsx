'use client'

import { DropdownMenu as MenuPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '@/lib/utils'

export const DropdownMenu = MenuPrimitive.Root
export const DropdownMenuTrigger = MenuPrimitive.Trigger
export const DropdownMenuGroup = MenuPrimitive.Group
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = 'end',
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'z-50 min-w-48 animate-enter rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-soft',
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  )
}

const itemClass =
  'relative flex cursor-default select-none items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-muted data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted-foreground'

export function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Item>) {
  return <MenuPrimitive.Item className={cn(itemClass, className)} {...props} />
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.RadioItem>) {
  return (
    <MenuPrimitive.RadioItem className={cn(itemClass, 'pl-7', className)} {...props}>
      <span className="absolute left-2.5 flex size-2 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <span className="block size-2 rounded-full bg-primary" />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  )
}

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label
      className={cn('px-2.5 py-1.5 text-muted-foreground text-xs', className)}
      {...props}
    />
  )
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator
      className={cn('-mx-1.5 my-1.5 h-px bg-border', className)}
      {...props}
    />
  )
}
