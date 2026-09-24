import { ClockIcon } from 'lucide-react'
import type { Freshness } from '@/data/types'
import { freshnessParts, freshnessText } from '@/lib/freshness'
import { cn } from '@/lib/utils'

/** "listed 14:02 · found 14:05 · delivered 14:05", in UK time (docs/web-app.md). */
export function FreshnessStamp({
  freshness,
  className,
}: {
  freshness: Freshness
  className?: string
}) {
  const parts = freshnessParts(freshness)
  return (
    <p
      className={cn(
        'inline-flex items-center gap-1.5 text-muted-foreground text-xs tabular',
        className,
      )}
    >
      <ClockIcon className="size-3.5 shrink-0" aria-hidden />
      <span className="sr-only">Freshness: {freshnessText(freshness)}</span>
      <span aria-hidden>
        {parts.map((part, index) => (
          <span key={part.label}>
            {index > 0 ? <span className="px-1">·</span> : null}
            {part.label} <time dateTime={part.iso}>{part.time}</time>
          </span>
        ))}
      </span>
    </p>
  )
}
