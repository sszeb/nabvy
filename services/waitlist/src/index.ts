// Public API of the waitlist module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/waitlist' only, never from its internals.
import { ok, type Result } from '@nabvy/contracts'
import type { WaitlistEntry, WaitlistError } from '@nabvy/contracts/modules/waitlist'
import type { Queryable } from '@nabvy/db'
import { checkSwitch, failure, planEntry, toEntry, type WaitlistContext } from './domain'
import { consumeSubmitQuota, insertEntry, selectAll } from './repo'

export type {
  WaitlistEntry,
  WaitlistError,
  WaitlistErrorCode,
  WaitlistSubmitInput,
} from '@nabvy/contracts/modules/waitlist'
export { events, module } from '@nabvy/contracts/modules/waitlist'
export type { WaitlistContext } from './domain'
export { InMemoryWaitlistSender, type WaitlistSender } from './sender'

/**
 * What `submit()` returns: nothing about the address it was called with. A public form must not
 * tell a caller who typed someone else's address whether that address was new or already on the
 * list, or leak the first submitter's postcode, wanted products or UTM (PR #31 review). Callers
 * that need the stored data read it back through `list()` with the pipeline role.
 */
export interface WaitlistJoined {
  joined: true
}

/**
 * Adds an entry to the waitlist, or silently leaves an existing one for the same address
 * untouched (module card, "Tests and fixtures": one row per address, `docs/questions.md`,
 * "waitlist: repeat sign-ups"). Fails closed while the switch is off (`waitlist.closed`, module
 * card "When off": the form is closed) and rate limits per IP (`waitlist.rate_limited`,
 * `docs/security.md`). `ctx.ip` is the caller's address, as the calling procedure resolved it;
 * this module never reads a request object itself. The result never reveals whether the address
 * was already on the list, and never reads back the stored row.
 */
export async function submit(
  db: Queryable,
  input: unknown,
  ctx: WaitlistContext & { ip: string },
): Promise<Result<WaitlistJoined, WaitlistError>> {
  const on = checkSwitch(ctx)
  if (!on.ok) return on
  const withinQuota = await consumeSubmitQuota(db, ctx.ip)
  if (!withinQuota) {
    return failure('waitlist.rate_limited', 'Too many waitlist submissions from this address.')
  }
  const planned = planEntry(input)
  if (!planned.ok) return planned
  await insertEntry(db, planned.value)
  return ok({ joined: true })
}

/** Every entry, as `v_waitlist` shows it. Needs the pipeline role; empty while the switch is off. */
export async function list(db: Queryable): Promise<WaitlistEntry[]> {
  return (await selectAll(db)).map(toEntry)
}
