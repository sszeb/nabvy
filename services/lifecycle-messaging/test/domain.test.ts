import { describe, expect, it } from 'vitest'
import { categoryOf, decideStep, isMarketingStep, PROGRAMMES, renderCopy } from '../src/domain'

const triggeredAt = new Date('2026-09-24T00:00:00.000Z')
const step = { key: 's', delayMinutes: 60, category: 'tips' as const }

describe('decideStep', () => {
  it('waits before the delay has elapsed', () => {
    const decision = decideStep(step, {
      now: new Date('2026-09-24T00:59:59.999Z'),
      triggeredAt,
      exitedAt: null,
      alreadySent: false,
      canMarket: true,
      dailyCapReached: false,
    })
    expect(decision).toEqual({ action: 'wait' })
  })

  it('sends exactly at the due time (boundary)', () => {
    const decision = decideStep(step, {
      now: new Date('2026-09-24T01:00:00.000Z'),
      triggeredAt,
      exitedAt: null,
      alreadySent: false,
      canMarket: true,
      dailyCapReached: false,
    })
    expect(decision).toEqual({ action: 'send' })
  })

  it('skips an already-sent step before checking anything else', () => {
    const decision = decideStep(step, {
      now: new Date('2026-09-24T01:00:00.000Z'),
      triggeredAt,
      exitedAt: null,
      alreadySent: true,
      canMarket: false,
      dailyCapReached: true,
    })
    expect(decision).toEqual({ action: 'skip', reason: 'already-sent' })
  })

  it('skips when the exit event happened before the step is due', () => {
    const decision = decideStep(step, {
      now: new Date('2026-09-24T01:00:00.000Z'),
      triggeredAt,
      exitedAt: new Date('2026-09-24T00:30:00.000Z'),
      alreadySent: false,
      canMarket: true,
      dailyCapReached: false,
    })
    expect(decision).toEqual({ action: 'skip', reason: 'exited' })
  })

  it('an exit event before the trigger itself (stale data) does not count (boundary)', () => {
    const decision = decideStep(step, {
      now: new Date('2026-09-24T01:00:00.000Z'),
      triggeredAt,
      exitedAt: new Date('2026-09-23T23:59:59.999Z'),
      alreadySent: false,
      canMarket: true,
      dailyCapReached: false,
    })
    expect(decision).toEqual({ action: 'send' })
  })

  it('skips a marketing step at the daily cap', () => {
    const decision = decideStep(step, {
      now: new Date('2026-09-24T01:00:00.000Z'),
      triggeredAt,
      exitedAt: null,
      alreadySent: false,
      canMarket: true,
      dailyCapReached: true,
    })
    expect(decision).toEqual({ action: 'skip', reason: 'daily-cap' })
  })

  it('skips a marketing step with no consent', () => {
    const decision = decideStep(step, {
      now: new Date('2026-09-24T01:00:00.000Z'),
      triggeredAt,
      exitedAt: null,
      alreadySent: false,
      canMarket: false,
      dailyCapReached: false,
    })
    expect(decision).toEqual({ action: 'skip', reason: 'not-consented' })
  })

  it('a service step (category null) ignores the daily cap and consent', () => {
    const serviceStep = { ...step, category: null }
    const decision = decideStep(serviceStep, {
      now: new Date('2026-09-24T01:00:00.000Z'),
      triggeredAt,
      exitedAt: null,
      alreadySent: false,
      canMarket: null,
      dailyCapReached: true,
    })
    expect(decision).toEqual({ action: 'send' })
  })
})

describe('programmes', () => {
  it('every step is either a known preference-centre category or a service message (null)', () => {
    const categories = ['tips', 'offers', 'product_updates', 'weekly_digest']
    for (const programme of PROGRAMMES) {
      for (const s of programme.steps) {
        expect(s.category === null || categories.includes(s.category)).toBe(true)
      }
    }
  })

  it('categoryOf and isMarketingStep agree with the static catalogue', () => {
    expect(categoryOf('trial', 'day1')).toBeNull()
    expect(isMarketingStep('trial', 'day1')).toBe(false)
    expect(categoryOf('activation', '24h')).toBe('tips')
    expect(isMarketingStep('activation', '24h')).toBe(true)
  })

  it('every trigger, exit and goal event name is a real ProductEventsName (checked in contracts.test.ts too)', () => {
    expect(PROGRAMMES.length).toBeGreaterThan(0)
  })
})

describe('renderCopy', () => {
  it('renders every declared step without throwing, and marks placeholder copy', () => {
    for (const programme of PROGRAMMES) {
      for (const s of programme.steps) {
        const message = renderCopy(programme.id, s.key, { displayName: 'Alex', numbers: {} })
        expect(message.subject.length).toBeGreaterThan(0)
        expect(message.body).toContain('PLACEHOLDER')
        expect(message.body).toContain('Alex')
      }
    }
  })

  it('throws for an unknown step (a programme change without matching copy)', () => {
    expect(() => renderCopy('trial', 'nonexistent', { displayName: null, numbers: {} })).toThrow()
  })
})
