import { LISTING_ASSESSMENT_RULES as RULES } from '@nabvy/config/modules/listing-assessment'
import { describe, expect, it } from 'vitest'
import {
  type AssessmentInput,
  assessedKey,
  assessOne,
  cleanContext,
  containerOf,
  findPhrases,
  type PartInput,
  recordHash,
  ruleVersion,
} from '../src/domain'

// The pure rules (R1-R6 of the card), on synthetic inputs built from the recorded run's wording,
// including the boundary of each threshold.

const HASH = 'a'.repeat(64)
let seq = 0
const part = (p: Partial<PartInput> & Pick<PartInput, 'partType' | 'quote'>): PartInput => ({
  seq: seq++,
  catalogueId: null,
  inclusion: 'offered',
  rejected: false,
  source: 'description',
  extractor: 'rules',
  start: 0,
  end: p.quote.length,
  conflict: false,
  ...p,
})

/** An input whose description is `description`, with parts quoted where they sit in it. */
function input(
  description: string,
  quotes: [PartInput['partType'], string, Partial<PartInput>?][] = [],
  more: Partial<AssessmentInput> = {},
): AssessmentInput {
  seq = 0
  return {
    listingId: '01920000-0000-7000-8000-000000000001',
    evidenceHash: HASH,
    cardHash: 'b'.repeat(64),
    displayedPreviousMinor: null,
    title: 'Gaming PC',
    description,
    descriptionStatus: 'full_verified',
    hasDescription: true,
    attributes: [],
    detailSections: [],
    staleFallback: false,
    record: {
      kind: 'pc',
      kindGap: null,
      ruleVersion: 'r1.00000000',
      aiVersion: null,
      photoVersion: null,
    },
    parts: quotes.map(([partType, quote, extra]) => {
      const start = description.indexOf(quote)
      return part({ partType, quote, start, end: start + quote.length, ...extra })
    }),
    ...more,
  }
}

describe('container (R1, R1b)', () => {
  it('two of CPU, RAM and storage make a container; one does not', () => {
    const two = input('CPU: i5-12400F\nRAM: 16GB', [
      ['cpu', 'i5-12400F'],
      ['ram_size', '16GB'],
    ])
    const one = input('CPU: i5-12400F', [['cpu', 'i5-12400F']], {
      record: { ...two.record, kind: 'not_a_pc' },
    })
    expect(RULES.containerMinCoreParts).toBe(2)
    expect(containerOf(two, RULES)).toEqual({ container: true, reason: 'parts' })
    expect(containerOf(one, RULES)).toEqual({ container: false, reason: 'placed' })
  })

  it('title parts do not count for R1; RAM size and generation are one part', () => {
    const i = input('RAM: 16GB DDR4', [
      ['ram_size', '16GB'],
      ['ram_generation', 'DDR4'],
    ])
    i.parts.push(part({ partType: 'cpu', quote: 'i7', source: 'title' }))
    expect(containerOf({ ...i, record: { ...i.record, kind: 'laptop' } }, RULES)).toEqual({
      container: false,
      reason: 'placed',
    })
  })

  it('mentions, exclusions and rejected rows do not count', () => {
    const i = input('i7 not included. 16GB', [
      ['cpu', 'i7', { inclusion: 'not_included' }],
      ['ram_size', '16GB', { rejected: true }],
    ])
    expect(containerOf({ ...i, record: { ...i.record, kind: 'not_a_pc' } }, RULES).container).toBe(
      false,
    )
  })

  it('seller attributes, "Is for gaming: Yes" and title words count (R1b)', () => {
    const base = input('')
    const placed = { ...base.record, kind: 'not_a_pc' as const }
    expect(
      containerOf(
        {
          ...base,
          record: placed,
          detailSections: [
            { name: 'Processor type', label: 'AMD Ryzen 5 3600', value: 'AMD Ryzen 5 3600' },
          ],
        },
        RULES,
      ).reason,
    ).toBe('attributes')
    const gaming = (value: string) =>
      containerOf(
        { ...base, record: placed, attributes: [{ name: 'Is for gaming', label: null, value }] },
        RULES,
      ).reason
    expect(gaming('Yes')).toBe('attributes')
    expect(gaming('No')).toBe('placed')
    expect(containerOf({ ...base, record: placed, title: 'Full setup' }, RULES).reason).toBe(
      'title_words',
    )
    expect(containerOf({ ...base, record: placed, title: 'Job lot' }, RULES).reason).toBe(
      'title_words',
    )
  })

  it('a PC kind is a container; an open kind is treated as one; box only never is', () => {
    const base = input('')
    expect(containerOf(base, RULES).reason).toBe('kind')
    expect(
      containerOf({ ...base, record: { ...base.record, kind: null, kindGap: 'no_signal' } }, RULES),
    ).toEqual({
      container: true,
      reason: 'unplaced',
    })
    expect(containerOf({ ...base, title: 'RTX 3080 box only' }, RULES)).toEqual({
      container: false,
      reason: 'box_only',
    })
  })
})

