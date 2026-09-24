import type {
  CadenceSeconds,
  WantManagerCadenceBurstStatus,
  WantManagerCadenceEstimate,
} from '@nabvy/contracts/modules/want-manager'

/**
 * The six-step cadence ladder (docs/design/cadence-slider.md), index 0 the slowest (bottom) to
 * index 5 the fastest (top) — the same order a vertical radix Slider uses by default (minimum at
 * the bottom, maximum at the top), so Home lands on the slowest step and End on the fastest,
 * exactly as the spec's keyboard section asks, with no `inverted` prop needed.
 *
 * The mode names are Nabvy's own, provisional wording (open question in
 * docs/design/cadence-slider.md; tracked in docs/questions/cadence-slider.md): this is the one
 * file to edit when the owner confirms or changes them.
 */
export const CADENCE_STEPS: ReadonlyArray<{ seconds: CadenceSeconds; name: string }> = [
  { seconds: 14400, name: 'Slow Watch' },
  { seconds: 7200, name: 'Steady' },
  { seconds: 3600, name: 'Regular' },
  { seconds: 900, name: 'Brisk' },
  { seconds: 300, name: 'Rapid' },
  { seconds: 60, name: 'Ultracheck' },
]

export const CADENCE_MAX_INDEX = CADENCE_STEPS.length - 1

/** Regular (1 h): a conservative default for a new want, and the placeholder's default ceiling. */
export const CADENCE_DEFAULT_SECONDS: CadenceSeconds = 3600

export function cadenceStepAt(index: number) {
  const step = CADENCE_STEPS[index]
  if (!step) throw new Error(`${index} is not a cadence step index`)
  return step
}

export function cadenceIndexOf(seconds: CadenceSeconds): number {
  const index = CADENCE_STEPS.findIndex((step) => step.seconds === seconds)
  if (index === -1) throw new Error(`${seconds} is not a cadence step`)
  return index
}

/** "1 minute", "15 minutes", "1 hour", "4 hours". */
export function formatCadenceInterval(seconds: CadenceSeconds): string {
  if (seconds < 3600) {
    const minutes = seconds / 60
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
  }
  const hours = seconds / 3600
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
}

/** The radix Thumb's `aria-valuetext`, e.g. "Rapid, checks every 5 minutes" — never the raw index. */
export function cadenceValueText(index: number): string {
  const step = cadenceStepAt(index)
  return `${step.name}, checks every ${formatCadenceInterval(step.seconds)}`
}

export function cadenceModeName(index: number): string {
  return cadenceStepAt(index).name
}

/** A step is locked when it is faster than the plan's cadence ceiling. */
export function isCadenceLocked(index: number, planCeilingSeconds: CadenceSeconds): boolean {
  return cadenceStepAt(index).seconds < planCeilingSeconds
}

/** Dot count rises 6 (fastest, top) to 1 (slowest, bottom): one more dot per faster step. */
export function cadenceDotCount(index: number): number {
  return index + 1
}

export type CadenceEstimateLine =
  | { kind: 'credits'; text: string }
  | { kind: 'delivered'; text: string }
  | { kind: 'unlock'; text: string }
  | { kind: 'runs-out'; text: string }

const dayFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/London',
})

/**
 * The muted-text lines under the track (docs/design/cadence-slider.md, "Cost and live-cadence
 * notes" and "Edge cases"), built only from the estimate procedure's own numbers — nothing here
 * is computed from the chosen step.
 */
