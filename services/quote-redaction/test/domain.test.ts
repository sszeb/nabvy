import { describe, expect, it } from 'vitest'
import { detectors, postcodeAreas } from '../src/domain/index'
import { redact } from '../src/index'
import { cases, nonZero } from './cases'

describe('redact', () => {
  it.each(cases)('$id', (c) => {
    const result = redact(c.input)
    expect(result.text).toBe(c.text)
    expect(nonZero(result.masked)).toEqual(c.masked)
  })

  it('reports every kind, zero when nothing matched', () => {
    expect(redact('nothing here').masked).toEqual({
      email: 0,
      link: 0,
      handle: 0,
      phone: 0,
      postcode: 0,
    })
  })

  it('never reports the masked strings', () => {
    const result = redact('Call 07700 900123 or jo@example.com')
    expect(JSON.stringify(result)).not.toMatch(/07700|jo@example/)
  })

  it('does not change its input', () => {
    const input = 'PO19 1AB'
    redact(input)
    expect(input).toBe('PO19 1AB')
  })

  it('keeps the detectors free of syntax PostgreSQL reads differently', () => {
    for (const d of detectors) {
      expect(d.source).not.toMatch(/\\[bBwWdDsS]|\\[AZz]|\*\?|\+\?|\?\?|\}\?/)
    }
  })

  it('lists each postcode area once, two-letter areas first', () => {
    expect(new Set(postcodeAreas).size).toBe(postcodeAreas.length)
    const firstSingle = postcodeAreas.findIndex((a) => a.length === 1)
    expect(postcodeAreas.slice(firstSingle).every((a) => a.length === 1)).toBe(true)
  })
})

describe('the detectors used by the recorded-run fixture test', () => {
  // The same checks services/source-adapters runs on the recorded dataset: nothing redact()
  // leaves behind may match them.
  const leaks = [
    /fbcdn\.net|fbsbx\.com|cdninstagram\.com/i,
    /facebook\.com\/(?!marketplace\/)/i,
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
    /(\+44\s?|\b0)7\d{3}\s?\d{3}\s?\d{3}\b/,
  ]
  const samples = [
    'photo https://scontent.fbcdn.net/v/t39/abc.jpg and https://www.facebook.com/profile.php?id=1',
    'mail jo.smith@example.co.uk or JO@EXAMPLE.COM',
    'call 07700 900123, +44 7700 900123, +447700900123 or 07700900123',
  ]
  it.each(samples)('%s', (sample) => {
    const { text } = redact(sample)
    for (const leak of leaks) expect(text).not.toMatch(leak)
  })
})
