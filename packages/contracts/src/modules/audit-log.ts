import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'

// Contracts of the audit-log module (services/audit-log): what a caller records and what an
// entry looks like when an admin reads it. Import from '@nabvy/contracts/modules/audit-log'.
// Samples in fixtures/contracts/audit-log/.

export const module = 'audit-log'

/** `<module>.<what-happened>`, kebab case on both sides: `auth.role-changed`. */
export const AuditLogAction = z
  .string()
  .max(100)
  .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9]*(-[a-z0-9]+)*$/)
export type AuditLogAction = z.infer<typeof AuditLogAction>

/** What the action was taken on, as `<kind>:<id>`: `user:<uuid>`, `view:apify_gateway.v_x`. */
export const AuditLogTarget = z
  .string()
  .max(300)
  .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*:\S+$/)
export type AuditLogTarget = z.infer<typeof AuditLogTarget>

/** Why the actor did it. Required for restricted reads; optional elsewhere. */
export const AuditLogReason = z.string().trim().min(1).max(1000)

/** A before or after state: any JSON value, capped so a caller cannot dump a whole table. */
export const AUDIT_LOG_STATE_MAX_BYTES = 64 * 1024
const utf8 = new TextEncoder()
export const AuditLogState = z
  .json()
  .refine((value) => utf8.encode(JSON.stringify(value)).length <= AUDIT_LOG_STATE_MAX_BYTES, {
    message: `a before or after state is at most ${AUDIT_LOG_STATE_MAX_BYTES} bytes of JSON`,
  })

/**
 * A developer's read session of a restricted view (`v_restricted_*` or a seller-data table)
 * is recorded with this action, and the database refuses such a row without a reason.
 */
export const AUDIT_LOG_RESTRICTED_READ = 'audit-log.restricted-read'

const needsReason = (entry: { action: string; reason?: string | null }) =>
  entry.action !== AUDIT_LOG_RESTRICTED_READ || (entry.reason ?? '') !== ''
const reasonMessage = { message: 'a restricted read needs a reason', path: ['reason'] }

/** What a module or admin procedure passes to `record()`. The time is set by the database. */
export const AuditLogRecordInput = z
  .strictObject({
    actorUserId: Uuid,
    action: AuditLogAction,
    target: AuditLogTarget,
    before: AuditLogState.optional(),
    after: AuditLogState.optional(),
    reason: AuditLogReason.optional(),
  })
  .refine(needsReason, reasonMessage)
export type AuditLogRecordInput = z.infer<typeof AuditLogRecordInput>

/**
 * One row of `audit_log.v_entries`, as an admin reads it. Its shape follows the Drizzle view
 * declaration in packages/db/src/schema/audit-log.ts; services/audit-log/test/contracts.test.ts
 * fails if the two drift.
 */
export const AuditLogEntry = z
  .strictObject({
    id: Uuid,
    actorUserId: Uuid,
    action: AuditLogAction,
    target: AuditLogTarget,
    before: z.json().nullable(),
    after: z.json().nullable(),
    reason: z.string().nullable(),
    at: IsoTimestamp,
  })
  .refine(needsReason, reasonMessage)
export type AuditLogEntry = z.infer<typeof AuditLogEntry>

/**
 * Where a page resumes: the `at` and `id` of the last entry already seen. Entries written in one
 * transaction share one `at`, so the id breaks the tie; `at` is stored to the millisecond, the
 * precision of an ISO timestamp, so the pair round-trips exactly.
 */
export const AuditLogCursor = z.strictObject({ at: IsoTimestamp, id: Uuid })
export type AuditLogCursor = z.infer<typeof AuditLogCursor>

/** A page of entries, newest first (`at` then `id`, both descending). */
export const AuditLogListInput = z.strictObject({
  limit: z.number().int().min(1).max(500),
  before: AuditLogCursor.optional(),
  actorUserId: Uuid.optional(),
  target: AuditLogTarget.optional(),
})
export type AuditLogListInput = z.infer<typeof AuditLogListInput>

/**
 * `audit-log.invalid_entry`: the input failed `AuditLogRecordInput`.
 * `audit-log.unavailable`: the row could not be written. Either way the caller's action is
 * refused: `record()` throws, and the caller's transaction rolls back.
 */
export const AuditLogErrorCode = z.enum(['audit-log.invalid_entry', 'audit-log.unavailable'])
export type AuditLogErrorCode = z.infer<typeof AuditLogErrorCode>

/** The audit log publishes no events: callers write their row in their own transaction. */
export const events = defineEvents(module, {})
