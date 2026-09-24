import { describe, expect, it } from 'vitest'
import { redact } from '../src/index'
import { cases } from './cases'

// The module has no handlers and writes nothing. Its idempotency is that a second pass masks
// nothing, so a view or caller may apply it to text that is already masked.
describe('redact twice', () => {
  const none = { email: 0, link: 0, handle: 0, phone: 0, postcode: 0 }
  it.each(cases)('$id', (c) => {
    expect(redact(redact(c.input).text)).toEqual({ text: c.text, masked: none })
  })
})
