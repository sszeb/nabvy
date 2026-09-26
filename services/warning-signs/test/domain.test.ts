import { WARNING_SIGNS_RULES } from '@nabvy/config/modules/warning-signs'
import { describe, expect, it } from 'vitest'
import {
  clauses,
  compile,
  type EvaluateInput,
  evaluateOne,
  inputHash,
  isFacebookHost,
  lowestGroup,
  payFirstOf,
  ruleVersion,
} from '../src/domain'

// Pure rules: every rule on positive and negative text, and the boundary of each threshold.

const C = compile(WARNING_SIGNS_RULES)
const V = ruleVersion(WARNING_SIGNS_RULES)
const PAD = ' Kept in a smoke-free home, thanks for looking.'
const base: EvaluateInput = {
  listingId: '00000000-0000-4000-8007-000000000001',
  evidenceHash: 'a'.repeat(64),
  cardHash: 'b'.repeat(64),
  title: 'RTX 3090',
  description: `Great card.${PAD}`,
  descriptionStatus: 'full_verified',
  fetchedAt: null,
  cautions: [],
  exclusions: [],
  groups: [],
}
const codes = (over: Partial<EvaluateInput>) =>
  evaluateOne({ ...base, ...over }, C, V)
    .facts.map((f) => (f.reason ? `${f.code}:${f.reason}` : f.code))
    .sort()
const desc = (d: string) => codes({ description: `${d}${PAD}` })

describe('clauses', () => {
  it('splits at sentence and clause ends but keeps M.2 and £1,500 whole', () => {
    expect(
      clauses('M.2 SSD, £1,500 ono. Cash only!\nThanks', 'description').map((c) => c.text),
    ).toEqual(['M.2 SSD', '£1,500 ono', 'Cash only', 'Thanks'])
    const [, second] = clauses('One. Two', 'title')
    expect(second).toEqual({ source: 'title', text: 'Two', start: 5 })
  })
})

describe('pay first (L2)', () => {
  const pay = (s: string) => payFirstOf(C, s)
  it('counts deposits, friends and family and vouchers at any time', () => {
    expect(pay('£100 deposit by bank transfer to hold')?.kind).toBe('deposit')
    expect(pay('PayPal F&F only')?.kind).toBe('friends_and_family')
    expect(pay('crypto accepted')?.kind).toBe('voucher_gift_or_crypto')
  })
  it('needs a before-cue and no exclusion for bank transfer and other payment', () => {
    expect(pay('bank transfer only')).toBeNull()
    expect(desc("Can't do in person, bank transfer before I post")).toEqual(['pay_first_text'])
    expect(pay('bank transfer upfront')).toEqual({ kind: 'bank_transfer', beforeCue: true })
    expect(pay('cash or bank transfer on pickup')).toBeNull()
    expect(pay('pay first')?.kind).toBe('other')
    expect(pay('payment on collection first come first served')).toBeNull()
  })
  it('reads negation, BT only in a payment clause, and digit spellings', () => {
    expect(pay('no deposit needed')).toBeNull()
    expect(pay('BT postcode')).toBeNull()
    expect(pay('BT payment upfront')?.kind).toBe('bank_transfer')
    expect(pay('d3p0sit t0 h0ld')?.kind).toBe('deposit')
  })
  it('keeps the riskiest kind in a listing and quotes its clause, redacted', () => {
    const e = evaluateOne(
      { ...base, description: `Pay upfront. Or PayPal gift, text 07700 900123.${PAD}` },
      C,
      V,
    )
    const f = e.facts.find((x) => x.code === 'pay_first_text')
    expect(f?.evidence).toMatchObject({ type: 'quote', payKind: 'friends_and_family' })
    expect(f?.evidenceText).toBe('Or PayPal gift')
    const contact = e.facts.find((x) => x.code === 'off_platform_contact_text')
    expect(contact?.evidenceText).toBe('text [phone redacted]')
  })
})

describe('text rules', () => {
  it.each([
    ['Facebook delivery available', 'platform_claim_text'],
    ['working away at the moment', 'away_story_text'],
    ['message me on WhatsApp', 'off_platform_contact_text'],
    ['lots of interest so be quick', 'urgency_text'],
    ['welcome to test before buying', 'viewing_offered_text'],
    ['cash on collection', 'payment_on_collection_text'],
    ['pay by card at collection', 'protected_payment_text'],
    ['hashrate 120 MH/s', 'mining_text'],
    ['untested', 'untested_text'],
    ['spares or repairs', 'not_working_text'],
    ['7 day warranty on all purchases', 'stock_phrasing_text'],
  ])('%s → %s', (text, code) => {
    expect(desc(text)).toContain(code)
  })

  it.each([
    'graphics card in great shape',
    'never mined on',
    'not abroad',
    'no viewings',
    'working or faulty stock bought',
    'see facebook.com/marketplace',
    'thermal pads @ BACK PANEL',
    'rig runs well',
  ])('%s → nothing', (text) => {
    expect(desc(text)).toEqual([])
  })

  it('a link that is not Facebook is a platform claim and a contact', () => {
    expect(desc('see www.example.co.uk')).toEqual([
      'off_platform_contact_text',
      'platform_claim_text',
    ])
    expect(isFacebookHost('https://m.facebook.com/x')).toBe(true)
    expect(isFacebookHost('facebook.com.evil.io')).toBe(false)
  })

  it('reads the description only when it is full_verified', () => {
    expect(codes({ description: 'untested', descriptionStatus: 'partial' })).toEqual([])
    expect(
      codes({ title: 'RTX 3090 untested', descriptionStatus: 'missing', description: null }),
    ).toEqual(['untested_text'])
  })

  it('thin text: under 40 characters once template text is removed', () => {
    const at = (n: number) => codes({ description: 'x'.repeat(n) })
    expect(at(39)).toEqual(['thin_text'])
    expect(at(40)).toEqual([])
    expect(
      codes({ description: `Works fine. (Specify if you are willing to deliver locally)` }),
    ).toEqual(['thin_text'])
  })

  it('payment on collection does not fire on a clause that demands a deposit', () => {
    expect(desc('cash on collection after a £20 deposit')).toEqual(['pay_first_text'])
  })

  it('box only comes from the assessment caution', () => {
    expect(codes({ cautions: ['box_only'] })).toEqual(['box_only'])
    expect(codes({ cautions: null })).toEqual([])
  })
})

