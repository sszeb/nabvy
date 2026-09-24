import { cn } from '@/lib/utils'

/** Placeholder wordmark until the owner supplies a logo (docs/web-app.md, Brand). */
export function Wordmark({
  className,
  compact = false,
}: {
  className?: string
  compact?: boolean
}) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      <span
        aria-hidden
        className="flex size-7 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground text-sm"
      >
        n
      </span>
      {compact ? <span className="sr-only">Nabvy</span> : <span className="text-lg">nabvy</span>}
    </span>
  )
}
