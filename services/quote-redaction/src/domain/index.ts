// Pure logic: no I/O, no database, no clock or randomness passed in implicitly.
import type {
  QuoteRedactionMasked,
  QuoteRedactionResult,
  QuoteRedactionSwitchState,
} from '@nabvy/contracts/modules/quote-redaction'
import { detectors } from './patterns'

export { type Detector, detectors, postcodeAreas } from './patterns'

const compiled = detectors.map((d) => ({ ...d, regex: new RegExp(d.source, d.flags) }))

/**
 * Masks phone numbers, emails, social handles, links and the inward half of full postcodes, and
 * counts what it masked. Pure: it never changes stored text, only returns a masked copy.
 */
export function redact(text: string): QuoteRedactionResult {
  const masked: QuoteRedactionMasked = { email: 0, link: 0, handle: 0, phone: 0, postcode: 0 }
  let out = text
  for (const d of compiled) {
    out = out.replace(d.regex, (...args: unknown[]) => {
      masked[d.kind] += 1
      return d.mask.replace(/\$(\d)/g, (_, n: string) => String(args[Number(n)] ?? ''))
    })
  }
  return { text: out, masked }
}

/**
 * The fail-closed entry point for callers that show a quote or send listing text to a model.
 * Returns null unless the module's switch is 'on': the caller then shows no quote and sends no
 * text, and carries on with its other facts. A missing or unreadable state counts as off.
 */
export function quoteFor(
  text: string,
  state: QuoteRedactionSwitchState | null | undefined,
): QuoteRedactionResult | null {
  return state === 'on' ? redact(text) : null
}
