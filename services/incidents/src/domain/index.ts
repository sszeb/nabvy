// Pure logic: no I/O, no database, no clock or randomness passed in implicitly.
import { type AppError, type EventEnvelope, err, ok, type Result } from '@nabvy/contracts'
import type {
  IncidentsRecordDeadLetterInput,
  IncidentsRow,
} from '@nabvy/contracts/modules/incidents'

/** The row `record()` writes, derived from the task wrapper's input. */
export interface DeadLetterRow {
  eventType: string
  eventKey: string
  payload: EventEnvelope
  error: AppError
  attempts: number
  firstFailedAt: Date
}

export function toDeadLetterRow(input: IncidentsRecordDeadLetterInput): DeadLetterRow {
  return {
    eventType: input.envelope.type,
    eventKey: input.envelope.key,
    payload: input.envelope,
    error: input.error,
    attempts: input.attempts,
    firstFailedAt: new Date(input.firstFailedAt),
  }
}

/** Whether an incident may be retried: it must exist and still be open. */
export function checkRetryable(row: IncidentsRow | undefined): Result<IncidentsRow, AppError> {
  if (!row) return err({ code: 'incidents.not-found', message: 'no incident with that id' })
  if (row.resolvedAt) {
    return err({ code: 'incidents.already-resolved', message: 'incident is already resolved' })
  }
  return ok(row)
}
