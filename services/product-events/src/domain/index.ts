// Pure logic: no I/O, no database, no clock or randomness passed in implicitly.
import { err, ok, type Result } from '@nabvy/contracts'
import {
  type ProductEventsError,
  type ProductEventsErrorCode,
  ProductEventsEvent,
  type ProductEventsSwitchState,
} from '@nabvy/contracts/modules/product-events'

export interface ProductEventsContext {
  state: ProductEventsSwitchState
}

export const failure = (
  code: ProductEventsErrorCode,
  message: string,
): Result<never, ProductEventsError> => err({ code, message })

/**
 * Whether `track()` should record and forward at all. Unlike a refusal, an `off` switch is not an
 * error: `track()` returns `{ recorded: false, forwarded: false }`, because an instrumentation
 * call must never fail the action it is timing (module card, "When off": "nothing recorded;
 * features unaffected"). This module has no user-facing view for `shadow` to hide rows from
 * (module card, "Views": "internal v_events. User-facing: none"), so `shadow` and `on` both
 * record and both forward (services/product-events/README.md, "Decisions").
 */
export function isRecording(ctx: ProductEventsContext): boolean {
  return ctx.state !== 'off'
}

/** The row the repo layer writes, once the input has passed the property allowlist. */
export interface EventInsert {
  event: string
  properties: Record<string, unknown>
}

/**
 * Validates `track()`'s input against `ProductEventsEvent`, the property allowlist
 * (`docs/analytics.md:15`): a known event name carrying exactly the properties declared for it,
 * and nothing else. Defence in depth: the calling procedure or task validates first (`CLAUDE.md`,
 * "No database access from the browser"), and `@nabvy/telemetry`'s own `capture()` validates
 * again before anything reaches PostHog.
 */
export function planTrack(input: unknown): Result<EventInsert, ProductEventsError> {
  const parsed = ProductEventsEvent.safeParse(input)
  if (!parsed.success) {
    return failure('product-events.invalid_input', `event refused: ${parsed.error.message}`)
  }
  return ok({ event: parsed.data.event, properties: parsed.data.properties })
}
