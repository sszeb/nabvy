// Pure logic: no I/O, no database, no clock read implicitly (every timestamp is an input).
import type { ProgrammeStep } from './programmes'

export interface StepEvalContext {
  now: Date
  /** The qualifying trigger event's own time, or the computed inactivity anchor (programmes.ts). */
  triggeredAt: Date
  /** The earliest exit or goal event at or after `triggeredAt`, or null if none has happened. */
  exitedAt: Date | null
  /** Whether `(userId, programme, step, triggeredAt)` already has a `programme_runs` row. */
  alreadySent: boolean
  /** `canMarket()`'s result; null when the step is a service message (category null). */
  canMarket: boolean | null
  /** Whether this user has already had a marketing message today (config: daily cap). */
  dailyCapReached: boolean
}

export type StepDecision =
  | { action: 'send' }
  | { action: 'wait' }
  | { action: 'skip'; reason: 'already-sent' | 'exited' | 'not-consented' | 'daily-cap' }

/**
 * Whether a step should be sent right now. Every branch is a fresh read of real data (no skip is
 * ever persisted), so a step blocked today by the daily cap or a not-yet-granted consent is
 * re-evaluated, and can still send, on a later run — only `already-sent` and `exited` are ever
 * permanent, and both are recomputed from real rows every time, never cached.
 */
export function decideStep(step: ProgrammeStep, ctx: StepEvalContext): StepDecision {
  if (ctx.alreadySent) return { action: 'skip', reason: 'already-sent' }

  const dueAt = ctx.triggeredAt.getTime() + step.delayMinutes * 60_000
  if (ctx.now.getTime() < dueAt) return { action: 'wait' }

  if (
    ctx.exitedAt != null &&
    ctx.exitedAt.getTime() >= ctx.triggeredAt.getTime() &&
    ctx.exitedAt.getTime() <= ctx.now.getTime()
  ) {
    return { action: 'skip', reason: 'exited' }
  }

  if (step.category != null) {
    if (ctx.dailyCapReached) return { action: 'skip', reason: 'daily-cap' }
    if (ctx.canMarket === false) return { action: 'skip', reason: 'not-consented' }
  }

  return { action: 'send' }
}
