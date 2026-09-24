import { Uuid } from '@nabvy/contracts'
import { RestrictionPolicy, RestrictionStep } from '@nabvy/contracts/modules/auth'
import type { Queryable } from '@nabvy/db'
import { sql } from 'drizzle-orm'
import { AccountRestrictedError, UnauthenticatedError } from '../domain/errors'

/**
 * Whether a user's account may be acted for, for jobs and module functions that hold a user ID
 * but no request (docs/decisions.md, "Fair use, suspension and bans"). Runs on any connection
 * (nabvy_app inside withUser, nabvy_pipeline inside withPipeline) through
 * `better_auth.account_active`, which answers a boolean and nothing else. An unknown user is not
 * active.
 */
export async function isAccountActive(db: Queryable, userId: string): Promise<boolean> {
  const id = Uuid.parse(userId)
  const result = await db.execute<{ active: boolean }>(
    sql`select better_auth.account_active(${id}::uuid) as active`,
  )
  return result.rows[0]?.active === true
}

/**
 * Throws unless the account is active: `AccountRestrictedError` (the step and policy only, from
 * `better_auth.account_restriction`) for a restricted account, `UnauthenticatedError` for an
 * unknown one.
 */
export async function assertAccountActive(db: Queryable, userId: string): Promise<void> {
  if (await isAccountActive(db, userId)) return
  const id = Uuid.parse(userId)
  const result = await db.execute<{ step: string; policy: string }>(
    sql`select step, policy from better_auth.account_restriction(${id}::uuid)`,
  )
  const row = result.rows[0]
  if (!row) throw new UnauthenticatedError()
  throw new AccountRestrictedError(
    RestrictionStep.parse(row.step),
    RestrictionPolicy.parse(row.policy),
  )
}
