import { NOISE_FILTER_RULES } from '@nabvy/config/modules/noise-filter'
import { describe, expect, it } from 'vitest'
import {
  type ClassifyInput,
  classifiedKey,
  classifyOne,
  compile,
  inputHash,
  ruleVersion,
  termKey,
} from '../src/domain'

// The pure rules over synthetic versions: each reason, its negative cases, and the boundary of
// each threshold (negator reach, the description's first characters, the first sentence).

const c = compile(NOISE_FILTER_RULES)
const V = ruleVersion(NOISE_FILTER_RULES)

const base = (over: Partial<ClassifyInput> = {}): ClassifyInput => ({
  listingId: '01920000-0000-7000-8000-000000000001',
  evidenceHash: 'a'.repeat(64),
  kind: 'pc',
  form: 'system',
  title: 'Gaming PC',
  description: null,
  signals: [],
  tagBlocks: [],
  parts: [],
  foundByTerms: ['gaming pc'],
  fetchedAt: null,
  ...over,
})

/** A `wanted_or_swap` signal on `quote`, located in `text`. */
const signal = (text: string, quote: string, source: 'title' | 'description' = 'title') => {
  const start = text.indexOf(quote)
  if (start < 0) throw new Error(`${quote} not in ${text}`)
  return { signal: 'wanted_or_swap' as const, source, quote, start, end: start + quote.length }
}

const titled = (title: string, quote: string, over: Partial<ClassifyInput> = {}) =>
  classifyOne(base({ title, signals: [signal(title, quote)], ...over }), c, V).reasons

const described = (description: string, quote: string, over: Partial<ClassifyInput> = {}) =>
  classifyOne(
    base({ description, signals: [signal(description, quote, 'description')], ...over }),
    c,
    V,
  ).reasons

const part = (
  quote: string,
  inclusion: 'offered' | 'mention' | 'not_included',
  source: 'title' | 'description' = 'description',
) => ({ partType: 'gpu' as const, inclusion, rejected: false, source, quote, start: 0, end: 1 })

describe('wanted, buy-in and swap adverts', () => {
  it('reads the narrow title words', () => {
    expect(titled('WANTED: gaming PC', 'WANTED')).toEqual(['wanted'])
    expect(titled('WTB RTX 3090', 'WTB')).toEqual(['wanted'])
    expect(titled('Looking for a gaming PC', 'Looking for')).toEqual(['wanted'])
    expect(titled('We buy gaming PCs', 'We buy')).toEqual(['buy_in'])
    expect(titled('Cash for your PC', 'Cash for')).toEqual(['buy_in'])
    expect(titled('Buying gaming PCs', 'Buying')).toEqual(['buy_in'])
  })

  it('ignores the broad words and a bare "buying" inside a title', () => {
    expect(titled('Gaming PC, part exchange welcome', 'part exchange')).toEqual([])
    expect(titled('Need a gaming PC? This one', 'Need a')).toEqual([])
    expect(titled('Gaming PC worth buying', 'buying')).toEqual([])
  })

  it('a negator within reach cancels a signal; beyond it does not', () => {
    expect(titled('Gaming PC - no swaps', 'swaps')).toEqual([])
    expect(titled('PC not looking for offers', 'looking for')).toEqual([])
    // "no" starting 12 characters before the signal is within negatorChars (12); 13 is beyond.
    expect(NOISE_FILTER_RULES.negatorChars).toBe(12)
    expect(titled(`PC no${' '.repeat(10)}wanted`, 'wanted')).toEqual([])
    expect(titled(`PC no${' '.repeat(11)}wanted`, 'wanted')).toEqual(['wanted'])
  })

  it('a swap counts only when it opens the title or is followed by "for", never in a sale', () => {
    expect(titled('Swap PS5 for gaming PC', 'Swap')).toEqual(['swap'])
    expect(titled('Will swap my Xbox for a PC', 'swap')).toEqual(['swap'])
    expect(titled('Gaming PC swaps', 'swaps')).toEqual([])
    expect(titled('Gaming PC, swaps considered', 'swaps')).toEqual([])
    expect(titled('Gaming PC for sale or swap', 'swap')).toEqual([])
  })

  it('a description buy-in counts only in the first sentence, first characters, no title part', () => {
    const d = 'I buy all gaming PCs, working or not.'
    expect(described(d, 'I buy')).toEqual(['buy_in'])
    expect(described('Wanted: a gaming PC around £500.', 'Wanted')).toEqual(['wanted'])
    expect(described(d, 'I buy', { parts: [part('RTX 3080', 'offered', 'title')] })).toEqual([])
    const trader = 'Got old tech sitting around? We buy and part-exchange consoles.'
    expect(described(trader, 'We buy')).toEqual([])
    const late = `${'x'.repeat(NOISE_FILTER_RULES.descriptionFirstChars - 1)} i buy`
    expect(described(late, 'i buy')).toEqual([])
    const edge = `${' '.repeat(NOISE_FILTER_RULES.descriptionFirstChars - 1)}i buy`
    expect(described(edge, 'i buy')).toEqual(['buy_in'])
  })
})

describe('kind and form', () => {
  it('a laptop kind and a box-only form are reasons; other kinds are not', () => {
    expect(classifyOne(base({ kind: 'laptop' }), c, V).reasons).toEqual(['laptop'])
    expect(classifyOne(base({ form: 'box_only' }), c, V).reasons).toEqual(['box_only'])
    for (const kind of ['pc', 'not_a_pc', 'wanted_or_swap', null]) {
      expect(classifyOne(base({ kind }), c, V).reasons).toEqual([])
    }
  })
})

