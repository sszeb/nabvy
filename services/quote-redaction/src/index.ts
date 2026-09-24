// Public API of the quote-redaction module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/quote-redaction' only, never from its internals.
export {
  events,
  module,
  QuoteRedactionKind,
  QuoteRedactionMasked,
  QuoteRedactionResult,
  QuoteRedactionSwitchState,
} from '@nabvy/contracts/modules/quote-redaction'
export { quoteFor, redact } from './domain/index'
