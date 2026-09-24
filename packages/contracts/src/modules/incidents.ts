import { z } from 'zod'
import {
  AppError,
  defineEvents,
  EventEnvelope,
  EventType,
  IdempotencyKey,
  IsoTimestamp,
  Uuid,
} from '../index'

// Contracts of the incidents module (docs/design/modules/incidents.md): the dead-letter record
// and its retry. Import from '@nabvy/contracts/modules/incidents'. Samples in
// fixtures/contracts/incidents/.

export const module = 'incidents'

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  'incidents.dead-lettered': { 1: z.object({ incidentIds: z.array(Uuid).min(1).max(500) }) },
})

/** Error codes `record()` and `retry()` raise, prefixed with the module's name. */
export const IncidentsErrorCode = z.enum(['incidents.not-found', 'incidents.already-resolved'])
export type IncidentsErrorCode = z.infer<typeof IncidentsErrorCode>

/**
 * What the task wrapper passes to `record()` once an event has failed all its retries
 * (docs/engineering.md, "Events and tasks": 3 attempts, 5 s / 30 s / 2 min). `envelope` is the
 * whole original event, kept so `retry()` can re-emit it unchanged; `firstFailedAt` is the time of
 * the first attempt, not of this call.
 */
export const RecordDeadLetterInput = z.strictObject({
  envelope: EventEnvelope,
  error: AppError,
  attempts: z.int().min(1),
  firstFailedAt: IsoTimestamp,
})
export type RecordDeadLetterInput = z.infer<typeof RecordDeadLetterInput>

/** A dead-letter row, as stored and as read from `v_open`. */
export const IncidentRow = z.strictObject({
  id: Uuid,
  eventType: EventType,
  eventKey: IdempotencyKey,
  payload: EventEnvelope,
  error: AppError,
  attempts: z.int().min(1),
  firstFailedAt: IsoTimestamp,
  resolvedAt: IsoTimestamp.nullable(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
})
export type IncidentRow = z.infer<typeof IncidentRow>

/** A `v_open` row: always unresolved, so it carries no `resolvedAt`. */
export const OpenIncident = IncidentRow.omit({ resolvedAt: true })
export type OpenIncident = z.infer<typeof OpenIncident>
