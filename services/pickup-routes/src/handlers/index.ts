// Event handlers of the pickup-routes module: thin (parse, call, return).
import { AccountDeletedEvent } from '@nabvy/contracts/modules/account'
import type { Queryable } from '@nabvy/db'
import { deleteUsersRows } from '../repo'

/**
 * `account.deleted` v1, a batch of payloads: purges the users' pickups, reminders, days, plans
 * and planner defaults (rule 12 of docs/design/modules/_rules.md; search-map-routes.md §7.9).
 * Runs as the pipeline whatever the switch says: a deletion is never paused. Safe to run twice.
 */
export async function onAccountDeleted(q: Queryable, payloads: unknown[]): Promise<void> {
  const userIds = [...new Set(payloads.map((payload) => AccountDeletedEvent.parse(payload).userId))]
  await deleteUsersRows(q, userIds)
}