describe('bundle extras (R1c)', () => {
  it('included extras make a bundle with a bundle-price caution', () => {
    const a = assessOne(input('Custom gaming PC with keyboard and mouse included.'), RULES)
    expect(a.form).toBe('bundle')
    expect(a.extras.map((e) => e.item)).toEqual(['keyboard', 'mouse'])
    expect(a.cautions).toContain('bundle_price')
  })

  it('optional, extra-cost and excluded extras are left out', () => {
    for (const text of [
      'I do also have a 1080p monitor to sell with it if needed.',
      'Also have a headset and keyboard and mouse for extra.',
      'This dose not include HDMi lead or keyboard or mouse',
      'Comes without a monitor.',
      'Benchmark: Game 125%, Desk 119%, Work 148%.',
    ]) {
      const a = assessOne(input(text), RULES)
      expect(a.extras, text).toEqual([])
      expect(a.form, text).toBe('system')
    }
  })

  it('an extra in another sentence than the demoter still counts', () => {
    const a = assessOne(input('Comes with a monitor.\nKeyboard not included.'), RULES)
    expect(a.extras.map((e) => e.item)).toEqual(['monitor'])
  })

  it('"KBM" names both; "mouse pad" is not also a mouse; a non-container has no extras', () => {
    const a = assessOne({ ...input(''), title: 'Gaming PC + Monitor + KBM' }, RULES)
    expect(a.extras.map((e) => `${e.item}:${e.quote}`)).toEqual([
      'monitor:Monitor',
      'keyboard:KBM',
      'mouse:KBM',
    ])
    expect(assessOne(input('Comes with a mouse pad.'), RULES).extras.map((e) => e.item)).toEqual([
      'mouse pad',
    ])
    const headset = input('Turtle Beach headset with a mouse.')
    expect(
      assessOne({ ...headset, record: { ...headset.record, kind: 'not_a_pc' } }, RULES).extras,
    ).toEqual([])
  })
})

describe('GPU state', () => {
  it('named, conflicting, none, integrated, in photos, not stated', () => {
    const state = (i: AssessmentInput) => assessOne(i, RULES).gpuState
    expect(state(input('GPU: RTX 3070', [['gpu', 'RTX 3070']]))).toBe('named')
    expect(state(input('RTX 3070 / RX 6800', [['gpu', 'RTX 3070', { conflict: true }]]))).toBe(
      'conflicting',
    )
    expect(state(input('RTX 3070. No GPU included really', [['gpu', 'RTX 3070']]))).toBe(
      'conflicting',
    )
    expect(
      state(input('RTX 4090 not included', [['gpu', 'RTX 4090', { inclusion: 'not_included' }]])),
    ).toBe('none')
    expect(state(input('Sold without a graphics card.'))).toBe('none')
    expect(state(input('No GPU issues at all.'))).toBe('not_stated')
    expect(state(input('Ryzen 5 5600G, integrated graphics'))).toBe('integrated')
    const photo = input('')
    photo.parts.push(
      part({
        partType: 'gpu',
        quote: 'photo-1',
        source: 'photo',
        extractor: 'photo',
        start: 0,
        end: 1,
      }),
    )
    expect(state(photo)).toBe('in_photos')
    expect(state(input('Great PC, ready to go.'))).toBe('not_stated')
  })

  it('a GPU mention is not a GPU; silence is never none', () => {
    const a = assessOne(
      input('Upgraded to an RTX 4070', [['gpu', 'RTX 4070', { inclusion: 'mention' }]]),
      RULES,
    )
    expect(a.gpuState).toBe('not_stated')
    expect(a.unknowns).toContain('gpu')
  })

  it('a box-only listing sells no GPU', () => {
    const i = {
      ...input('Empty box for an RTX 3080', [['gpu', 'RTX 3080']]),
      title: 'RTX 3080 box only',
    }
    const a = assessOne(i, RULES)
    expect(a).toMatchObject({
      form: 'box_only',
      gpuState: 'not_stated',
      confirmedParts: [],
      unknowns: [],
    })
    expect(a.cautions).toEqual(['box_only'])
  })
})

