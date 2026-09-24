import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decideCanMarket, hashEmail, isGranted, isPaused, normaliseEmail } from '../src/domain'

describe('normaliseEmail', () => {
  it('trims and lower-cases', () => {
    expect(normaliseEmail('  Person@Example.com  ')).toBe('person@example.com')
  })
})

describe('hashEmail', () => {
  it('is the sha256 hex of the normalised address', () => {
    expect(hashEmail('Person@Example.com')).toBe(
      createHash('sha256').update('person@example.com').digest('hex'),
    )
  })

  it('the same address always hashes the same, whatever its case or padding', () => {
    expect(hashEmail(' person@example.com')).toBe(hashEmail('PERSON@EXAMPLE.COM '))
  })
})

const now = new Date('2026-09-24T00:00:00.000Z')

describe('isPaused', () => {
  it('false with no pause row', () => {
    expect(isPaused([], now)).toBe(false)
  })

  it('true while an all-pause row is still in the future', () => {
    const until = new Date(now.getTime() + 1000)
    expect(isPaused([{ category: 'all', granted: false, until }], now)).toBe(true)
  })

  it('false once the pause has lapsed (the boundary: until equal to now is lapsed)', () => {
    expect(isPaused([{ category: 'all', granted: false, until: now }], now)).toBe(false)
    const past = new Date(now.getTime() - 1000)
    expect(isPaused([{ category: 'all', granted: false, until: past }], now)).toBe(false)
  })

  it('ignores a real category row, even one with an until somehow set', () => {
    expect(
      isPaused([{ category: 'tips', granted: false, until: new Date(now.getTime() + 1000) }], now),
    ).toBe(false)
  })
})

describe('isGranted', () => {
  it('false when there is no row for the category (the sign-up box starts unticked)', () => {
    expect(isGranted([], 'tips')).toBe(false)
  })

  it('reads the stored value', () => {
    expect(isGranted([{ category: 'tips', granted: true, until: null }], 'tips')).toBe(true)
    expect(isGranted([{ category: 'tips', granted: false, until: null }], 'tips')).toBe(false)
  })
})

describe('decideCanMarket', () => {
  const granted = [{ category: 'tips', granted: true, until: null }]
  const base = {
    moduleOn: true,
    accountActive: true,
    suppressed: false,
    rows: granted,
    category: 'tips',
    now,
  }

  it('true when the switch is on, the account is active, the address is not suppressed and the category is granted', () => {
    expect(decideCanMarket(base)).toBe(true)
  })

  it('false while the module switch is off (fail closed)', () => {
    expect(decideCanMarket({ ...base, moduleOn: false })).toBe(false)
  })

  it('false for a suspended or banned account', () => {
    expect(decideCanMarket({ ...base, accountActive: false })).toBe(false)
  })

  it('false for a suppressed address, even with full consent', () => {
    expect(decideCanMarket({ ...base, suppressed: true })).toBe(false)
  })

  it('false while an all-pause is active, even with the category granted', () => {
    const rows = [
      ...granted,
      { category: 'all', granted: false, until: new Date(now.getTime() + 1000) },
    ]
    expect(decideCanMarket({ ...base, rows })).toBe(false)
  })

  it('false when the category was never granted', () => {
    expect(decideCanMarket({ ...base, rows: [] })).toBe(false)
  })
})
