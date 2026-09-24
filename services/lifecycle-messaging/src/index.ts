// Public API of the lifecycle-messaging module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/lifecycle-messaging' only, never from its internals.

import {
  LIFECYCLE_MESSAGING_BATCH_SIZE,
  LIFECYCLE_MESSAGING_DAILY_MARKETING_CAP,
  LIFECYCLE_MESSAGING_TRIGGER_LOOKBACK_DAYS,
} from '@nabvy/config/modules/lifecycle-messaging'
import type { ProductEventsName } from '@nabvy/contracts/modules/product-events'
import type { Queryable } from '@nabvy/db'
import { canMarket } from '@nabvy/marketing-consent'
import { isOn } from '@nabvy/switches'
import {
  decideStep,
  isMarketingStep,
  PROGRAMMES,
  type ProgrammeDefinition,
  renderCopy,
} from './domain'
import type { TriggerOccurrence } from './repo'
import * as repo from './repo'
import {
  type EmailResolver,
  InMemoryEmailResolver,
  InMemoryPostHogWorkflowsClient,
  InMemoryResendClient,
  type PostHogWorkflowsClient,
  type ResendClient,
} from './send-clients'

export { events, module } from '@nabvy/contracts/modules/lifecycle-messaging'
export {
  categoryOf,
  isMarketingStep,
  PROGRAMMES,
  type ProgrammeDefinition,
  type ProgrammeStep,
  programmeById,
} from './domain'
export { type AccountDeletedDeps, accountDeletedHandler } from './handlers'
export {
  type EmailResolver,
  InMemoryEmailResolver,
  InMemoryPostHogWorkflowsClient,
  InMemoryResendClient,
  type LifecycleMessage,
  type PostHogWorkflowsClient,
  type ResendClient,
} from './send-clients'

export interface RunDeps {
  resend?: ResendClient
  workflows?: PostHogWorkflowsClient
  emailResolver?: EmailResolver
  now?: Date
}

export interface RunResult {
  evaluated: number
  sent: number
  skipped: Record<string, number>
}

/** Parts of a date in Europe/London (same approach as `services/spend-governor/src/domain/index.ts`). */
function londonParts(date: Date): { year: number; month: number; day: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') }
}

/** Midnight in London on the calendar day `at` falls in, as an instant (London is UTC+0 or UTC+1). */
const startOfLondonDay = (at: Date): Date => {
  const { year, month, day } = londonParts(at)
  const utcMidnight = Date.UTC(year, month - 1, day)
  const offsetHours = londonParts(new Date(utcMidnight)).hour
  return new Date(utcMidnight - offsetHours * 3_600_000)
}

const bump = (counts: Record<string, number>, key: string): void => {
  counts[key] = (counts[key] ?? 0) + 1
}

async function occurrencesForProgramme(
  q: Queryable,
  programme: ProgrammeDefinition,
  now: Date,
): Promise<TriggerOccurrence[]> {
  if (programme.trigger.kind === 'event') {
    const lookbackDays = LIFECYCLE_MESSAGING_TRIGGER_LOOKBACK_DAYS[programme.id] ?? 21
    const since = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000)
    return repo.selectRecentTriggerOccurrences(
      q,
      programme.trigger.event,
      since,
      LIFECYCLE_MESSAGING_BATCH_SIZE,
    )
  }
  const candidates = await repo.selectLastActivityCandidates(
    q,
    programme.trigger.events,
    LIFECYCLE_MESSAGING_BATCH_SIZE,
  )
  const thresholdMs = programme.trigger.days * 24 * 60 * 60 * 1000
  return candidates.filter((c) => now.getTime() - c.triggeredAt.getTime() >= thresholdMs)
}

/** Numbers this module can actually derive for a step's copy (`src/domain/copy.ts`). */
async function numbersFor(
  q: Queryable,
  programme: ProgrammeDefinition,
  occurrence: TriggerOccurrence,
): Promise<Record<string, number>> {
  if (programme.id === 'activation' || programme.id === 'trial') {
    const watched: ProductEventsName[] = ['alert_delivered', 'alert_opened']
    const counts = await repo.selectEventCounts(
      q,
      occurrence.userId,
      watched,
      occurrence.triggeredAt,
    )
    return { alertsDelivered: counts.alert_delivered ?? 0, alertsOpened: counts.alert_opened ?? 0 }
  }
  if (programme.id === 'cap-reached') {
    const properties = await repo.selectEventProperties(
      q,
      occurrence.userId,
      'usage_refused',
      occurrence.triggeredAt,
    )
    const balanceAfter = properties?.balanceAfter
    return { balanceAfterPence: typeof balanceAfter === 'number' ? balanceAfter : 0 }
  }
  return {}
}

