// Event handlers of the inventory module: thin (parse, call, return).
import { AccountDeletedEvent } from '@nabvy/contracts/modules/account'
import type { Queryable } from '@nabvy/db'
import { deleteUsersItems } from '../repo'

/**
 * `account.deleted` v1, a batch of payloads: purges the users' items (rule 12 of docs/design/
 * modules/_rules.md; docs/security.md, "Account deletion"). Safe to run twice: a second run finds
 * nothing to delete. Runs whatever the switch says: a purge is never held back by "off".
 */
export async function onAccountDeleted(q: Queryable, payloads: unknown[]): Promise<void> {
  const userIds = [...new Set(payloads.map((payload) => AccountDeletedEvent.parse(payload).userId))]
  await deleteUsersItems(q, userIds)
}