describe('asks far below similar asks', () => {
  const g = (askMinor: number, n: number | null = 10, medianMinor: number | null = 100_00) => ({
    groupKey: 'g',
    asOf: '2026-09-25T12:00:00.000Z',
    askMinor,
    medianMinor,
    n,
    currency: 'GBP',
  })
  it('compares at n ≥ 10 and a ratio ≤ 0.6 only', () => {
    expect(lowestGroup(WARNING_SIGNS_RULES, [g(60_00)])?.ratio).toBe(0.6)
    expect(lowestGroup(WARNING_SIGNS_RULES, [g(60_01)])).toBeNull()
    expect(lowestGroup(WARNING_SIGNS_RULES, [g(10_00, 9)])).toBeNull()
    expect(lowestGroup(WARNING_SIGNS_RULES, [g(10_00, null)])).toBeNull()
    expect(lowestGroup(WARNING_SIGNS_RULES, [g(10_00, 10, null)])).toBeNull()
  })
  it('picks the lowest ratio among groups', () => {
    const low = lowestGroup(WARNING_SIGNS_RULES, [
      g(50_00),
      { ...g(50_00), groupKey: 'h', medianMinor: 200_00 },
    ])
    expect(low?.groupKey).toBe('h')
  })
  it('material-state wording explains a low ask; swaps, offers and cosmetics do not', () => {
    expect(codes({ groups: [g(20_00)], description: `Faulty fan.${PAD}` })).toEqual([
      'low_ask_explained:named_fault',
    ])
    expect(codes({ groups: [g(20_00)], description: `No GPU included.${PAD}` })).toEqual([
      'low_ask_explained:core_part_missing',
    ])
    expect(codes({ groups: [g(20_00)], exclusions: [{ partType: 'ram', seq: 2 }] })).toEqual([
      'low_ask_explained:part_not_included',
    ])
    expect(
      codes({ groups: [g(20_00)], description: `Swaps, offers, a few scuffs.${PAD}` }),
    ).toEqual([
      'ask_far_below_similar',
      'low_ask_explained:cosmetic',
      'low_ask_explained:offers',
      'low_ask_explained:swap_or_trade',
    ])
  })
  it('the ask evidence carries the group, figures and version', () => {
    const e = evaluateOne({ ...base, groups: [g(30_00)] }, C, V)
    expect(e.facts[0]?.evidence).toEqual({
      type: 'ask',
      groupKey: 'g',
      asOf: '2026-09-25T12:00:00.000Z',
      askMinor: 30_00,
      medianMinor: 100_00,
      n: 10,
      currency: 'GBP',
      ratio: 0.3,
    })
  })
})

describe('versions and hashes', () => {
  it('the rule version is w<generation>.<digest>', () => {
    expect(V).toMatch(/^w1\.[0-9a-f]{8}$/)
  })
  it('the input hash moves with any input and not with order', () => {
    const h = inputHash(base)
    expect(inputHash({ ...base, cautions: [] })).toBe(h)
    expect(inputHash({ ...base, cautions: null })).not.toBe(h)
    expect(inputHash({ ...base, cardHash: 'c'.repeat(64) })).not.toBe(h)
    const g1 = { groupKey: 'a', asOf: 'x', askMinor: 1, medianMinor: 2, n: 10, currency: 'GBP' }
    const g2 = { ...g1, groupKey: 'b' }
    expect(inputHash({ ...base, groups: [g1, g2] })).toBe(inputHash({ ...base, groups: [g2, g1] }))
    expect(inputHash({ ...base, groups: [{ ...g1, asOf: 'y' }] })).not.toBe(
      inputHash({ ...base, groups: [g1] }),
    )
  })
  it('never scores: facts carry evidence, a rule ID and nothing else', () => {
    const e = evaluateOne({ ...base, description: `Sold as seen.${PAD}` }, C, V)
    for (const f of e.facts) {
      expect(Object.keys(f).sort()).toEqual([
        'code',
        'evidence',
        'evidenceText',
        'reason',
        'ruleId',
      ])
      expect(f.ruleId).toBe(`warning-signs.${f.code}`)
    }
  })
})
