'use client'

import { Slider as SliderPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '@/lib/utils'

export function Slider({
  className,
  orientation = 'horizontal',
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      orientation={orientation}
      className={cn(
        'relative flex touch-none select-none data-[orientation=horizontal]:w-full data-[orientation=horizontal]:items-center data-[orientation=vertical]:h-full data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-center',
        className,
      )}
      {...props}
    />
  )
}

export function SliderTrack({
  className,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Track>) {
  return (
    <SliderPrimitive.Track
      data-slot="slider-track"
      className={cn(
        'relative grow rounded-full bg-muted data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5',
        className,
      )}
      {...props}
    />
  )
}

export function SliderRange({
  className,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Range>) {
  return (
    <SliderPrimitive.Range
      data-slot="slider-range"
      className={cn(
        'absolute rounded-full bg-primary data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full',
        className,
      )}
      {...props}
    />
  )
}

export function SliderThumb({
  className,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Thumb>) {
  return (
    <SliderPrimitive.Thumb
      data-slot="slider-thumb"
      className={cn(
        'block size-4 shrink-0 rounded-full border-2 border-primary bg-background shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
