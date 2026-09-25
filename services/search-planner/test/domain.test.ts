import { SEARCH_PLANNER_MAX_ACTIVE_PAIRS } from '@nabvy/config/modules/search-planner'
import { describe, expect, it } from 'vitest'
import {
  canTransition,
  classOf,
  computePlan,
  diffPlan,
  planChangedKey,
  termOf,
} from '../src/domain'

const CONTAINER = ['gaming pc', 'pc']
const centre = (cityPageId: string, verified = true, active = true) => ({
  cityPageId,
  verified,
  active,
})
const base = { adminPairs: [], dropAdminTest: false, containerTerms: CONTAINER, maxPairs: 46 }

describe('terms', () => {
  it('lower-cases and collapses a family, and refuses what is not a term', () => {
    expect(termOf('RTX 5070 Ti')).toBe('rtx 5070 ti')
    expect(termOf('  RTX   3090 ')).toBe('rtx 3090')
    expect(termOf('gpu:nvidia:rtx-3090')).toBeNull()
    expect(termOf('')).toBeNull()
    expect(termOf('x'.repeat(101))).toBeNull()
    expect(termOf('x'.repeat(100))).toBe('x'.repeat(100))
  })

  it('classes the container terms broad and every other term narrow', () => {
    expect(classOf('gaming pc', CONTAINER)).toBe('broad')
    expect(classOf('pc', CONTAINER)).toBe('broad')
    expect(classOf('rtx 3090', CONTAINER)).toBe('narrow')
  })
})

describe('the budget bound', () => {
  it('is floor($150 / $3.20) = 46 pairs', () => {
    expect(SEARCH_PLANNER_MAX_ACTIVE_PAIRS).toBe(46)
  })

  it('keeps exactly maxPairs, favouring the admin test, then paid wants, then all wants', () => {
    const plan = computePlan({
      ...base,
      maxPairs: 4,
      adminPairs: [{ centreId: 'c', term: 'rtx3090' }],
      centres: [centre('a'), centre('b'), centre('c')],
      wantTerms: [
        { centreId: 'a', family: 'RTX 4090', wantCount: 5, paidWantCount: 0 },
        { centreId: 'b', family: 'RTX 3080', wantCount: 1, paidWantCount: 1 },
      ],
    })
    const kept = plan.terms.filter((r) => r.inBudget).sort((x, y) => (x.rank ?? 0) - (y.rank ?? 0))
    expect(kept.map((r) => `${r.rank}:${r.centreId}:${r.term}`)).toEqual([
      '1:c:rtx3090',
      '2:b:rtx 3080',
      '3:b:gaming pc',
      '4:b:pc',
    ])
    expect(plan.terms.filter((r) => !r.inBudget).every((r) => r.rank === null)).toBe(true)
    expect(plan.terms.filter((r) => !r.inBudget)).toHaveLength(3)
  })

  it('keeps nothing at maxPairs 0, and everything when the bound is not reached', () => {
    const input = {
      ...base,
      centres: [centre('a')],
      wantTerms: [{ centreId: 'a', family: 'RTX 4090', wantCount: 1, paidWantCount: 0 }],
    }
    expect(computePlan({ ...input, maxPairs: 0 }).terms.some((r) => r.inBudget)).toBe(false)
    expect(computePlan({ ...input, maxPairs: 3 }).terms.every((r) => r.inBudget)).toBe(true)
    expect(computePlan({ ...input, maxPairs: 2 }).terms.filter((r) => r.inBudget)).toHaveLength(2)
  })

  it('spends no slot on a centre that cannot run', () => {
    const plan = computePlan({
      ...base,
      maxPairs: 3,
      centres: [centre('a', false), centre('b')],
      wantTerms: [
        { centreId: 'a', family: 'RTX 4090', wantCount: 9, paidWantCount: 9 },
        { centreId: 'b', family: 'RTX 3080', wantCount: 1, paidWantCount: 0 },
      ],
    })
    expect(plan.terms.filter((r) => r.inBudget).map((r) => r.centreId)).toEqual(['b', 'b', 'b'])
    expect(plan.plans).toEqual([
      { centreId: 'a', active: false },
      { centreId: 'b', active: true },
    ])
    expect(plan.verifications).toEqual([{ centreId: 'a', term: 'rtx 4090' }])
  })
})

describe('computePlan', () => {
  it('counts container terms as the most-wanted family, never a sum', () => {
    const plan = computePlan({
      ...base,
      centres: [centre('a')],
      wantTerms: [
        { centreId: 'a', family: 'RTX 4090', wantCount: 3, paidWantCount: 1 },
        { centreId: 'a', family: 'RTX 3090', wantCount: 2, paidWantCount: 2 },
      ],
    })
    const pc = plan.terms.find((r) => r.term === 'pc')
    expect(pc).toMatchObject({ class: 'broad', wantCount: 3, paidWantCount: 2 })
  })

  it('makes no pair from a family that is no valid term, or from zero wants', () => {
    const plan = computePlan({
      ...base,
      centres: [centre('a')],
      wantTerms: [
        { centreId: 'a', family: 'gpu:nvidia:rtx-3090', wantCount: 3, paidWantCount: 0 },
        { centreId: 'a', family: 'RTX 3090', wantCount: 0, paidWantCount: 0 },
      ],
    })
    expect(plan.terms).toEqual([])
    expect(plan.plans).toEqual([])
  })

  it('drops admin-test pairs when asked', () => {
    const plan = computePlan({
      ...base,
      dropAdminTest: true,
      adminPairs: [{ centreId: 'a', term: 'rtx3090' }],
      centres: [centre('a')],
      wantTerms: [],
    })
    expect(plan.terms).toEqual([])
  })
})

describe('diffPlan and the key', () => {
  it('is empty for the same plan, and names the changed centres', () => {
    const input = {
      ...base,
      centres: [centre('a'), centre('b')],
      wantTerms: [
        { centreId: 'a', family: 'RTX 4090', wantCount: 1, paidWantCount: 0 },
        { centreId: 'b', family: 'RTX 4090', wantCount: 1, paidWantCount: 0 },
      ],
    }
    const plan = computePlan(input)
    expect(diffPlan(plan, plan).changedCentres).toEqual([])
    const next = computePlan({ ...input, wantTerms: input.wantTerms.slice(0, 1) })
    const diff = diffPlan(plan, next)
    expect(diff.changedCentres).toEqual(['b'])
    expect(diff.deleteTerms).toHaveLength(3)
    expect(diff.deletePlans).toEqual(['b'])
    expect(planChangedKey(['b'], next)).toBe(planChangedKey(['b'], next))
    expect(planChangedKey(['b'], next)).not.toBe(planChangedKey(['b'], plan))
    expect(planChangedKey(['b'], next)).toMatch(/^search-planner\.plan-changed:[0-9a-f]{16}$/)
  })
})

describe('one-off run life', () => {
  it('allows only the forward moves', () => {
    expect(canTransition('pending', 'submitted')).toBe(true)
    expect(canTransition('pending', 'cancelled')).toBe(true)
    expect(canTransition('submitted', 'completed')).toBe(true)
    expect(canTransition('submitted', 'failed')).toBe(true)
    expect(canTransition('submitted', 'submitted')).toBe(true)
    expect(canTransition('submitted', 'cancelled')).toBe(false)
    expect(canTransition('completed', 'failed')).toBe(false)
    expect(canTransition('failed', 'pending')).toBe(false)
  })
})
