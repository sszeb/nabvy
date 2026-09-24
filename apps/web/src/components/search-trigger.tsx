'use client'

import { SearchIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCommandPalette } from './command-palette'
import { Kbd } from './ui/kbd'

/** The top-bar search: opens the command palette. */
export function SearchTrigger({ className }: { className?: string }) {
  const { open } = useCommandPalette()
  return (
    <button
      type="button"
      onClick={open}
      className={cn(
        'flex h-9 w-full max-w-md items-center gap-2 rounded-full border bg-muted px-3.5 text-muted-foreground text-sm transition-colors hover:bg-subtle',
        className,
      )}
    >
      <SearchIcon className="size-4" aria-hidden />
      <span className="flex-1 text-left">Search or jump to</span>
      <span className="hidden items-center gap-1 sm:flex" aria-hidden>
        <Kbd>Ctrl</Kbd>
        <Kbd>K</Kbd>
      </span>
      <span className="sr-only">(Ctrl+K or Cmd+K)</span>
    </button>
  )
}