export function describeCadenceEstimate(
  estimate: WantManagerCadenceEstimate,
): CadenceEstimateLine[] {
  const lines: CadenceEstimateLine[] = [
    { kind: 'credits', text: `~${estimate.creditsPerMonth} credits / mo` },
  ]
  if (estimate.deliveredCadenceSeconds !== null) {
    lines.push({
      kind: 'delivered',
      text: `delivered every ${formatCadenceInterval(estimate.deliveredCadenceSeconds)} here`,
    })
  }
  if (estimate.unlockWatchersNeeded !== null && estimate.unlockCadenceSeconds !== null) {
    const watchers = estimate.unlockWatchersNeeded
    lines.push({
      kind: 'unlock',
      text: `${watchers} more ${watchers === 1 ? 'watcher' : 'watchers'} unlock ${formatCadenceInterval(estimate.unlockCadenceSeconds)} here`,
    })
  }
  if (estimate.creditsRunOutDate !== null) {
    lines.push({
      kind: 'runs-out',
      text: `At this pace, credits run out around ${dayFormatter.format(new Date(estimate.creditsRunOutDate))}`,
    })
  }
  return lines
}

/**
 * The free-tier burst timeline (docs/design/cadence-slider.md, "Burst mode"): the four phases and
 * their durations are fixed product copy, not user data. The three timed phases (20 + 100 + 120
 * minutes) share `TIMED_SHARE` of the bar in proportion to their length; the open-ended "Regular"
 * phase fills the rest, since it has no real end to be proportional to.
 */
const TIMED_SHARE = 75
const TIMED_MINUTES = 20 + 100 + 120

export const CADENCE_BURST_PHASES: ReadonlyArray<{
  name: string
  seconds: CadenceSeconds
  durationMinutes: number | null
}> = [
  { name: 'Ultracheck', seconds: 60, durationMinutes: 20 },
  { name: 'Rapid', seconds: 300, durationMinutes: 100 },
  { name: 'Brisk', seconds: 900, durationMinutes: 120 },
  { name: 'Regular', seconds: 3600, durationMinutes: null },
]

export type CadenceBurstView = {
  segments: ReadonlyArray<{ name: string; widthPercent: number }>
  markerPercent: number
  usedText: string
  summary: string
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

/**
 * PLACEHOLDER until want-manager (backlog task 1.8e) ships the real estimate procedure. Returns a
 * plausible, clearly synthetic estimate so the cadence slider has something typed to render;
 * delete this function and call the real procedure once it exists (docs/design/cadence-slider.md
 * depends on `want-manager` for the live estimate).
 */
export function estimateCadencePlaceholderUntilWantManagerShips(
  chosenCadenceSeconds: CadenceSeconds,
  planCeilingSeconds: CadenceSeconds = 3600,
): WantManagerCadenceEstimate {
  const index = cadenceIndexOf(chosenCadenceSeconds)
  return {
    chosenCadenceSeconds,
    planCeilingSeconds,
    creditsPerMonth: (CADENCE_MAX_INDEX - index + 1) * 15,
    deliveredCadenceSeconds: null,
    unlockWatchersNeeded: null,
    unlockCadenceSeconds: null,
    creditsRunOutDate: null,
  }
}

export function describeCadenceBurst(status: WantManagerCadenceBurstStatus): CadenceBurstView {
  const segments = CADENCE_BURST_PHASES.map((phase) => ({
    name: phase.name,
    widthPercent:
      phase.durationMinutes === null
        ? 100 - TIMED_SHARE
        : (phase.durationMinutes / TIMED_MINUTES) * TIMED_SHARE,
  }))
  const markerPercent =
    status.elapsedMinutes <= TIMED_MINUTES
      ? clampPercent((status.elapsedMinutes / TIMED_MINUTES) * TIMED_SHARE)
      : clampPercent(
          TIMED_SHARE +
            Math.min(1, (status.elapsedMinutes - TIMED_MINUTES) / 60) * (100 - TIMED_SHARE),
        )
  const phaseNames = CADENCE_BURST_PHASES.map((phase) =>
    phase.durationMinutes === null
      ? `${phase.name} (thereafter)`
      : `${phase.name} (${phase.durationMinutes} min)`,
  ).join(' → ')
  const usedText = `used ${status.usedThisWeek} of ${status.weeklyLimit} this week · resets in ${status.resetsInHours}h`
  return {
    segments,
    markerPercent,
    usedText,
    summary: `Free burst timeline: ${phaseNames}. ${status.elapsedMinutes} minutes elapsed. ${usedText}.`,
  }
}
