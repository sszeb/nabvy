// setStanding()'s own implementation, kept apart from index.ts so the dependency seam it needs for
// testing (deps.restrictAccount/liftRestriction) is never part of '@nabvy/account''s public
// surface: index.ts's exported setStanding() parses its input and always calls setStandingWith()
// with the real @nabvy/auth functions. Tests import setStandingWith directly from this file, the
// same way they already import domain/index.ts and repo/index.ts (services/account/README.md).
import { record } from '@nabvy/audit-log'
import type { liftRestriction, restrictAccount } from '@nabvy/auth'
import { createEvent, type EventEnvelope } from '@nabvy/contracts'
import {
  type AccountSetStandingInput,
  type AccountStanding,
  events,
} from '@nabvy/contracts/modules/account'
import type { Queryable } from '@nabvy/db'
import { planStandingChange, standingChangedKey } from './domain'
import * as repo from './repo'

export interface StandingDeps {
  restrictAccount: typeof restrictAccount
  liftRestriction: typeof liftRestriction
}

/**
 * Called only by `account-integrity` (automated) or an audited admin override, both inside
 * `withPipeline` (the same convention `switches.set()` uses; docs/questions.md, "w1 switches: who
 * may write a switch"). Enforcement (Better Auth's ban fields, session revocation, and the actual
 * admin-role check) runs through `deps.restrictAccount`/`deps.liftRestriction`; this call adds
 * only the fair-use limits and this module's own audit row. `input` must already be parsed
 * (`AccountSetStandingInput.parse`); this function trusts its shape.
 */
export async function setStandingWith(
  q: Queryable,
  input: AccountSetStandingInput,
  deps: StandingDeps,
): Promise<{ standing: AccountStanding; event: EventEnvelope }> {
  const plan = planStandingChange(input)

  if (plan.auth.kind === 'lift') {
    await deps.liftRestriction({
      actorUserId: input.actorUserId,
      userId: input.userId,
      reason: input.reason,
    })
  } else {
    await deps.restrictAccount({
      actorUserId: input.actorUserId,
      userId: input.userId,
      // input.policy is required for a non-active status (AccountSetStandingInput.refine).
      policy: input.policy as NonNullable<typeof input.policy>,
      until: plan.auth.until,
      reason: input.reason,
    })
  }

  const before = await repo.selectStanding(q, input.userId)
  const { id: actionId } = await record(q, {
    actorUserId: input.actorUserId,
    action: 'account.standing-changed',
    target: `user:${input.userId}`,
    ...(before
      ? {
          before: {
            status: before.status,
            until: before.until?.toISOString() ?? null,
            limits: (before.limits as Record<string, number> | null) ?? null,
          },
        }
      : {}),
    after: {
      status: plan.row.status,
      until: plan.row.until?.toISOString() ?? null,
      limits: plan.row.limits,
    },
    reason: input.reason,
  })

  const at = new Date()
  await repo.upsertStanding(q, {
    userId: input.userId,
    status: plan.row.status,
    until: plan.row.until,
    limits: plan.row.limits,
    actionId,
    at,
  })

  return {
    standing: {
      userId: input.userId,
      status: plan.row.status,
      until: plan.row.until?.toISOString() ?? null,
      limits: plan.row.limits,
      actionId,
      at: at.toISOString(),
    },
    event: createEvent(
      events,
      'account.standing-changed',
      1,
      { userId: input.userId },
      { key: standingChangedKey(input.userId, at) },
    ) as EventEnvelope,
  }
}
