import { z } from 'zod'
import { EventEnvelope, IdempotencyKey } from './events'
import { UuidV7 } from './ids'
import { AppError } from './result'
import { IsoTimestamp } from './time'

/**
 * What crosses the boundary between the event runtime (Trigger.dev), the handler wrapper in
 * `@nabvy/transport` and the dead-letter store (`incidents`): docs/engineering.md, "Events and
 * tasks". The envelope itself is in ./events.
 */

/** Error codes the transport raises for a failed delivery. */
export const TransportErrorCode = z.enum([
  'transport.invalid_event', // the envelope parsed but its type, version or payload did not
  'transport.handler_threw', // the handler threw (a bug, per docs/engineering.md, "Errors")
  'transport.publish_failed', // the events the handler emitted could not be published
])
export type TransportErrorCode = z.infer<typeof TransportErrorCode>

/**
 * One delivery attempt as the runtime reports it. `firstAttemptAt` is when the first attempt
 * started, so a dead letter records when the failure began, not when it was given up.
 */
export const DeliveryAttempt = z
  .strictObject({
    attempt: z.int().min(1),
    maxAttempts: z.int().min(1),
    firstAttemptAt: IsoTimestamp,
  })
  .refine((a) => a.attempt <= a.maxAttempts, { message: 'attempt exceeds maxAttempts' })
export type DeliveryAttempt = z.infer<typeof DeliveryAttempt>

/**
 * An event that failed every attempt, as handed to the dead-letter store. `envelope` is the whole
 * original event, so it can be re-emitted unchanged. The same shape as `RecordDeadLetterInput`
 * in the incidents contracts (PR #19), which can alias this one.
 */
export const DeadLetter = z.strictObject({
  envelope: EventEnvelope,
  error: AppError,
  attempts: z.int().min(1),
  firstFailedAt: IsoTimestamp,
})
export type DeadLetter = z.infer<typeof DeadLetter>

/**
 * What a wrapped handler returns to the runtime (the task's output). A retryable failure is not
 * an outcome: the wrapper throws, and the runtime retries.
 */
export const HandledEvent = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('handled'),
    eventId: UuidV7,
    key: IdempotencyKey,
    at: IsoTimestamp,
    emitted: z.int().min(0),
  }),
  z.strictObject({
    status: z.literal('dead-lettered'),
    eventId: UuidV7,
    key: IdempotencyKey,
    error: AppError,
    attempts: z.int().min(1),
  }),
  z.strictObject({
    status: z.literal('rejected'),
    error: z.string(),
  }),
])
export type HandledEvent = z.infer<typeof HandledEvent>
