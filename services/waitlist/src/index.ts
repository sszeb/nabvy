// Public API of the waitlist module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/waitlist' only, never from its internals.
import { ok, type Result } from '@nabvy/contracts'
import type { WaitlistEntry, WaitlistError } from '@nabvy/contracts/modules/waitlist'
import type { Queryable } from '@nabvy/db'
import { checkSwitch, failure, planEntry, toEntry, type WaitlistContext } from './domain'
import { consumeSubmitQuota, selectAll, upsertEntry } from './repo'

export type {
  WaitlistEntry,
  WaitlistError,
  WaitlistErrorCode,
  WaitlistSubmitInput,
} from '@nabvy/contracts/modules/waitlist'
export { events, module } from '@nabvy/contracts/modules/waitlist'
export type { WaitlistContext } from './domain'
export { InMemoryWaitlistSender, type WaitlistSender } from './sender'

/** What `submit()` returns: the stored entry, and whether this call created it. */
export interface WaitlistSubmission {
  entry: WaitlistEntry
  created: boolean
}

/**
 * Adds an entry to the waitlist, or returns the caller's existing one unchanged for a repeat
 * address (module card, "Tests and fixtures": "an entry lands with its UTM"). Fails closed while
 * the switch is off (`waitlist.closed`, module card "When off": the form is closed) and rate
 * limits per IP (`waitlist.rate_limited`, `docs/security.md`). `ctx.ip` is the caller's address, as
 * the calling procedure resolved it; this module never reads a request object itself.
 */
export async function submit(
  db: Queryable,
  input: unknown,
  ctx: WaitlistContext & { ip: string },
): Promise<Result<WaitlistSubmission, WaitlistError>> {
  const on = checkSwitch(ctx)
  if (!on.ok) return on
  const withinQuota = await consumeSubmitQuota(db, ctx.ip)
  if (!withinQuota) {
    return failure('waitlist.rate_limited', 'Too many waitlist submissions from this address.')
  }
  const planned = planEntry(input)
  if (!planned.ok) return planned
  const { row, created } = await upsertEntry(db, planned.value)
  return ok({ entry: toEntry(row), created })
}

/** Every entry, as `v_waitlist` shows it. Needs the pipeline role; empty while the switch is off. */
export async function list(db: Queryable): Promise<WaitlistEntry[]> {
  return (await selectAll(db)).map(toEntry)
}
