import { describe, expect, it } from 'vitest'
import {
  accuracyFactor,
  ageFactor,
  burstOf,
  type Contribution,
  distanceBand,
  editWindowOpen,
  eligibilityOf,
  familyEvidence,
  holdOf,
  levelOf,
  openGate,
  reasonCounts,
  reportWeight,
  sheetGate,
  statusOf,
  storedReason,
} from '../src/domain'

const NOW = new Date('2026-09-25T12:00:00.000Z')
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000)
const minutes = (n: number) => new Date(NOW.getTime() - n * 60_000)
const hours = (n: number) => new Date(NOW.getTime() - n * 3_600_000)
const REPORTER = {
  accountCreatedAt: days(40),
  emailVerified: true,
  active: true,
  tester: false,
  upheld: 0,
  notUpheld: 0,
}
const NO_PRIOR = { lastHour: 0, lastDay: 0 }

describe('the open gate (§3.1)', () => {
  it('needs an open between 5 minutes and 14 days ago', () => {
    expect(openGate(undefined, NOW)).toBe('no_open')
    expect(openGate(minutes(4), NOW)).toBe('too_soon')
    expect(openGate(minutes(5), NOW)).toBe('eligible')
    expect(openGate(days(14), NOW)).toBe('eligible')
    expect(openGate(new Date(days(14).getTime() - 1), NOW)).toBe('too_late')
  })
  it('offers no sheet when messaging is off; unknown messaging is not a "no"', () => {
    const base = { firstOpenedAt: minutes(10), suppressed: false, noise: false, active: true }
    expect(sheetGate({ ...base, messagingEnabled: false }, NOW)).toBe('messaging_off')
    expect(sheetGate({ ...base, messagingEnabled: null }, NOW)).toBe('eligible')
    expect(sheetGate({ ...base, messagingEnabled: true, suppressed: true }, NOW)).toBe('suppressed')
    expect(sheetGate({ ...base, messagingEnabled: true, noise: true }, NOW)).toBe('noise')
    expect(sheetGate({ ...base, messagingEnabled: true, active: false }, NOW)).toBe('not_active')
  })
  it('edits for 24 hours', () => {
    expect(editWindowOpen(hours(24), NOW)).toBe(true)
    expect(editWindowOpen(new Date(hours(24).getTime() - 1), NOW)).toBe(false)
  })
})

describe('the weight (§3.2)', () => {
  it('counts an account from 30 days, not at 29', () => {
    expect(ageFactor(days(29), NOW)).toBe(0)
    expect(ageFactor(days(30), NOW)).toBe(1)
    expect(ageFactor(null, NOW)).toBe(0)
    expect(reportWeight(days(29), { upheld: 0, notUpheld: 0 }, NOW)).toBe(0)
    expect(reportWeight(days(30), { upheld: 0, notUpheld: 0 }, NOW)).toBe(1)
  })
  it('is the Beta-reputation accuracy, capped at 1', () => {
    expect(accuracyFactor(0, 0)).toBe(1)
    expect(accuracyFactor(0, 3)).toBeCloseTo(0.4)
    expect(accuracyFactor(10, 0)).toBe(1)
    expect(reportWeight(days(40), { upheld: 0, notUpheld: 3 }, NOW)).toBe(0.4)
    expect(reportWeight(days(40), { upheld: 1, notUpheld: 2 }, NOW)).toBe(0.8)
  })
  it('refuses unknown or failing facts, testers first, then limits and bursts', () => {
    expect(eligibilityOf(REPORTER, NO_PRIOR, false, NOW)).toBe('eligible')
    expect(eligibilityOf({ ...REPORTER, tester: true }, NO_PRIOR, false, NOW)).toBe('tester')
    expect(eligibilityOf({ ...REPORTER, active: false }, NO_PRIOR, false, NOW)).toBe('not_active')
    expect(eligibilityOf({ ...REPORTER, emailVerified: null }, NO_PRIOR, false, NOW)).toBe(
      'email_unverified',
    )
    expect(eligibilityOf({ ...REPORTER, accountCreatedAt: days(29) }, NO_PRIOR, false, NOW)).toBe(
      'too_new',
    )
    expect(eligibilityOf(REPORTER, { lastHour: 4, lastDay: 4 }, false, NOW)).toBe('eligible')
    expect(eligibilityOf(REPORTER, { lastHour: 5, lastDay: 5 }, false, NOW)).toBe('rate_limited')
    expect(eligibilityOf(REPORTER, { lastHour: 0, lastDay: 15 }, false, NOW)).toBe('rate_limited')
    expect(eligibilityOf(REPORTER, NO_PRIOR, true, NOW)).toBe('burst_hold')
  })
})

