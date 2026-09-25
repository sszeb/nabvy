// Normalisation, rule version copy-advert@1 (docs/design/drafts/copy-advert.md 4.2). Applies to a
// working copy only; stored text never changes. Titles and descriptions follow the same steps, in
// this order: NFKC, plus decoding, contact masking, case folding, separators, whitespace.

// The two email/UK-mobile detectors cited by the design (the fixture at
// services/source-adapters/test/fixtures/adapter.facebook-run.fixtures.ts), and a URL detector
// matching the shape of quote-redaction's own link patterns (services/quote-redaction/src/domain/patterns.ts).
// Copied here as literals rather than imported: copy-advert has no dependency on either module.
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const UK_MOBILE_PATTERN = /(\+44\s?|\b0)7\d{3}\s?\d{3}\s?\d{3}\b/g
const URL_PATTERN = /https?:\/\/\S+|www\.\S+/gi

/** True when `text` contains "+" and no whitespace at all (step 2's trigger condition). */
function looksPlusEncoded(text: string): boolean {
  return text.includes('+') && !/\s/.test(text)
}

/**
 * Normalises a title or description for fingerprinting and trigram comparison. Never mutates
 * stored text: callers keep the original and normalise a working copy.
 */
export function normaliseText(input: string): string {
  let text = input.normalize('NFKC')
  if (looksPlusEncoded(text)) text = text.replaceAll('+', ' ')
  text = text.replace(EMAIL_PATTERN, 'email')
  text = text.replace(UK_MOBILE_PATTERN, 'phone')
  text = text.replace(URL_PATTERN, 'url')
  text = text.toLowerCase()
  // Every character that is not a letter or a digit becomes a space (Unicode-aware); digits stay,
  // because model numbers separate look-alikes ("RTX 3070" vs "RTX 3080").
  text = text.replace(/[^\p{L}\p{N}]/gu, ' ')
  return text.replace(/\s+/g, ' ').trim()
}
