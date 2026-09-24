// Public API of the source-health module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/source-health' only, never from its internals.
import { SOURCE_HEALTH_RAMP_STAGES } from '@nabvy/config/modules/source-health'
import type { SourceHealthRampStage } from '@nabvy/contracts/modules/source-health'
import type { Queryable } from '@nabvy/db'
import { state as switchState } from '@nabvy/switches'
import { rampStageAt } from './domain'
import { selectCurrentRamp } from './repo'

export type {
  SourceHealthAlertedEvent,
  SourceHealthAlertReason,
  SourceHealthDay,
  SourceHealthErrorCode,
  SourceHealthRampStage,
} from '@nabvy/contracts/modules/source-health'
export { events, module } from '@nabvy/contracts/modules/source-health'
export {
  alertedKey,
  assessRamp,
  handleRunCollected,
  onRunCollected,
  type RampAssessment,
  type RunCollectedResult,
} from './handlers'

const MODULE = 'source-health'

/**
 * The lowest ramp stage: the actor's most conservative starting point (card: "When off:
 * check-scheduler uses the lowest ramp stage").
 */
const LOWEST_STAGE: Omit<SourceHealthRampStage, 'advancedBy'> = {
  stage: 0,
  maxChecksPerDay: rampStageAt(SOURCE_HEALTH_RAMP_STAGES, 0).maxChecksPerDay,
  startedAt: new Date(0).toISOString(),
}

/**
 * The volume cap `check-scheduler` should use (card: "recommendRampStage"). While
 * `source-health` is off, or before the ramp has been seeded, this is the lowest stage
 * (docs/design/modules/source-health.md, "When off"). Rule 11: shadow behaves like on for this
 * module (no user-facing view), so only a true off (or an unreachable `switches`, which reads as
 * off) falls back.
 */
export async function recommendRampStage(q: Queryable): Promise<SourceHealthRampStage> {
  if ((await switchState(q, MODULE)) === 'off') return { ...LOWEST_STAGE, advancedBy: null }
  const current = await selectCurrentRamp(q)
  if (!current) return { ...LOWEST_STAGE, advancedBy: null }
  return {
    stage: current.stage,
    maxChecksPerDay: current.maxChecksPerDay,
    startedAt: current.startedAt.toISOString(),
    advancedBy: current.advancedBy,
  }
}
