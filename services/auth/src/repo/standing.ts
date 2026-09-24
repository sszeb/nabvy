import { Uuid } from '@nabvy/contracts'
import type { Queryable } from '@nabvy/db'
import { sql } from 'drizzle-orm'
import { AccountRestrictedError } from '../domain/errors'

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

/** Throws `AccountRestrictedError` (the vague notice only) unless the account is active. */
export async function assertAccountActive(db: Queryable, userId: string): Promise<void> {
  if (!(await isAccountActive(db, userId))) throw new AccountRestrictedError()
}
