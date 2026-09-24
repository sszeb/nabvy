import { describe, expect, it } from 'vitest'
import {
  channelKey,
  checkLinkCode,
  checkRelinkCap,
  deletedKey,
  generateLinkCode,
  planStandingChange,
  relinkCapFor,
  standingChangedKey,
} from '../src/domain'

const U1 = '00000000-0000-4000-8000-0000000000c1'

describe('generateLinkCode', () => {
  it('is 8 characters from the unambiguous alphabet, with no 0/O/1/I', () => {
    const code = generateLinkCode(() => 0.999999)
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
  })

  it('uses the whole range of the generator', () => {
    const code = generateLinkCode(() => 0)
    expect(code).toBe('AAAAAAAA')
  })
})

describe('checkLinkCode', () => {
  const now = new Date('2026-09-24T12:00:00Z')
  const row = (over: Partial<{ expiresAt: Date; usedAt: Date | null }> = {}) => ({
    code: 'ABCDEFGH',
    userId: U1,
    expiresAt: new Date('2026-09-24T12:10:00Z'),
    usedAt: null,
    ...over,
  })

  it('accepts a fresh, unused code', () => {
    expect(checkLinkCode(row(), now)).toBeNull()
  })

  it('refuses a missing code', () => {
    expect(checkLinkCode(undefined, now)).toBe('account.link_code_invalid')
  })

  it('refuses a used code', () => {
    expect(checkLinkCode(row({ usedAt: now }), now)).toBe('account.link_code_invalid')
  })

  it('refuses an expired code, exactly at the boundary', () => {
    expect(checkLinkCode(row({ expiresAt: now }), now)).toBe('account.link_code_expired')
  })
})

describe('relinkCapFor / checkRelinkCap', () => {
  const capByPlan = { default: 1, standard: 3 }

  it('reads the plan cap, falling back to default for an unlisted plan', () => {
    expect(relinkCapFor('standard', capByPlan)).toBe(3)
    expect(relinkCapFor('business', capByPlan)).toBe(1)
  })

  it('refuses once the cap in the window is reached', () => {
    expect(checkRelinkCap(0, 1)).toBeNull()
    expect(checkRelinkCap(1, 1)).toBe('account.relink_cap_exceeded')
    expect(checkRelinkCap(5, 1)).toBe('account.relink_cap_exceeded')
  })
})

describe('planStandingChange', () => {
  it('lifts on active, dropping any until', () => {
    const plan = planStandingChange({ status: 'active' })
    expect(plan.auth).toEqual({ kind: 'lift' })
    expect(plan.row).toEqual({ status: 'active', until: null, limits: null })
  })

  it('restricts with an until date on suspended', () => {
    const until = '2026-10-24T00:00:00.000Z'
    const plan = planStandingChange({ status: 'suspended', until, limits: { maxActiveHunts: 1 } })
    expect(plan.auth).toEqual({ kind: 'restrict', until: new Date(until) })
    expect(plan.row).toEqual({
      status: 'suspended',
      until: new Date(until),
      limits: { maxActiveHunts: 1 },
    })
  })

  it('restricts with no until on banned', () => {
    const plan = planStandingChange({ status: 'banned' })
    expect(plan.auth).toEqual({ kind: 'restrict', until: null })
    expect(plan.row.until).toBeNull()
  })
})

describe('idempotency keys (rule 8)', () => {
  it('are stable for the same identifiers and time, and differ otherwise', () => {
    const at = new Date('2026-09-24T12:00:00.000Z')
    expect(deletedKey(U1)).toBe(deletedKey(U1))
    expect(standingChangedKey(U1, at)).toBe(standingChangedKey(U1, at))
    expect(channelKey(U1, 'telegram', at)).not.toBe(channelKey(U1, 'push', at))
    expect(standingChangedKey(U1, at)).not.toBe(deletedKey(U1))
  })
})
