// Pure logic: no I/O, no database, no clock or randomness passed in implicitly.
import { err, ok, type Result } from '@nabvy/contracts'
import {
  WaitlistEntry,
  type WaitlistError,
  type WaitlistErrorCode,
  WaitlistSubmitInput,
  type WaitlistSwitchState,
  type WaitlistUtm,
} from '@nabvy/contracts/modules/waitlist'

export interface WaitlistContext {
  state: WaitlistSwitchState
}

export const failure = (code: WaitlistErrorCode, message: string): Result<never, WaitlistError> =>
  err({ code, message })

/**
 * Fail closed on the module's own priority (module card, "When off": the form is closed).
 * `shadow` still runs and writes (rule 11 of `_rules.md`): the module has no user-facing view for
 * `shadow` to hide rows from.
 */
export function checkSwitch(ctx: WaitlistContext): Result<true, WaitlistError> {
  return ctx.state === 'off' ? failure('waitlist.closed', 'The waitlist is not open.') : ok(true)
}

/** The row the repo layer writes, once the input has been validated. */
export interface EntryInsert {
  email: string
  postcode: string | null
  wantedProducts: string[] | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmTerm: string | null
  utmContent: string | null
}

/**
 * Validates the form input against the contracts schema (defence in depth: the calling oRPC
 * procedure validates it first, `CLAUDE.md`, "No database access from the browser") and shapes it
 * for the repo layer. A missing optional field is stored as `null`, never an empty string.
 */
export function planEntry(input: unknown): Result<EntryInsert, WaitlistError> {
  const parsed = WaitlistSubmitInput.safeParse(input)
  if (!parsed.success) {
    return failure('waitlist.invalid_input', `waitlist submission refused: ${parsed.error.message}`)
  }
  const { email, postcode, wantedProducts, utm } = parsed.data
  return ok({
    email,
    postcode: postcode ?? null,
    wantedProducts: wantedProducts ?? null,
    utmSource: utm?.source ?? null,
    utmMedium: utm?.medium ?? null,
    utmCampaign: utm?.campaign ?? null,
    utmTerm: utm?.term ?? null,
    utmContent: utm?.content ?? null,
  })
}

/** The columns a stored or read-back row carries, before it becomes a `WaitlistEntry`. */
export interface EntryRow {
  id: string
  email: string
  postcode: string | null
  wantedProducts: string[] | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmTerm: string | null
  utmContent: string | null
  createdAt: string
}

function utmOf(row: EntryRow): WaitlistUtm {
  return {
    ...(row.utmSource ? { source: row.utmSource } : {}),
    ...(row.utmMedium ? { medium: row.utmMedium } : {}),
    ...(row.utmCampaign ? { campaign: row.utmCampaign } : {}),
    ...(row.utmTerm ? { term: row.utmTerm } : {}),
    ...(row.utmContent ? { content: row.utmContent } : {}),
  }
}

/** Shapes a stored row as `WaitlistEntry`, the shape `submit()` and `v_waitlist` both return. */
export function toEntry(row: EntryRow): WaitlistEntry {
  return WaitlistEntry.parse({
    id: row.id,
    email: row.email,
    postcode: row.postcode,
    wantedProducts: row.wantedProducts ?? [],
    utm: utmOf(row),
    createdAt: row.createdAt,
  })
}
