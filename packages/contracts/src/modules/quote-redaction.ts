import { z } from 'zod'
import { defineEvents } from '../index'

// Contracts of the quote-redaction module (packages/contracts/README.md): its schemas and its events.
// Import from '@nabvy/contracts/modules/quote-redaction'. Samples in fixtures/contracts/quote-redaction/.

export const module = 'quote-redaction'

/** What `redact()` masks, in the order it runs (services/quote-redaction/README.md). */
export const QuoteRedactionKind = z.enum(['email', 'link', 'handle', 'phone', 'postcode'])
export type QuoteRedactionKind = z.infer<typeof QuoteRedactionKind>

const count = z.number().int().min(0)

/** How many of each kind were masked. Positions and the masked strings are never reported. */
export const QuoteRedactionMasked = z.strictObject({
  email: count,
  link: count,
  handle: count,
  phone: count,
  postcode: count,
})
export type QuoteRedactionMasked = z.infer<typeof QuoteRedactionMasked>

/** The output of `redact(text)`: the masked text and what was masked. */
export const QuoteRedactionResult = z.strictObject({
  text: z.string(),
  masked: QuoteRedactionMasked,
})
export type QuoteRedactionResult = z.infer<typeof QuoteRedactionResult>

/**
 * A module switch state as the caller read it (docs/design rule 11). Stub until the `switches`
 * module publishes its own contract; the values follow the rule. `quoteFor` fails closed on
 * anything but 'on', including a missing or unreadable state.
 */
export const QuoteRedactionSwitchState = z.enum(['off', 'shadow', 'on'])
export type QuoteRedactionSwitchState = z.infer<typeof QuoteRedactionSwitchState>

/** Events this module publishes: none, it is a function only. */
export const events = defineEvents(module, {})
