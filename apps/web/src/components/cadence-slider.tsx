'use client'

import type {
  WantManagerCadenceBurstStatus,
  WantManagerCadenceEstimate,
  WantManagerCadenceSeconds,
} from '@nabvy/contracts/modules/want-manager'
import { CircleHelpIcon, LockIcon } from 'lucide-react'
import { type CSSProperties, useId } from 'react'
import {
  CADENCE_MAX_INDEX,
  CADENCE_STEPS,
  cadenceDotCount,
  cadenceIndexOf,
  cadenceModeName,
  cadenceStepAt,
  cadenceValueText,
  describeCadenceBurst,
  describeCadenceEstimate,
  isCadenceLocked,
} from '@/lib/cadence'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Slider, SliderThumb, SliderTrack } from './ui/slider'

/** Top row (index 5, fastest) first, matching the ladder's on-screen order. */
const ROWS = [...CADENCE_STEPS].map((_, index) => CADENCE_MAX_INDEX - index)

function CadenceDots({
  count,
  className,
  style,
}: {
  count: number
  className?: string
  style?: CSSProperties
}) {
  return (
    <div className="flex items-center justify-center gap-0.5" aria-hidden>
      {Array.from({ length: count }, (_, dotIndex) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed-length row of identical, static dots
          key={dotIndex}
          className={cn('size-1.5 rounded-[2px] transition-opacity duration-150', className)}
          style={style}
        />
      ))}
    </div>
  )
}

export type CadenceSliderInteractiveProps = {
  mode?: 'interactive'
  /** The step shown: the saved value while idle, the live drag or keyboard position otherwise. */
  value: WantManagerCadenceSeconds
  /** Fires on every change, including a live drag or keyboard step, so the caller can re-estimate. */
  onValueChange: (seconds: WantManagerCadenceSeconds) => void
  /** Fires only when the user commits an unlocked step; a locked commit never reaches this. */
  onValueCommit?: (seconds: WantManagerCadenceSeconds) => void
  /**
   * The estimate procedure's answer for `value`, or `null` while there is none (want-manager,
   * task 1.8e, has not shipped it yet): then no cost or cadence line is shown and no step is
   * locked, since the plan ceiling comes from the same procedure. Never a client-side guess.
   */
  estimate: WantManagerCadenceEstimate | null
  className?: string
}

export type CadenceSliderBurstProps = {
  mode: 'burst'
  /** The free-tier burst standing (want-manager, stubbed until 1.8e ships). */
  burst: WantManagerCadenceBurstStatus
  className?: string
}

export type CadenceSliderProps = CadenceSliderInteractiveProps | CadenceSliderBurstProps

/**
 * The want form's check-interval control (docs/design/cadence-slider.md): a vertical seven-step
 * dot-density slider, fastest at the top. Every number it shows — the credit estimate, the
 * delivered cadence, the unlock count, the plan ceiling — comes from `estimate`/`burst`; nothing
 * is computed here.
 */
export function CadenceSlider(props: CadenceSliderProps) {
  if (props.mode === 'burst') return <CadenceSliderBurst {...props} />
  return <CadenceSliderInteractive {...props} />
}