describe('service adverts', () => {
  it('reads the title, and the description only when nothing is offered', () => {
    expect(classifyOne(base({ title: 'Gaming pc / Builder and repair' }), c, V).reasons).toEqual([
      'service',
    ])
    expect(classifyOne(base({ title: 'Gaming+PC+repair+service' }), c, V).reasons).toEqual([
      'service',
    ])
    expect(classifyOne(base({ title: 'Gaming PC spares or repairs' }), c, V).reasons).toEqual([])
    expect(classifyOne(base({ title: 'Gaming PC - spares & repairs' }), c, V).reasons).toEqual([])
    const d = 'I provide reliable and affordable PC services.'
    expect(classifyOne(base({ description: d }), c, V).reasons).toEqual(['service'])
    expect(
      classifyOne(base({ description: d, parts: [part('RTX 3080', 'offered')] }), c, V).reasons,
    ).toEqual([])
    expect(classifyOne(base({ description: 'We offer free delivery.' }), c, V).reasons).toEqual([])
  })
})

describe('found-by terms', () => {
  it('reads the model key of a term', () => {
    expect(termKey('rtx 5080', c)?.key).toBe('5080')
    expect(termKey('RTX5080', c)?.key).toBe('5080')
    expect(termKey('4070 ti', c)?.key).toBe('4070ti')
    expect(termKey('gaming pc', c)).toBeNull()
    expect(termKey('ryzen 7', c)).toBeNull()
  })

  const terms = (over: Partial<ClassifyInput>) => classifyOne(base(over), c, V)

  it('mention-only needs every term to name a part the listing only mentions', () => {
    const mention = { parts: [part('5080', 'mention')], description: 'Upgrading to a 5080.' }
    expect(terms({ ...mention, foundByTerms: ['5080'] }).reasons).toEqual(['mention_only'])
    expect(terms({ ...mention, foundByTerms: ['5080', 'gaming pc'] }).reasons).toEqual([])
    expect(
      terms({ parts: [part('RTX 5080', 'not_included')], foundByTerms: ['rtx 5080'] }).reasons,
    ).toEqual(['mention_only'])
    expect(
      terms({
        parts: [part('5080', 'mention'), part('RTX 5080', 'offered')],
        foundByTerms: ['5080'],
      }).reasons,
    ).toEqual([])
    expect(
      terms({ parts: [{ ...part('RTX 5080', 'offered'), rejected: true }], foundByTerms: ['5080'] })
        .reasons,
    ).toEqual(['mention_only'])
    // A 15080 is not a 5080; a 5080 Ti search is not met by a plain 5080 part.
    expect(terms({ parts: [part('15080', 'mention')], foundByTerms: ['5080'] }).terms).toEqual([
      { term: '5080', key: '5080', status: 'absent' },
    ])
    expect(
      terms({ parts: [part('5080', 'offered')], foundByTerms: ['5080 ti'] }).terms[0]?.status,
    ).toBe('absent')
  })

  it('keyword stuffing needs every hit inside a tag block; a hit outside is unplaced', () => {
    const description = 'RTX 3070 PC.\n#rtx5080 #rtx4090 #gamingpc'
    const block = { source: 'description' as const, start: 13, end: description.length }
    expect(terms({ description, tagBlocks: [block], foundByTerms: ['5080'] }).reasons).toEqual([
      'keyword_stuffing',
    ])
    const also = `Like a 5080. ${description}`
    const shifted = { ...block, start: block.start + 13, end: also.length }
    expect(
      terms({ description: also, tagBlocks: [shifted], foundByTerms: ['5080'] }).terms,
    ).toEqual([{ term: '5080', key: '5080', status: 'unplaced' }])
    expect(terms({ description: 'RTX 3070 PC.', foundByTerms: ['5080'] }).reasons).toEqual([])
    expect(terms({ foundByTerms: [] }).reasons).toEqual([])
  })
})

describe('versions and keys', () => {
  it('the rule version has its format and follows the rules', () => {
    expect(V).toMatch(/^n\d+\.[0-9a-f]{8}$/)
    expect(ruleVersion({ ...NOISE_FILTER_RULES, negatorChars: 13 })).not.toBe(V)
  })

  it('the input hash ignores order and case of terms, and follows every input', () => {
    const a = base({ foundByTerms: ['5080', 'Gaming PC'] })
    expect(inputHash(a)).toBe(inputHash(base({ foundByTerms: ['gaming pc', '5080', '5080'] })))
    expect(inputHash(a)).not.toBe(inputHash({ ...a, kind: 'laptop' }))
    expect(inputHash(a)).toBe(inputHash({ ...a, fetchedAt: new Date() }))
  })

  it('the event key sorts its rows and carries the batch index', () => {
    const rows = [
      { listingId: 'b', evidenceHash: 'h', inputHash: 'i', ruleVersion: V },
      { listingId: 'a', evidenceHash: 'h', inputHash: 'i', ruleVersion: V },
    ]
    expect(classifiedKey(rows, 0)).toBe(classifiedKey([...rows].reverse(), 0))
    expect(classifiedKey(rows, 1)).not.toBe(classifiedKey(rows, 0))
    expect(classifiedKey(rows, 0)).toMatch(/^noise-filter\.classified:[0-9a-f]{64}:0$/)
  })
})
