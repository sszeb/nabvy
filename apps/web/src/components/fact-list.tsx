import { CircleHelpIcon } from 'lucide-react'
import type { ListingFact } from '@/data/types'
import { cn } from '@/lib/utils'

/**
 * Key facts quoted from the listing. A fact the listing does not state reads "Not stated, ask
 * the seller": silence is never a "no".
 */
export function FactList({
  facts,
  className,
  limit,
}: {
  facts: ListingFact[]
  className?: string
  limit?: number
}) {
  const shown = limit ? facts.slice(0, limit) : facts
  return (
    <dl className={cn('grid gap-1.5 text-sm', className)}>
      {shown.map((fact) => (
        <div key={fact.label} className="flex min-w-0 gap-2">
          <dt className="w-24 shrink-0 text-muted-foreground">{fact.label}</dt>
          <dd className="min-w-0 truncate">
            {fact.status === 'stated' ? (
              fact.value
            ) : (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <CircleHelpIcon className="size-3.5" aria-hidden />
                Not stated, ask the seller
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}
