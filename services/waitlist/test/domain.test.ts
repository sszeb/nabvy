import { describe, expect, it } from 'vitest'
import { checkSwitch, planEntry, toEntry } from '../src/domain'

describe('checkSwitch (module card, "When off": the form is closed)', () => {
  it('refuses while the switch is off', () => {
    const result = checkSwitch({ state: 'off' })
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'waitlist.closed' }),
    })
  })

  it.each(['shadow', 'on'] as const)('allows while the switch is %s', (state) => {
    expect(checkSwitch({ state })).toEqual({ ok: true, value: true })
  })
})

describe('planEntry', () => {
  it('shapes a minimal submission with nulls for every optional field', () => {
    const result = planEntry({ email: 'Sam@Example.com' })
    expect(result).toEqual({
      ok: true,
      value: {
        email: 'sam@example.com',
        postcode: null,
        wantedProducts: null,
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        utmTerm: null,
        utmContent: null,
      },
    })
  })

  it('shapes a full submission', () => {
    const result = planEntry({
      email: 'sam@example.com',
      postcode: 'po19 8hr',
      wantedProducts: ['RTX 3080'],
      utm: { source: 'reddit', medium: 'social', campaign: 'launch', term: 'gpu', content: 'a' },
    })
    expect(result).toEqual({
      ok: true,
      value: {
        email: 'sam@example.com',
        postcode: 'PO19 8HR',
        wantedProducts: ['RTX 3080'],
        utmSource: 'reddit',
        utmMedium: 'social',
        utmCampaign: 'launch',
        utmTerm: 'gpu',
        utmContent: 'a',
      },
    })
  })

  it('refuses input that fails the contracts schema', () => {
    const result = planEntry({ email: 'not-an-email' })
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'waitlist.invalid_input' }),
    })
  })

  it('refuses a missing email', () => {
    expect(planEntry({}).ok).toBe(false)
  })
})

describe('toEntry', () => {
  it('builds an empty utm object when no UTM columns are set', () => {
    const entry = toEntry({
      id: '00000000-0000-7000-8000-000000000001',
      email: 'sam@example.com',
      postcode: null,
      wantedProducts: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
      createdAt: '2026-09-24T00:00:00.000Z',
    })
    expect(entry.utm).toEqual({})
    expect(entry.wantedProducts).toEqual([])
  })

  it('carries only the UTM fields that are set', () => {
    const entry = toEntry({
      id: '00000000-0000-7000-8000-000000000001',
      email: 'sam@example.com',
      postcode: 'PO19 8HR',
      wantedProducts: ['RTX 3080'],
      utmSource: 'reddit',
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
      createdAt: '2026-09-24T00:00:00.000Z',
    })
    expect(entry.utm).toEqual({ source: 'reddit' })
  })
})
