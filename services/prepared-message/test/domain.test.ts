import type { PreparedMessageTemplate } from '@nabvy/contracts/modules/prepared-message'
import { describe, expect, it } from 'vitest'
import { compose, showQuote } from '../src'
import { TEMPLATES } from '../src/domain'

const template = TEMPLATES[0] as PreparedMessageTemplate
const base = {
  listingId: '0192f0a0-0000-7000-8000-000000000001',
  evidenceHash: 'a'.repeat(64),
  confirmed: [],
  quotesShown: true,
}

describe('compose', () => {
  it('an unstated GPU becomes a question in the message and an ask on the checklist', () => {
    const message = compose({ ...base, unknowns: ['gpu'] }, template)
    expect(message?.text).toBe(
      'Hello, is this still available? Before I come to see it, could you tell me:\n' +
        '- Which graphics card (GPU) does it have?\nThank you.',
    )
    expect(message?.checklist).toEqual([
      { kind: 'ask', partType: 'gpu', text: 'Which graphics card (GPU) does it have?' },
    ])
    expect(message?.templateVersion).toBe('placeholder-1')
  })

  it('nothing unknown, or only parts without a question: no message', () => {
    expect(compose({ ...base, unknowns: [] }, template)).toBeNull()
    expect(compose({ ...base, unknowns: ['chipset'] }, template)).toBeNull()
  })

  it('asks in part order, once each; checks only stated parts not asked, once per part', () => {
    const message = compose(
      {
        ...base,
        unknowns: ['storage_size', 'gpu', 'gpu'],
        confirmed: [
          { partType: 'ram_size', quote: '16GB' },
          { partType: 'cpu', quote: 'i5' },
          { partType: 'cpu', quote: 'i5 again' },
          { partType: 'gpu', quote: 'conflicting GPU' },
          { partType: 'ram_generation', quote: 'ddr4' },
          { partType: 'storage_size', quote: null },
        ],
      },
      template,
    )
    expect(message?.checklist.map((i) => `${i.kind}:${i.partType}`)).toEqual([
      'ask:gpu',
      'ask:storage_size',
      'check:cpu',
      'check:ram_size',
    ])
    expect(message?.checklist[2]?.text).toBe('Check in person: the listing says "i5"')
  })

  it('a quote is inserted literally, never read as a replacement pattern', () => {
    const message = compose(
      { ...base, unknowns: ['gpu'], confirmed: [{ partType: 'cpu', quote: "$& $' $1" }] },
      template,
    )
    expect(message?.checklist[1]?.text).toBe(`Check in person: the listing says "$& $' $1"`)
  })
})

describe('showQuote', () => {
  it('masks contact details, including a number split across lines', () => {
    expect(showQuote('RTX 3060 ring 07700\n900123', 120)).toBe('RTX 3060 ring [phone redacted]')
    expect(showQuote('i7 see wa.me/447700900123', 120)).toBe('i7 see [link redacted]')
    expect(showQuote('email me jo@example.com', 120)).toBe('email me [email redacted]')
  })

  it('keeps a quote of exactly the limit and leaves a longer one out, never cut', () => {
    expect(showQuote('x'.repeat(120), 120)).toBe('x'.repeat(120))
    expect(showQuote('x'.repeat(121), 120)).toBeNull()
    expect(showQuote('   ', 120)).toBeNull()
  })
})
