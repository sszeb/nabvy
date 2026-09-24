import {
  events,
  module,
  WaitlistEntry,
  WaitlistSubmitInput,
} from '@nabvy/contracts/modules/waitlist'
import { describe, expect, it } from 'vitest'

const sampleEntry = {
  id: '00000000-0000-7000-8000-000000000001',
  email: 'sam@example.com',
  postcode: 'PO19 8HR',
  wantedProducts: ['RTX 3080', 'RTX 3090'],
  utm: { source: 'reddit', medium: 'social' },
  createdAt: '2026-09-24T00:00:00.000Z',
}

describe('waitlist contracts', () => {
  it('declares its module name under its own file', () => {
    expect(module).toBe('waitlist')
    expect(events.module).toBe('waitlist')
  })

  it('publishes no events (module card, "Outputs": none beyond its view)', () => {
    expect(Object.keys(events.definitions)).toHaveLength(0)
  })

  it('normalises email casing and trims whitespace on submit input', () => {
    const parsed = WaitlistSubmitInput.parse({ email: '  Sam@Example.COM  ' })
    expect(parsed.email).toBe('sam@example.com')
  })

  it('normalises a postcode to upper case with one space', () => {
    const parsed = WaitlistSubmitInput.parse({ email: 'a@b.com', postcode: ' po19 8hr ' })
    expect(parsed.postcode).toBe('PO19 8HR')
  })

  it('rejects an invalid email', () => {
    expect(WaitlistSubmitInput.safeParse({ email: 'not-an-email' }).success).toBe(false)
  })

  it('rejects a postcode that is not a real UK shape', () => {
    expect(
      WaitlistSubmitInput.safeParse({ email: 'a@b.com', postcode: 'not a postcode' }).success,
    ).toBe(false)
  })

  it('rejects more than 20 wanted products', () => {
    const wantedProducts = Array.from({ length: 21 }, (_, i) => `product-${i}`)
    expect(WaitlistSubmitInput.safeParse({ email: 'a@b.com', wantedProducts }).success).toBe(false)
  })

  it('rejects an unknown field (strict)', () => {
    expect(WaitlistSubmitInput.safeParse({ email: 'a@b.com', extra: true }).success).toBe(false)
  })

  it('parses a valid waitlist entry', () => {
    expect(WaitlistEntry.parse(sampleEntry)).toEqual(sampleEntry)
  })

  it('rejects an entry missing a required field', () => {
    const { createdAt: _createdAt, ...rest } = sampleEntry
    expect(WaitlistEntry.safeParse(rest).success).toBe(false)
  })

  it('rejects an entry with an unknown field', () => {
    expect(WaitlistEntry.safeParse({ ...sampleEntry, extra: true }).success).toBe(false)
  })
})
