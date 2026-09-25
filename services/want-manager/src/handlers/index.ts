// Event handlers of the want-manager module: thin (parse, call, return).
import { WANT_MANAGER_PURGE_BATCH } from '@nabvy/config/modules/want-manager'
import { AccountDeletedEvent } from '@nabvy/contracts/modules/account'
import type { Queryable } from '@nabvy/db'
import { deleteUsersRows } from '../repo'

/**
 * `account.deleted` v1, a batch of payloads: purges the users' wants, criteria and preferences
 * (rule 12 of docs/design/modules/_rules.md; docs/security.md, "Account deletion"). Runs inside
 * withPipeline. Safe to run twice: a second run finds nothing to delete. Whatever the switch says:
 * a purge is owed to the user, not a feature that "off" withholds.
 */
export async function onAccountDeleted(q: Queryable, payloads: unknown[]): Promise<void> {
  const userIds = [...new Set(payloads.map((payload) => AccountDeletedEvent.parse(payload).userId))]
  for (let i = 0; i < userIds.length; i += WANT_MANAGER_PURGE_BATCH) {
    await deleteUsersRows(q, userIds.slice(i, i + WANT_MANAGER_PURGE_BATCH))
  }
}
