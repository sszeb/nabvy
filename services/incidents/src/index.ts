// Public API of the incidents module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/incidents' only, never from its internals.
import { type AppError, createEvent, err, ok, type Result, Uuid } from '@nabvy/contracts'
import {
  events,
  IncidentsRecordDeadLetterInput,
  type IncidentsRow,
} from '@nabvy/contracts/modules/incidents'
import type { Queryable } from '@nabvy/db'
import { checkRetryable, toDeadLetterRow } from './domain'
import { findById, markResolved, upsertOpen } from './repo'

export type {
  IncidentsErrorCode,
  IncidentsOpenIncident,
  IncidentsRecordDeadLetterInput,
  IncidentsRow,
} from '@nabvy/contracts/modules/incidents'
export { events, module } from '@nabvy/contracts/modules/incidents'

/**
 * Called by the task wrapper once an event has failed all its retries (docs/engineering.md,
 * "Events and tasks": 3 attempts, 5 s / 30 s / 2 min), never by the module on its own. Idempotent:
 * replaying the same envelope reopens the same row instead of creating another (unique on
 * `(event_type, event_key)`). Builds, but does not publish, the `incidents.dead-lettered` event:
 * this module has no transport wiring yet (the Trigger.dev task layer is a later task,
 * `docs/questions.md`); the caller is expected to emit the returned event once that layer exists.
 */
export async function record(db: Queryable, input: IncidentsRecordDeadLetterInput) {
  const parsed = IncidentsRecordDeadLetterInput.parse(input)
  const incident = await upsertOpen(db, toDeadLetterRow(parsed))
  const event = createEvent(
    events,
    'incidents.dead-lettered',
    1,
    { incidentIds: [incident.id] },
    { key: incident.eventKey },
  )
  return { incident, event }
}

/**
 * An admin retry: reconstructs the original event envelope and marks the incident resolved.
 * Returns the envelope for the caller to re-emit; incidents never retries on its own
 * (docs/design/modules/incidents.md, "Does / does not").
 *
 * Ordering caveat (PR #19 review): this resolves the incident before the caller has actually
 * re-sent the envelope. If the caller fails to re-emit it after `retry()` returns, the event is
 * lost, because the incident cannot be retried a second time once resolved. There is no
 * transaction spanning both steps today, because there is nowhere to publish an envelope to yet
 * (see `record()`'s note on the transport layer). Once that layer exists, its caller should
 * either wrap `retry()` and the re-emit in one transaction, or resolve only after the re-emit
 * succeeds, rather than up front as here.
 */
export async function retry(
  db: Queryable,
  incidentId: string,
): Promise<Result<{ envelope: IncidentsRow['payload'] }, AppError>> {
  const id = Uuid.parse(incidentId)
  const retryable = checkRetryable(await findById(db, id))
  if (!retryable.ok) return retryable
  const resolved = await markResolved(db, id, new Date())
  if (!resolved) {
    return err({ code: 'incidents.already-resolved', message: 'incident is already resolved' })
  }
  return ok({ envelope: resolved.payload })
}
