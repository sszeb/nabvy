// Public API of the audit-log module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/audit-log' only, never from its internals.
import { uuidv7 } from '@nabvy/contracts'
import {
  AuditLogEntry,
  AuditLogListInput,
  type AuditLogRecordInput,
} from '@nabvy/contracts/modules/audit-log'
import type { Queryable } from '@nabvy/db'
import { AuditLogRefused, restrictedReadInput, toEntryRow } from './domain'
import { insertEntry, selectEntries } from './repo'

export { events, module } from '@nabvy/contracts/modules/audit-log'
export { AuditLogRefused } from './domain'

/**
 * Records one action: exactly one row per call. Call it with the transaction that performs the
 * action (`withUser(actorUserId, tx => …)` or `withPipeline`), so the action and its row commit
 * together. The audit log cannot be switched off: if the row cannot be written, this throws
 * `AuditLogRefused` and the caller's transaction, and so its action, rolls back.
 */
export async function record(q: Queryable, input: AuditLogRecordInput): Promise<{ id: string }> {
  const row = toEntryRow(input, uuidv7())
  try {
    await insertEntry(q, row)
  } catch (cause) {
    throw new AuditLogRefused('audit-log.unavailable', 'audit entry could not be written', {
      cause,
    })
  }
  return { id: row.id }
}

/** Records a developer's read session of one restricted view; the reason is required. */
export function recordRestrictedRead(
  q: Queryable,
  args: { actorUserId: string; view: string; reason: string },
): Promise<{ id: string }> {
  return record(q, restrictedReadInput(args))
}

/**
 * Lists entries, newest first, for the admin screen. The caller must already have checked that
 * the session is an admin's; the database grants `v_entries` to no application role yet.
 */
export async function listEntries(
  q: Queryable,
  input: AuditLogListInput,
): Promise<AuditLogEntry[]> {
  const rows = await selectEntries(q, AuditLogListInput.parse(input))
  return rows.map((row) => AuditLogEntry.parse(row))
}