/**
 * Runs every programme once: finds candidates from `product_events.v_events`, decides each step
 * (`src/domain/decide.ts`), and sends the ones that are due. Off (rule 11): acknowledges and
 * writes nothing. Safe to call repeatedly (idempotent per `(userId, programme, step, triggeredAt)`,
 * rule 8) — the scheduled task in `trigger/lifecycle-messaging-run.ts` calls this on a timer.
 */
export async function run(q: Queryable, deps: RunDeps = {}): Promise<RunResult> {
  const result: RunResult = { evaluated: 0, sent: 0, skipped: {} }
  if (!(await isOn(q, 'lifecycle-messaging'))) return result

  const now = deps.now ?? new Date()
  const resend = deps.resend ?? new InMemoryResendClient()
  const workflows = deps.workflows ?? new InMemoryPostHogWorkflowsClient()
  const emailResolver = deps.emailResolver ?? new InMemoryEmailResolver()
  const dayStart = startOfLondonDay(now)
  const marketingSentToday = new Map<string, number>()

  const marketingCountToday = async (userId: string): Promise<number> => {
    const cached = marketingSentToday.get(userId)
    if (cached !== undefined) return cached
    const rows = await repo.selectRunsSince(q, [userId], dayStart)
    const count = rows.filter((r) => isMarketingStep(r.programme, r.step)).length
    marketingSentToday.set(userId, count)
    return count
  }

  for (const programme of PROGRAMMES) {
    const occurrences = await occurrencesForProgramme(q, programme, now)
    if (occurrences.length === 0) continue

    // Batched per programme (rule 9), not per occurrence: re-engagement's exit is "any activity"
    // (docs/marketing.md), its own `exitEvents` empty, which `selectEarliestEventAfter` reads as
    // "match any event" (repo.ts).
    const anchors = new Map(occurrences.map((o) => [o.userId, o.triggeredAt]))
    const [exitedAtByUser, displayNames] = await Promise.all([
      repo.selectEarliestEventAfter(q, anchors, programme.exitEvents),
      repo.selectDisplayNames(q, [...anchors.keys()]),
    ])

    for (const occurrence of occurrences) {
      const alreadySent = await repo.selectAlreadySent(q, programme.id, occurrence.userId)
      const exitedAt = exitedAtByUser.get(occurrence.userId) ?? null
      for (const step of programme.steps) {
        result.evaluated += 1
        const sentKey = `${step.key}|${occurrence.triggeredAt.toISOString()}`
        if (alreadySent.has(sentKey)) {
          bump(result.skipped, 'already-sent')
          continue
        }
        const dueAt = occurrence.triggeredAt.getTime() + step.delayMinutes * 60_000
        if (now.getTime() < dueAt) {
          bump(result.skipped, 'wait')
          continue
        }

        const email = await emailResolver.resolve(occurrence.userId)
        if (email == null) {
          bump(result.skipped, 'no-email')
          continue
        }

        const canMarketResult =
          step.category != null
            ? await canMarket(q, { userId: occurrence.userId, email, category: step.category })
            : null
        const dailyCapReached =
          step.category != null
            ? (await marketingCountToday(occurrence.userId)) >=
              LIFECYCLE_MESSAGING_DAILY_MARKETING_CAP
            : false

        const decision = decideStep(step, {
          now,
          triggeredAt: occurrence.triggeredAt,
          exitedAt,
          alreadySent: false,
          canMarket: canMarketResult,
          dailyCapReached,
        })
        if (decision.action !== 'send') {
          bump(result.skipped, decision.action === 'wait' ? 'wait' : decision.reason)
          continue
        }

        const numbers = await numbersFor(q, programme, occurrence)
        const message = renderCopy(programme.id, step.key, {
          displayName: displayNames.get(occurrence.userId) ?? null,
          numbers,
        })

        await resend.send({
          userId: occurrence.userId,
          email,
          programme: programme.id,
          step: step.key,
          ...message,
        })
        await workflows.recordStepRun({
          userId: occurrence.userId,
          programme: programme.id,
          step: step.key,
          at: now.toISOString(),
        })
        await repo.insertRun(q, {
          userId: occurrence.userId,
          programme: programme.id,
          step: step.key,
          triggeredAt: occurrence.triggeredAt,
          at: now,
        })
        if (step.category != null) {
          marketingSentToday.set(
            occurrence.userId,
            (await marketingCountToday(occurrence.userId)) + 1,
          )
        }
        result.sent += 1
      }
    }
  }
  return result
}

/** Erases this module's rows for one deleted user; called by `accountDeletedHandler` (`./handlers`). */
export async function purgeUser(q: Queryable, userId: string): Promise<void> {
  await repo.purgeUser(q, userId)
}
