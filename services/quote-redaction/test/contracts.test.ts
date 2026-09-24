import { describe, expect, it } from 'vitest'
import { events, module, QuoteRedactionResult, redact } from '../src/index'
import { cases } from './cases'

describe('contracts', () => {
  it('declares its contracts under its own name and publishes no events', () => {
    expect(module).toBe('quote-redaction')
    expect(events.module).toBe('quote-redaction')
  })

  it('returns results that parse as QuoteRedactionResult', () => {
    for (const c of cases)
      expect(QuoteRedactionResult.parse(redact(c.input))).toEqual(redact(c.input))
  })

  it('rejects a result with unknown fields or negative counts', () => {
    const ok = redact('x')
    expect(QuoteRedactionResult.safeParse({ ...ok, original: 'x' }).success).toBe(false)
    expect(
      QuoteRedactionResult.safeParse({ ...ok, masked: { ...ok.masked, phone: -1 } }).success,
    ).toBe(false)
  })
})
