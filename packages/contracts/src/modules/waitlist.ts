import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'

// Contracts of the waitlist module (services/waitlist): pre-launch sign-ups (email, postcode,
// wanted products, UTM). Import from '@nabvy/contracts/modules/waitlist'.

export const module = 'waitlist'

/** Trimmed and lower-cased before validation; the module's own dedupe key. */
export const WaitlistEmail = z.string().trim().toLowerCase().max(320).pipe(z.email())
export type WaitlistEmail = z.infer<typeof WaitlistEmail>

/**
 * A UK postcode, upper-cased with a single space before the inward code (`PO19 8HR`). Wider than
 * the real numbering plan, on purpose (same trade-off as `quote-redaction`'s postcode detector).
 */
export const WaitlistPostcode = z
  .string()
  .trim()
  .toUpperCase()
  .transform((value) => value.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-BD-HJLNP-UW-Z]{2}$/))
  .transform((value) => `${value.slice(0, -3)} ${value.slice(-3)}`)
export type WaitlistPostcode = z.infer<typeof WaitlistPostcode>

/** One product a visitor wants alerts for, free text until product keys exist for this cell. */
export const WaitlistProduct = z.string().trim().min(1).max(100)
export type WaitlistProduct = z.infer<typeof WaitlistProduct>

/** UTM parameters captured with the entry (docs/marketing.md, "Waitlist before launch"). */
export const WaitlistUtm = z.strictObject({
  source: z.string().trim().min(1).max(200).optional(),
  medium: z.string().trim().min(1).max(200).optional(),
  campaign: z.string().trim().min(1).max(200).optional(),
  term: z.string().trim().min(1).max(200).optional(),
  content: z.string().trim().min(1).max(200).optional(),
})
export type WaitlistUtm = z.infer<typeof WaitlistUtm>

/**
 * What the `/waitlist` form submits. Postcode and wanted products are optional
 * (docs/questions.md, "waitlist: which fields are required"): only the address is required to
 * join.
 */
export const WaitlistSubmitInput = z.strictObject({
  email: WaitlistEmail,
  postcode: WaitlistPostcode.optional(),
  wantedProducts: z.array(WaitlistProduct).max(20).optional(),
  utm: WaitlistUtm.optional(),
})
export type WaitlistSubmitInput = z.infer<typeof WaitlistSubmitInput>

/**
 * A module switch state as the caller read it (docs/design rule 11). `submit` fails closed:
 * anything but `'on'` or `'shadow'` refuses the submission (`waitlist.closed`).
 */
export const WaitlistSwitchState = z.enum(['off', 'shadow', 'on'])
export type WaitlistSwitchState = z.infer<typeof WaitlistSwitchState>

/**
 * One row of `waitlist.v_waitlist`. Its shape follows the Drizzle view declaration in
 * packages/db/src/schema/waitlist.ts; services/waitlist/test/contracts.test.ts fails if they drift.
 */
export const WaitlistEntry = z.strictObject({
  id: Uuid,
  email: WaitlistEmail,
  postcode: WaitlistPostcode.nullable(),
  wantedProducts: z.array(WaitlistProduct),
  utm: WaitlistUtm,
  createdAt: IsoTimestamp,
})
export type WaitlistEntry = z.infer<typeof WaitlistEntry>

/** Error codes the module returns as values (docs/engineering.md, "Errors"). */
export const WaitlistErrorCode = z.enum([
  'waitlist.invalid_input', //  the input failed WaitlistSubmitInput
  'waitlist.closed', //         the switch is not on or shadow (the form is closed)
  'waitlist.rate_limited', //   too many submissions from this IP (docs/security.md)
])
export type WaitlistErrorCode = z.infer<typeof WaitlistErrorCode>

export const WaitlistError = z.strictObject({ code: WaitlistErrorCode, message: z.string() })
export type WaitlistError = z.infer<typeof WaitlistError>

/** Events this module publishes: none, it has only its view (module card, "Outputs"). */
export const events = defineEvents(module, {})
