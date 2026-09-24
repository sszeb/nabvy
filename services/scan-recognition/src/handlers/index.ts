// Event handlers of the scan-recognition module: thin (parse, call, return).
import { AccountDeletedEvent } from '@nabvy/contracts/modules/account'
import type { Queryable } from '@nabvy/db'
import { deleteUsersScans } from '../repo'

/**
 * `account.deleted` v1, a batch of payloads: deletes the users' scans within the 24 hours rule 12
 * allows, and returns the photo refs still stored so the caller's storage task deletes them.
 * Safe to run twice: a second run finds nothing to delete.
 */
export async function onAccountDeleted(
  q: Queryable,
  payloads: unknown[],
): Promise<{ photoRefs: string[] }> {
  const userIds = [...new Set(payloads.map((payload) => AccountDeletedEvent.parse(payload).userId))]
  return { photoRefs: await deleteUsersScans(q, userIds) }
}
