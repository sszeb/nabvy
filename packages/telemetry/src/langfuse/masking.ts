import type { MaskFunction } from '@langfuse/otel'

// Strips seller fields and contact patterns from a span before it leaves Nabvy for Langfuse.
// "Actor data kept in full" (docs/decisions.md) covers Nabvy's own storage; sending listing text
// or seller fields to a third party is a different act, so the conservative default applies
// (design section 5, "Tensions with the repo's rules"): production traces carry ids and
// structured facts, and the full listing stays in Nabvy, opened through the trace id.

const SELLER_KEY_PATTERN = /seller|contact|profile|photo/i
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
// UK landline/mobile in common written forms: +44/0 then 9-10 further digits, loosely spaced.
const UK_PHONE_PATTERN = /(?:\+44\s?|0)(?:\d[\s-]?){9,10}/g

function maskString(value: string): string {
  return value
    .replace(EMAIL_PATTERN, '[redacted-email]')
    .replace(UK_PHONE_PATTERN, '[redacted-phone]')
}

function maskParsed(value: unknown): unknown {
  if (typeof value === 'string') return maskString(value)
  if (Array.isArray(value)) return value.map(maskParsed)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        SELLER_KEY_PATTERN.test(key) ? '[redacted]' : maskParsed(entry),
      ]),
    )
  }
  return value
}

/**
 * The span input, output and metadata attributes the Langfuse SDK hands this function are
 * JSON-encoded strings (`@langfuse/tracing` serialises them before the OTel export). Parse,
 * mask and re-serialise when that succeeds; otherwise mask the raw string, and mask a non-string
 * value directly (a caller exercising the function outside the SDK's own pipeline).
 */
export const maskSensitiveData: MaskFunction = ({ data }) => {
  if (typeof data !== 'string') return maskParsed(data)
  try {
    return JSON.stringify(maskParsed(JSON.parse(data)))
  } catch {
    return maskString(data)
  }
}
