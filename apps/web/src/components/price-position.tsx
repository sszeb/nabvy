import type { PricePosition as PricePositionData } from '@/data/types'
import { formatMoney } from '@/lib/format'
import { describePosition } from '@/lib/price-position'
import { cn } from '@/lib/utils'
import { EstimatesNote } from './estimates-note'

/**
 * Where an asking price sits among comparable asks. Only asks are compared, so the wording never
 * says what an item is worth, a fair value or a sale price. Below ten comparable asks it shows
 * "Not enough comparable asks" and no position (lib/price-position.ts).
 */
export function PricePosition({
  position,
  variant = 'full',
  className,
}: {
  position: PricePositionData
  variant?: 'full' | 'compact'
  className?: string
}) {
  const view = describePosition(position)
  const money = (amountMinor: number) => formatMoney({ amountMinor, currency: position.currency })

  if (view.kind === 'hidden') {
    return (
      <div className={cn('grid gap-1', className)} data-testid="price-position" data-state="hidden">
        <p className="font-medium text-muted-foreground text-sm">{view.text}</p>
        {variant === 'full' ? (
          <p className="text-muted-foreground text-xs">
            {view.basis}. A position is shown from 10 comparable asks.
          </p>
        ) : null}
      </div>
    )
  }

  const toneText =
    view.band === 'low'
      ? 'text-success-foreground'
      : view.band === 'high'
        ? 'text-warning-foreground'
        : 'text-foreground'

  return (
    <div className={cn('grid gap-2', className)} data-testid="price-position" data-state="shown">
      <p className={cn('font-medium text-sm', toneText)}>{view.text}</p>
      <div
        role="img"
        aria-label={`Asking price ${money(position.askMinor)}. ${view.text}. Comparable asks run from ${money(position.range.lowestMinor)} to ${money(position.range.highestMinor)}, middle ask ${money(position.range.medianMinor)}.`}
        className="relative h-2 w-full rounded-full bg-position-track"
      >
        <span
          className="absolute inset-y-0 rounded-full bg-position-band"
          style={{
            left: `${view.scale.lowerQuartile}%`,
            width: `${Math.max(2, view.scale.upperQuartile - view.scale.lowerQuartile)}%`,
          }}
        />
        <span
          className="absolute -top-0.5 h-3 w-px bg-muted-foreground"
          style={{ left: `${view.scale.median}%` }}
        />
        <span
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-position-marker"
          style={{ left: `${view.scale.marker}%` }}
        />
      </div>
      {variant === 'full' ? (
        <>
          <div className="flex justify-between text-muted-foreground text-xs tabular" aria-hidden>
            <span>Lowest ask {money(position.range.lowestMinor)}</span>
            <span>Middle {money(position.range.medianMinor)}</span>
            <span>Highest {money(position.range.highestMinor)}</span>
          </div>
          <p className="text-muted-foreground text-xs">
            Based on {view.basis}. Asking prices, not sale prices.
          </p>
          <EstimatesNote />
        </>
      ) : (
        <p className="text-muted-foreground text-xs">{view.basis}</p>
      )}
    </div>
  )
}
