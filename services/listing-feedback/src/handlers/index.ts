// Event handlers of the listing-feedback module: thin (parse, call, return).
import { AccountDeletedEvent } from '@nabvy/contracts/modules/account'
import type { Queryable } from '@nabvy/db'
import { deleteUsersFeedback } from '../repo'

/**
 * `account.deleted` v1, a batch of payloads: purges the users' verdicts and states (rule 12 of
 * docs/design/modules/_rules.md). Safe to run twice: a second run finds nothing to delete.
 */
export async function onAccountDeleted(q: Queryable, payloads: unknown[]): Promise<void> {
  const userIds = [...new Set(payloads.map((payload) => AccountDeletedEvent.parse(payload).userId))]
  await deleteUsersFeedback(q, userIds)
}
