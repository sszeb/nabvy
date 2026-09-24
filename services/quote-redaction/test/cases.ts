import { readFileSync } from 'node:fs'
import type { QuoteRedactionMasked } from '../src/index'

// The shared cases (test/fixtures/cases.json), also run against SQL by
// packages/db/tests/quote-redaction.test.sql. `masked` lists only non-zero counts.
export type RedactionCase = {
  id: string
  input: string
  text: string
  masked: Partial<QuoteRedactionMasked>
}

export const cases: RedactionCase[] = JSON.parse(
  readFileSync(new URL('./fixtures/cases.json', import.meta.url), 'utf8'),
).cases

export function nonZero(masked: QuoteRedactionMasked): Partial<QuoteRedactionMasked> {
  return Object.fromEntries(Object.entries(masked).filter(([, n]) => n > 0))
}