function CadenceSliderInteractive({
  value,
  onValueChange,
  onValueCommit,
  estimate,
  className,
}: CadenceSliderInteractiveProps) {
  const index = cadenceIndexOf(value)
  const planCeilingSeconds = estimate?.planCeilingSeconds ?? null
  const locked = isCadenceLocked(index, planCeilingSeconds)
  const lockedHintId = useId()
  const lines = estimate ? describeCadenceEstimate(estimate) : []

  return (
    <div
      className={cn('grid gap-2', className)}
      data-testid="cadence-slider"
      data-state="interactive"
      data-estimate={estimate ? 'live' : 'none'}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-baseline gap-1.5">
          <span className="text-muted-foreground text-sm">Cadence</span>
          <span className="font-medium text-primary text-sm">{cadenceModeName(index)}</span>
        </p>
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="About cadence">
              <CircleHelpIcon className="size-4" aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 text-sm">
            The chosen pace is how often Nabvy checks for this want. The delivered pace is how often
            this area is actually funded to be checked right now — the two can differ.
          </PopoverContent>
        </Popover>
      </div>
      <p className="flex justify-between text-muted-foreground text-xs">
        <span>Fastest</span>
        <span>Slowest</span>
      </p>
      <div className="flex gap-3">
        <Slider
          orientation="vertical"
          min={0}
          max={CADENCE_MAX_INDEX}
          step={1}
          value={[index]}
          onValueChange={([next]) => {
            if (next !== undefined) onValueChange(cadenceStepAt(next).seconds)
          }}
          onValueCommit={([next]) => {
            if (next === undefined || isCadenceLocked(next, planCeilingSeconds)) return
            onValueCommit?.(cadenceStepAt(next).seconds)
          }}
        >
          <SliderTrack className="grid w-11 grid-rows-7 gap-1 rounded-none bg-transparent p-0">
            {ROWS.map((rowIndex) => {
              const rowLocked = isCadenceLocked(rowIndex, planCeilingSeconds)
              const filled = !rowLocked && rowIndex >= index
              return (
                <div key={rowIndex} className="flex min-h-11 items-center justify-center">
                  <CadenceDots
                    count={cadenceDotCount(rowIndex)}
                    className={
                      rowLocked
                        ? 'bg-muted-foreground/20'
                        : filled
                          ? 'bg-primary'
                          : 'bg-muted-foreground/40'
                    }
                    style={filled ? { opacity: rowIndex === index ? 1 : 0.6 } : undefined}
                  />
                </div>
              )
            })}
          </SliderTrack>
          <SliderThumb
            aria-label="Cadence"
            aria-valuetext={cadenceValueText(index)}
            aria-describedby={locked ? lockedHintId : undefined}
          />
        </Slider>
        <div className="grid flex-1 grid-rows-7 gap-1 text-sm">
          {ROWS.map((rowIndex) => {
            const rowLocked = isCadenceLocked(rowIndex, planCeilingSeconds)
            return (
              <div
                key={rowIndex}
                className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-0.5"
              >
                <span className={rowLocked ? 'text-muted-foreground/60' : 'text-foreground'}>
                  {cadenceStepAt(rowIndex).name}
                </span>
                {rowLocked ? (
                  <>
                    <LockIcon className="size-3 text-muted-foreground" aria-hidden />
                    <span className="text-muted-foreground text-xs">Requires Pro</span>
                  </>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
      {locked ? (
        <span id={lockedHintId} className="sr-only">
          Requires Pro plan
        </span>
      ) : null}
      <div aria-live="polite" className="grid gap-1">
        {lines.map((line) => (
          <p key={line.kind} className="text-muted-foreground text-xs">
            {line.text}
          </p>
        ))}
      </div>
    </div>
  )
}

function CadenceSliderBurst({ burst, className }: CadenceSliderBurstProps) {
  const view = describeCadenceBurst(burst)

  return (
    <div className={cn('grid gap-2', className)} data-testid="cadence-slider" data-state="burst">
      <p className="flex items-baseline gap-1.5">
        <span className="text-muted-foreground text-sm">Cadence</span>
        <span className="font-medium text-primary text-sm">Free burst</span>
      </p>
      <p className="text-muted-foreground text-xs">{view.usedText}</p>
      <div
        role="img"
        aria-label={view.summary}
        className="relative h-2 w-full overflow-hidden rounded-full bg-muted-foreground/20"
      >
        <div className="flex h-full w-full">
          {view.segments.map((segment) => (
            <span
              key={segment.name}
              className="h-full bg-primary/50"
              style={{ width: `${segment.widthPercent}%` }}
            />
          ))}
        </div>
        <span
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary"
          style={{ left: `${view.markerPercent}%` }}
        />
      </div>
      <Button type="button" variant="link" size="sm" className="justify-self-start text-xs" asChild>
        <a href="/app/account">Upgrade to choose your pace</a>
      </Button>
    </div>
  )
}
