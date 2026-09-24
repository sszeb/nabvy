// Public API of the product-events module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/product-events' only, never from its internals.
import { getProfile } from '@nabvy/account'
import { ok, type Result, Uuid } from '@nabvy/contracts'
import type {
  ProductEventsError,
  ProductEventsTracked,
} from '@nabvy/contracts/modules/product-events'
import type { Queryable } from '@nabvy/db'
import { isRecording, type ProductEventsContext, planTrack } from './domain'
import { NoopProductEventsForwarder, type ProductEventsForwarder } from './forwarder'
import { insertEvent } from './repo'

export type {
  ProductEventsError,
  ProductEventsErrorCode,
  ProductEventsRecord,
  ProductEventsTracked,
} from '@nabvy/contracts/modules/product-events'
export { events, module } from '@nabvy/contracts/modules/product-events'
export type { ProductEventsContext } from './domain'
export {
  InMemoryProductEventsForwarder,
  NoopProductEventsForwarder,
  type ProductEventsForwarder,
} from './forwarder'

/**
 * Records one product event -- validated against the property allowlist -- and forwards it to
 * PostHog only when the user has consented (module card, "Does / does not"; `docs/analytics.md`).
 * Reads consent through `@nabvy/account`'s `getProfile()` (module card, "Inputs": `v_profiles`);
 * a user with no profile row yet is treated as not consented, the conservative default.
 *
 * Never refuses while the switch is off: it silently records and forwards nothing (module card,
 * "When off"), because an instrumentation call must never fail the action it is timing. The only
 * refusal is `product-events.invalid_input`, for an event name or property outside the allowlist.
 * `ctx.forwarder` defaults to a no-op; the web app or a task passes `@nabvy/telemetry`'s real
 * PostHog client, which this module does not import itself (README.md, "Decisions").
 */
export async function track(
  db: Queryable,
  userId: string,
  input: unknown,
  ctx: ProductEventsContext & { sessionId?: string; forwarder?: ProductEventsForwarder },
): Promise<Result<ProductEventsTracked, ProductEventsError>> {
  Uuid.parse(userId)
  if (!isRecording(ctx)) return ok({ recorded: false, forwarded: false })
  const planned = planTrack(input)
  if (!planned.ok) return planned
  await insertEvent(db, userId, planned.value, ctx.sessionId ?? null)
  const profile = await getProfile(db, userId)
  const hasConsent = profile?.analyticsConsent ?? false
  if (hasConsent) {
    await (ctx.forwarder ?? new NoopProductEventsForwarder()).capture(userId, true, planned.value)
  }
  return ok({ recorded: true, forwarded: hasConsent })
}
