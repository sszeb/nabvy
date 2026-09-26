import { describe, expect, it } from 'vitest'
import { generateReferralCode, isSelfReferral, referralCreditRefId } from '../src/domain'

describe('generateReferralCode', () => {
  it('is 8 characters from the unambiguous alphabet', () => {
    const code = generateReferralCode(() => 0)
    expect(code).toHaveLength(8)
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
  })

  it('never emits 0, O, 1 or I', () => {
    // Walk the whole [0, 1) range in small steps and check every character produced.
    for (let i = 0; i < 100; i++) {
      const code = generateReferralCode(() => i / 100)
      expect(code).not.toMatch(/[01OI]/)
    }
  })

  it('is deterministic for a fixed random source', () => {
    expect(generateReferralCode(() => 0.999999)).toBe(generateReferralCode(() => 0.999999))
  })
})

describe('isSelfReferral', () => {
  it('is true only when the referrer and the signing-up user are the same', () => {
    expect(isSelfReferral('a', 'a')).toBe(true)
    expect(isSelfReferral('a', 'b')).toBe(false)
  })
})

describe('referralCreditRefId', () => {
  it('differs by side for the same pair, so referrer and referred each get their own grant', () => {
    const referrer = referralCreditRefId('referrer', 'pair-1')
    const referred = referralCreditRefId('referred', 'pair-1')
    expect(referrer).not.toBe(referred)
  })

  it('is stable for the same side and pair (idempotency)', () => {
    expect(referralCreditRefId('referrer', 'pair-1')).toBe(
      referralCreditRefId('referrer', 'pair-1'),
    )
  })
})
