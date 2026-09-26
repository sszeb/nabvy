import { Uuid } from '@nabvy/contracts'
import {
  SwitchesAllowList,
  SwitchesKind,
  SwitchesName,
  SwitchesState,
} from '@nabvy/contracts/modules/switches'
import { withPipeline } from '@nabvy/db'
import { retry as retryIncidentFn } from '@nabvy/incidents'
import { readAdvice as readAdviceFn, readBudgets as readBudgetsFn } from '@nabvy/spend-governor'
import { list as listSwitchesFn, set as setSwitchFn } from '@nabvy/switches'
import { z } from 'zod'
import { adminProcedure } from '../context'

// `SwitchesSetInput` (packages/contracts/src/modules/switches.ts) carries two `.refine()`s,
// which Zod 4 does not allow `.omit()` on, so the client-facing shape (everything but
// `actorUserId`, which comes from the session) is declared separately, with the same two rules.
const SetSwitchClientInput = z
  .strictObject({
    name: SwitchesName,
    kind: SwitchesKind,
    state: SwitchesState,
    allowList: SwitchesAllowList.optional(),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .refine((s) => s.kind === 'module' || s.state !== 'shadow', {
    message: 'only a module can be in shadow',
    path: ['state'],
  })
  .refine((s) => s.kind === 'gate' || s.allowList === undefined, {
    message: 'only a gate has an allow-list',
    path: ['allowList'],
  })

/** `services/switches` `set_switch` path with audit (task L1). Runs as `nabvy_pipeline`
 * (`withPipeline`), following `set()`'s own doc comment: the caller passes the transaction so
 * the change and its audit row commit together. This task does not publish `switches.changed`
 * (the transport layer arrives with L2, `docs/backlog.md` "Milestone L"): recorded in
 * docs/questions/L1-web.md. */
export const listSwitches = adminProcedure.handler(() => withPipeline((tx) => listSwitchesFn(tx)))

export const setSwitch = adminProcedure
  .input(SetSwitchClientInput)
  .handler(({ input, context }) =>
    withPipeline((tx) => setSwitchFn(tx, { ...input, actorUserId: context.user.id })),
  )

/**
 * Spend caps, read-only (task L1). `@nabvy/spend-governor` exports no writer for a budget's
 * limit — only `recompute()` (pipeline-driven) and the two readers below — so there is no
 * audited path yet for an admin to change a cap from this screen. Recorded in
 * docs/questions/L1-web.md rather than reaching into the module's tables directly.
 */
export const readBudgets = adminProcedure.handler(() => withPipeline((tx) => readBudgetsFn(tx)))

export const readAdvice = adminProcedure.handler(() => withPipeline((tx) => readAdviceFn(tx)))

/**
 * Incidents, retry by ID (task L1). `@nabvy/incidents` exports no list function (only `record`
 * and `retry`), so there is no open-incidents table to show yet; an admin retries a specific
 * incident ID (from logs) instead. Recorded in docs/questions/L1-web.md.
 */
const RetryIncidentInput = z.object({ incidentId: Uuid })

export const retryIncident = adminProcedure
  .input(RetryIncidentInput)
  .handler(({ input }) => withPipeline((tx) => retryIncidentFn(tx, input.incidentId)))