describe('whether a reason counts (§3.1)', () => {
  const ctx = { distanceKm: 300, shippingOffered: false, itemFaultStated: false }
  const collection = (secondAnswer: string | null, placeId: string | null = '1') => ({
    reason: 'collection_elsewhere' as const,
    detail: null,
    secondAnswer,
    reportedPlaceId: placeId,
  })
  it('collection elsewhere: by the second answer, from 50 km', () => {
    expect(reasonCounts(collection('no'), ctx)).toBe('any_path')
    expect(reasonCounts(collection('yes'), ctx)).toBe('none')
    expect(reasonCounts(collection('didnt_ask'), ctx)).toBe('path_b_only')
    expect(reasonCounts(collection('no', null), ctx)).toBe('path_b_only')
    expect(reasonCounts(collection('no'), { ...ctx, distanceKm: 49 })).toBe('none')
    expect(reasonCounts(collection('no'), { ...ctx, distanceKm: 50 })).toBe('any_path')
    expect(reasonCounts(collection('no'), { ...ctx, distanceKm: null })).toBe('none')
  })
  it('an unanswered "see and pay" is stored as didnt_ask', () => {
    expect(
      storedReason({ reason: 'collection_elsewhere', placeId: '1', canSeeAndPay: null })
        .secondAnswer,
    ).toBe('didnt_ask')
  })
  it('postage only: never when shipping was offered or payment was protected', () => {
    const postage = (paidHow: string | null) => ({
      reason: 'postage_only' as const,
      detail: null,
      secondAnswer: paidHow,
      reportedPlaceId: null,
    })
    expect(reasonCounts(postage('bank_transfer'), ctx)).toBe('any_path')
    expect(reasonCounts(postage(null), ctx)).toBe('any_path')
    expect(reasonCounts(postage('protected'), ctx)).toBe('none')
    expect(reasonCounts(postage('bank_transfer'), { ...ctx, shippingOffered: true })).toBe('none')
  })
  it('not as described: faulty or missing parts is uncounted when the listing said so', () => {
    const item = (kind: string) => ({
      reason: 'not_as_described' as const,
      detail: kind,
      secondAnswer: null,
      reportedPlaceId: null,
    })
    expect(reasonCounts(item('faulty_or_missing_parts'), ctx)).toBe('any_path')
    expect(reasonCounts(item('faulty_or_missing_parts'), { ...ctx, itemFaultStated: true })).toBe(
      'none',
    )
    expect(reasonCounts(item('different_model'), { ...ctx, itemFaultStated: true })).toBe(
      'any_path',
    )
  })
  it('other and as_listed never count', () => {
    const plain = (reason: 'other' | 'as_listed') => ({
      reason,
      detail: null,
      secondAnswer: null,
      reportedPlaceId: null,
    })
    expect(reasonCounts(plain('other'), ctx)).toBe('none')
    expect(reasonCounts(plain('as_listed'), ctx)).toBe('none')
  })
  it('bands distances', () => {
    expect(distanceBand(null)).toBe('unknown')
    expect(distanceBand(9.9)).toBe('lt_10')
    expect(distanceBand(49)).toBe('25_50')
    expect(distanceBand(50)).toBe('50_100')
    expect(distanceBand(100)).toBe('100_plus')
  })
})

describe('levels, people and holds (§3.2-3.3)', () => {
  const c = (
    personKey: string,
    weight: number,
    extra: Partial<Contribution> = {},
  ): Contribution => ({
    reportId: `${personKey}-${weight}`,
    personKey,
    weight,
    counts: 'any_path',
    placeId: null,
    band: null,
    ...extra,
  })
  it('none under 1, single from 1, multiple from 2 with two people', () => {
    expect(levelOf(0.99, 1)).toBe('none')
    expect(levelOf(1, 1)).toBe('single')
    expect(levelOf(2, 1)).toBe('single')
    expect(levelOf(2, 2)).toBe('multiple')
  })
  it('a linked group counts once, at its lowest weight', () => {
    const e = familyEvidence([c('household', 1), c('household', 0.4), c('other', 1)])
    expect(e.persons).toBe(2)
    expect(e.weightSum).toBe(1.4)
    expect(e.level).toBe('single')
  })
  it('path-B-only reasons do not reach a level', () => {
    expect(familyEvidence([c('a', 1, { counts: 'path_b_only' })]).level).toBe('none')
  })
  it('publishes a reported place only when 3 people agree', () => {
    const two = familyEvidence([
      c('a', 1, { placeId: 'm', band: '100_plus' }),
      c('b', 1, { placeId: 'm', band: '100_plus' }),
    ])
    expect(two.placeId).toBeNull()
    const three = familyEvidence([
      c('a', 1, { placeId: 'm', band: '100_plus' }),
      c('b', 1, { placeId: 'm', band: '100_plus' }),
      c('d', 1, { placeId: 'm', band: '100_plus' }),
    ])
    expect(three.placeId).toBe('m')
    expect(three.distanceBand).toBe('100_plus')
  })
  it('holds bursts (3 in 24 h, any age; 2 in 6 h on a gem)', () => {
    expect(burstOf([hours(1), hours(10), hours(23)], false)).toBe('burst')
    expect(burstOf([hours(1), hours(10), hours(26)], false)).toBeNull()
    expect(burstOf([hours(1), hours(5)], true)).toBe('gem_burst')
    expect(burstOf([hours(1), hours(8)], true)).toBeNull()
    expect(burstOf([hours(1), hours(5)], false)).toBeNull()
  })
  it('a counter-report holds a level and never lowers it', () => {
    expect(holdOf(null, 1, 'single')).toBe('counter_report')
    expect(holdOf(null, 1, 'none')).toBeNull()
    expect(holdOf('burst', 1, 'single')).toBe('burst')
  })
  it('shows the reporter only coarse statuses', () => {
    expect(
      statusOf({ withdrawn: true, outcome: null, eligibility: 'eligible', helping: true }),
    ).toBe('withdrawn')
    expect(
      statusOf({ withdrawn: false, outcome: 'void', eligibility: 'eligible', helping: true }),
    ).toBe('removed_after_check')
    expect(
      statusOf({ withdrawn: false, outcome: null, eligibility: 'pending', helping: false }),
    ).toBe('saved')
    expect(
      statusOf({ withdrawn: false, outcome: null, eligibility: 'too_new', helping: false }),
    ).toBe('not_shown')
    expect(
      statusOf({ withdrawn: false, outcome: null, eligibility: 'eligible', helping: true }),
    ).toBe('helping_warn')
  })
})
