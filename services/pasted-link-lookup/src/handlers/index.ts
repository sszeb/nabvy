// Event handlers of the pasted-link-lookup module: thin (parse, call, return).
import { AccountDeletedEvent } from '@nabvy/contracts/modules/account'
import type { Queryable } from '@nabvy/db'
import { deleteUsersRequests } from '../repo'

/**
 * `account.deleted` v1, a batch of payloads: purges the users' requests (rule 12 of
 * docs/design/modules/_rules.md; docs/security.md, within 24 hours). Runs whatever the switch
 * says: a purge is never held back. Safe to run twice: a second run finds nothing to delete.
 */
export async function onAccountDeleted(q: Queryable, payloads: unknown[]): Promise<void> {
  const userIds = [...new Set(payloads.map((payload) => AccountDeletedEvent.parse(payload).userId))]
  await deleteUsersRequests(q, userIds)
}
