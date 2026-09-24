// Pure logic: no I/O, no database, no clock or randomness passed in implicitly.
import {
  AUDIT_LOG_RESTRICTED_READ,
  type AuditLogErrorCode,
  AuditLogRecordInput,
} from '@nabvy/contracts/modules/audit-log'

/** Thrown by `record()`: the caller's action is refused and its transaction rolls back. */
export class AuditLogRefused extends Error {
  constructor(
    readonly code: AuditLogErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'AuditLogRefused'
  }
}

/** The row `record()` writes, before the database adds `at`. */
export interface EntryRow {
  id: string
  actorUserId: string
  action: string
  target: string
  before: unknown
  after: unknown
  reason: string | null
}

/**
 * Validates a caller's input and turns it into one row. An absent before or after state is stored
 * as SQL null. Throws `AuditLogRefused('audit-log.invalid_entry')` on bad input.
 */
export function toEntryRow(input: unknown, id: string): EntryRow {
  const parsed = AuditLogRecordInput.safeParse(input)
  if (!parsed.success) {
    throw new AuditLogRefused(
      'audit-log.invalid_entry',
      `audit entry refused: ${parsed.error.message}`,
    )
  }
  const entry = parsed.data
  return {
    id,
    actorUserId: entry.actorUserId,
    action: entry.action,
    target: entry.target,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
  }
}

/** The input for a developer's read session of one restricted view, with its reason. */
export function restrictedReadInput(args: {
  actorUserId: string
  view: string
  reason: string
}): AuditLogRecordInput {
  return {
    actorUserId: args.actorUserId,
    action: AUDIT_LOG_RESTRICTED_READ,
    target: `view:${args.view}`,
    reason: args.reason,
  }
}
