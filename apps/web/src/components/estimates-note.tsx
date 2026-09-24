import { InfoIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/** The disclaimer every valuation carries (docs/web-app.md, Copy rules). */
export function EstimatesNote({ className }: { className?: string }) {
  return (
    <p className={cn('inline-flex items-center gap-1.5 text-muted-foreground text-xs', className)}>
      <InfoIcon className="size-3.5 shrink-0" aria-hidden />
      Estimates, not advice
    </p>
  )
}