describe('confirmed parts (R5)', () => {
  it('a verbatim, fresh quote with a clean context is confirmed', () => {
    const a = assessOne(
      input('GPU: RTX 3070\nRAM: 16GB', [
        ['gpu', 'RTX 3070'],
        ['ram_size', '16GB'],
      ]),
      RULES,
    )
    expect(a.confirmedParts.map((p) => p.quote)).toEqual(['RTX 3070', '16GB'])
  })

  it('a demoting word within the clean context stops it; one on another line does not', () => {
    const near = input('GPU: RTX 3070, upgraded to it last year', [['gpu', 'RTX 3070']])
    expect(assessOne(near, RULES).confirmedParts).toEqual([])
    const apart = input('Swap wanted for bike.\nGPU: RTX 3070', [['gpu', 'RTX 3070']])
    expect(assessOne(apart, RULES).confirmedParts.map((p) => p.quote)).toEqual(['RTX 3070'])
  })

  it('the context boundary is contextChars: a demoter just past it does not count', () => {
    // The quote ends at 8, so the window ends at 8 + contextChars.
    const pad = (n: number) => 'x'.repeat(n)
    const inside = input(`RTX 3070 ${pad(RULES.contextChars - 10)} swap`, [['gpu', 'RTX 3070']])
    const outside = input(`RTX 3070 ${pad(RULES.contextChars)} swap`, [['gpu', 'RTX 3070']])
    expect(cleanContext(outside.description ?? '', 0, 8, RULES.contextChars)).not.toContain('swap')
    expect(assessOne(inside, RULES).confirmedParts).toEqual([])
    expect(assessOne(outside, RULES).confirmedParts).toHaveLength(1)
  })

  it('not verbatim, a photo, stale text or a partial description: not confirmed', () => {
    const moved = input('GPU: RTX 3070', [['gpu', 'RTX 3070']])
    moved.parts[0] = { ...(moved.parts[0] as PartInput), start: 0 }
    expect(assessOne(moved, RULES).confirmedParts).toEqual([])
    const i = input('GPU: RTX 3070', [['gpu', 'RTX 3070']])
    expect(assessOne({ ...i, staleFallback: true }, RULES).confirmedParts).toEqual([])
    expect(assessOne({ ...i, descriptionStatus: 'partial' }, RULES).confirmedParts).toEqual([])
    const attr = input('', [], {
      attributes: [
        { name: 'Processor type', label: 'AMD Ryzen 5 3600', value: 'AMD Ryzen 5 3600' },
      ],
    })
    attr.parts.push(
      part({ partType: 'cpu', quote: 'Ryzen 5 3600', source: 'attribute', start: 4, end: 16 }),
    )
    expect(assessOne(attr, RULES).confirmedParts.map((p) => p.source)).toEqual(['attribute'])
  })
})

describe('cautions, coverage and unknowns', () => {
  it('each caution is a fact from its input', () => {
    const a = assessOne({ ...input(''), displayedPreviousMinor: 49900, staleFallback: true }, RULES)
    expect(a.cautions).toEqual(['previous_price', 'stale_text'])
  })

  it('coverage says what was read', () => {
    expect(assessOne(input('x'), RULES).coverage).toEqual({
      title: true,
      fullDescription: true,
      photos: false,
    })
    const i = input('x', [], { descriptionStatus: 'partial' })
    expect(
      assessOne({ ...i, record: { ...i.record, photoVersion: 'v1.00000000' } }, RULES).coverage,
    ).toEqual({
      title: true,
      fullDescription: false,
      photos: true,
    })
  })

  it('unknowns list the core parts a container leaves unstated; none for a non-container', () => {
    const a = assessOne(
      input('CPU: i5\nRAM: 16GB', [
        ['cpu', 'i5'],
        ['ram_size', '16GB'],
      ]),
      RULES,
    )
    expect(a.unknowns).toEqual(['gpu', 'storage_size'])
    const b = input('')
    expect(assessOne({ ...b, record: { ...b.record, kind: 'not_a_pc' } }, RULES).unknowns).toEqual(
      [],
    )
  })

  it('a non-container with an offered part is a part; with none, unknown', () => {
    const i = input('RTX 3070 FE', [['gpu', 'RTX 3070']])
    expect(assessOne({ ...i, record: { ...i.record, kind: 'not_a_pc' } }, RULES).form).toBe('part')
    const j = input('Headset')
    expect(assessOne({ ...j, record: { ...j.record, kind: 'not_a_pc' } }, RULES).form).toBe(
      'unknown',
    )
  })
})

describe('versions and keys', () => {
  it('the rule version follows the rules; the record hash follows the parts', () => {
    expect(ruleVersion(RULES)).toMatch(/^a1\.[0-9a-f]{8}$/)
    expect(ruleVersion({ ...RULES, contextChars: 81 })).not.toBe(ruleVersion(RULES))
    const i = input('GPU: RTX 3070', [['gpu', 'RTX 3070']])
    const struck = i.parts.map((p) => ({ ...p, rejected: true }))
    expect(recordHash(i.record, struck)).not.toBe(recordHash(i.record, i.parts))
    expect(recordHash(i.record, [...i.parts].reverse())).toBe(recordHash(i.record, i.parts))
  })

  it('the event key is order-free and changes with any input', () => {
    const row = {
      listingId: 'l1',
      evidenceHash: HASH,
      cardHash: null,
      recordHash: HASH,
      ruleVersion: 'a1.00000000',
    }
    const other = { ...row, listingId: 'l2' }
    expect(assessedKey([row, other], 0)).toBe(assessedKey([other, row], 0))
    expect(assessedKey([row], 0)).not.toBe(assessedKey([{ ...row, cardHash: HASH }], 0))
    expect(assessedKey([row], 0)).toMatch(/^listing-assessment\.assessed:[0-9a-f]{64}:0$/)
  })

  it('phrases match on word boundaries, `+` read as a space', () => {
    expect(findPhrases('Gaming+PC+bundle', ['bundle'])).toHaveLength(1)
    expect(findPhrases('bundled', ['bundle'])).toHaveLength(0)
    expect(findPhrases('for an extra £20', ['extra £'])).toHaveLength(1)
  })
})
