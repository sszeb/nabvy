import {
  type AppError,
  DeadLetter,
  DeliveryAttempt,
  type EventEnvelope,
  EventEnvelope as EventEnvelopeSchema,
  type EventOf,
  type EventRegistry,
  type HandledEvent,
  type IsoTimestamp,
  isoNow,
  ModuleName,
  type Result,
  safeParseEvent,
  stamp,
  type TransportErrorCode,
  type TStampName,
  type TStamps,
} from '@nabvy/contracts'
import type { Publisher } from './publisher'

/**
 * Where an event goes once it has failed every attempt: the dead-letter table owned by
 * `incidents` (docs/engineering.md, "Events and tasks"). `record` returns the event incidents
 * wants published (`incidents.dead-lettered`), which the wrapper publishes. The incidents module's
 * `record(db, input)` satisfies this once the task file closes over its database handle.
 */
export interface DeadLetterSink {
  record(input: DeadLetter): Promise<{ event?: EventEnvelope }>
}

/** What a wrapped handler run needs from outside: injected, so tests need no credentials. */
export interface HandlerDeps {
  publisher: Publisher
  deadLetters: DeadLetterSink
  /** The clock for this hop's time; defaults to now. */
  now?: () => Date
}

export interface HandlerContext {
  /** The time of this hop: one value for the whole batch, used for stamps and `doneAt`. */
  readonly at: IsoTimestamp
  /** The incoming envelope's idempotency key. */
  readonly key: string
  readonly attempt: DeliveryAttempt
  /**
   * Sets this handler's declared T-stamp to `at`, keeping an earlier value (so a replay never
   * moves it). Throws if the handler declared no stamp: modules outside the T0–T7 chain store
   * `at` as their own `doneAt` instead (docs/design/modules/_rules.md, rule 10).
   */
  stamp(stamps: TStamps): TStamps
  /**
   * Queues events to publish once the handler succeeds. Build them with the module's own
   * `createEvent` and a key derived from the input, so a replay queues the same keys.
   */
  emit(...envelopes: EventEnvelope[]): void
}

type EventOfType<R extends EventRegistry, T extends string> = Extract<EventOf<R>, { type: T }>

export interface HandlerSpec<R extends EventRegistry, T extends keyof R['definitions'] & string> {
  /** The consuming module (its folder under services/). */
  consumer: string
  /** The producer's registry, from `@nabvy/contracts/modules/<producer>`. */
  registry: R
  type: T
  /** The hop stamp this stage owns, if it is in the T0–T7 chain. */
  stamp?: TStampName
  /**
   * The work: load what the IDs point at, write with upserts keyed on
   * `source + sourceListingId + contentHash` (so running twice writes nothing new), and return
   * `ok` or an expected failure. Every failure is retried, then dead-lettered.
   */
  handle(event: EventOfType<R, T>, ctx: HandlerContext): Promise<Result<void>>
}

export interface EventHandler {
  readonly consumer: string
  readonly type: string
  readonly stamp?: TStampName
  /**
   * Runs one delivery. Returns an outcome, or throws to ask the runtime for another attempt:
   * handler failures before the last attempt throw; on the last attempt they are dead-lettered.
   */
  run(raw: unknown, attempt: DeliveryAttempt, deps: HandlerDeps): Promise<HandledEvent>
}

/** Thrown to hand a failed attempt back to the runtime for a retry. */
export class RetryableEventError extends Error {
  constructor(readonly error: AppError) {
    super(`${error.code}: ${error.message}`)
    this.name = 'RetryableEventError'
  }
}

const transportError = (code: TransportErrorCode, message: string): AppError => ({ code, message })

async function attemptHandler<R extends EventRegistry, T extends keyof R['definitions'] & string>(
  spec: HandlerSpec<R, T>,
  event: EventOfType<R, T>,
  ctx: HandlerContext,
): Promise<Result<void>> {
  try {
    return await spec.handle(event, ctx)
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown)
    return { ok: false, error: transportError('transport.handler_threw', message) }
  }
}

/**
 * Wraps a module's handler for the runtime: validates the envelope against the producer's
 * registry, gives the handler its hop time and stamp, publishes what it emits only after it
 * succeeds, retries failures through the runtime and dead-letters them on the last attempt.
 * A Trigger.dev task file calls `run` and nothing else (trigger/README.md).
 */
export function defineHandler<R extends EventRegistry, T extends keyof R['definitions'] & string>(
  spec: HandlerSpec<R, T>,
): EventHandler {
  ModuleName.parse(spec.consumer)
  if (!spec.registry.definitions[spec.type]) {
    throw new Error(`${spec.consumer}: ${spec.registry.module} declares no event "${spec.type}"`)
  }

  const deadLetter = async (
    envelope: EventEnvelope,
    error: AppError,
    attempt: DeliveryAttempt,
    deps: HandlerDeps,
  ): Promise<HandledEvent> => {
    const input = DeadLetter.parse({
      envelope,
      error,
      attempts: attempt.attempt,
      firstFailedAt: attempt.firstAttemptAt,
    })
    const { event } = await deps.deadLetters.record(input)
    if (event) await deps.publisher.publish([event])
    return {
      status: 'dead-lettered',
      eventId: envelope.id,
      key: envelope.key,
      error,
      attempts: attempt.attempt,
    }
  }

  return {
    consumer: spec.consumer,
    type: spec.type,
    stamp: spec.stamp,
    async run(raw, rawAttempt, deps) {
      const attempt = DeliveryAttempt.parse(rawAttempt)
      const envelope = EventEnvelopeSchema.safeParse(raw)
      // Without a valid envelope there is nothing to key or re-emit: a producer bug, reported
      // in the run's output rather than retried.
      if (!envelope.success) return { status: 'rejected', error: envelope.error.message }

      const parsed = safeParseEvent(spec.registry, raw)
      if (!parsed.success || parsed.data.type !== spec.type) {
        // Retrying cannot fix a wrong type or payload, so it is dead-lettered at once.
        const message = parsed.success
          ? `${spec.consumer} handles ${spec.type}, got ${parsed.data.type}`
          : parsed.error
        return deadLetter(
          envelope.data,
          transportError('transport.invalid_event', message),
          attempt,
          deps,
        )
      }

      const at = isoNow(deps.now?.() ?? new Date())
      const outbox: EventEnvelope[] = []
      const ctx: HandlerContext = {
        at,
        key: envelope.data.key,
        attempt,
        stamp(stamps) {
          if (!spec.stamp) throw new Error(`${spec.consumer}: ${spec.type} handler has no stamp`)
          return stamp(stamps, spec.stamp, at)
        },
        emit: (...envelopes) => {
          outbox.push(...envelopes.map((e) => EventEnvelopeSchema.parse(e)))
        },
      }

      let result = await attemptHandler(spec, parsed.data as EventOfType<R, T>, ctx)
      if (result.ok && outbox.length > 0) {
        try {
          await deps.publisher.publish(outbox)
        } catch (thrown) {
          const message = thrown instanceof Error ? thrown.message : String(thrown)
          result = { ok: false, error: transportError('transport.publish_failed', message) }
        }
      }
      if (result.ok) {
        return {
          status: 'handled',
          eventId: envelope.data.id,
          key: envelope.data.key,
          at,
          emitted: outbox.length,
        }
      }
      if (attempt.attempt < attempt.maxAttempts) throw new RetryableEventError(result.error)
      return deadLetter(envelope.data, result.error, attempt, deps)
    },
  }
}
