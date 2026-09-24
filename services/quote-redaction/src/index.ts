// Public API of the quote-redaction module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/quote-redaction' only, never from its internals.
import type { QuoteRedactionResult } from '@nabvy/contracts/modules/quote-redaction'
import type { Queryable } from '@nabvy/db'
import { isOn } from '@nabvy/switches'
import { redact } from './domain/index'

export {
  events,
  module,
  QuoteRedactionKind,
  QuoteRedactionMasked,
  QuoteRedactionResult,
} from '@nabvy/contracts/modules/quote-redaction'
export { redact } from './domain/index'

/**
 * The fail-closed entry point for callers that show a quote or send listing text to a model.
 * Reads the live switch through `@nabvy/switches` (task 0.11) and returns null unless it is 'on':
 * the caller then shows no quote and sends no text, and carries on with its other facts.
 */
export async function quoteFor(q: Queryable, text: string): Promise<QuoteRedactionResult | null> {
  return (await isOn(q, 'quote-redaction')) ? redact(text) : null
}
