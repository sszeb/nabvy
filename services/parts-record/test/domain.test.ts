import type { PartsAiPart } from '@nabvy/contracts/modules/parts-ai'
import type { PartsRulesKindSignal, PartsRulesPart } from '@nabvy/contracts/modules/parts-rules'
import { describe, expect, it } from 'vitest'
import {
  addsInformation,
  carryCorrections,
  findConflicts,
  identity,
  type MergedPart,
  merge,
  mergeKind,
  type RulesInput,
  recordedKey,
} from '../src/domain'

// Pure rules: the kind decision, the merge order and inclusion decision, conflicts (and what
// never conflicts), the carry-forward of corrections, what counts as new information, and the
// event key.

const LISTING = '01920000-0000-7000-8000-000000000001'
const HASH = 'a'.repeat(64)

const ruleHit = (over: Partial<PartsRulesPart>): PartsRulesPart => ({
  listingId: LISTING,
  evidenceHash: HASH,
  ruleVersion: 'r1.00000000',
  seq: 0,
  partType: 'gpu',
  catalogueId: 'gpu:nvidia:rtx-3080:10gb',
  attrs: {},
  inclusionCandidate: 'offered',
  source: 'description',
  quote: 'RTX 3080',
  start: 10,
  end: 18,
  ruleId: 'gpu',
  correction: null,
  ...over,
})

const aiHit = (over: Partial<PartsAiPart>): PartsAiPart => ({
  listingId: LISTING,
  evidenceHash: HASH,
  promptVersion: 'p1.00000000',
  seq: 0,
  partType: 'gpu',
  catalogueId: 'gpu:nvidia:rtx-3080:10gb',
  family: null,
  inclusion: 'offered',
  source: 'description',
  quote: 'RTX 3080',
  start: 10,
  end: 18,
  correction: null,
  ...over,
})

const signal = (over: Partial<PartsRulesKindSignal>): PartsRulesKindSignal => ({
  listingId: LISTING,
  evidenceHash: HASH,
  ruleVersion: 'r1.00000000',
  signal: 'pc',
  source: 'title',
  quote: 'Gaming PC',
  start: 0,
  end: 9,
  ruleId: 'kind',
  ...over,
})

const rules = (over: Partial<RulesInput> = {}): RulesInput => ({
  ruleVersion: 'r1.00000000',
  kind: 'pc',
  kindGap: null,
  parts: [],
  signals: [signal({})],
  ...over,
})

const part = (over: Partial<MergedPart>): MergedPart => ({
  seq: 0,
  partType: 'gpu',
  catalogueId: null,
  attrs: {},
  inclusion: 'offered',
  source: 'description',
  extractor: 'rules',
  extractorVersion: 'r1.00000000',
  quote: 'x',
  start: 0,
  end: 1,
  conflict: false,
  ...over,
})

const FAMILIES = new Map<string, string | null>([
  ['gpu:nvidia:rtx-3080:10gb', 'rtx-3080'],
  ['gpu:nvidia:rtx-3080:12gb', 'rtx-3080'],
  ['gpu:nvidia:rtx-3080-ti:12gb', 'rtx-3080-ti'],
  ['cpu:amd:ryzen-7-5000', 'ryzen-7'],
])

describe('mergeKind', () => {
  it('the rules win where they settled it, quoted from the signal that bears it out', () => {
    const k = mergeKind(
      rules({ signals: [signal({ signal: 'cpu_or_pc', quote: 'Ryzen', start: 3, end: 8 })] }),
      {
        promptVersion: 'p1.00000000',
        kind: {
          kind: 'laptop',
          kindSource: 'title',
          kindQuote: 'Laptop',
          kindStart: 0,
          kindEnd: 6,
        },
        parts: [],
      },
    )
    expect(k).toMatchObject({
      kind: 'pc',
      kindBy: 'rules',
      kindQuote: 'Ryzen',
      kindStart: 3,
      kindEnd: 8,
      kindGap: null,
    })
  })

  it('a settled kind with no matching signal has no quote', () => {
    const k = mergeKind(rules({ kind: 'laptop' }), null)
    expect(k).toMatchObject({ kind: 'laptop', kindBy: 'rules', kindQuote: null, kindSource: null })
  })

  it('the model settles what the rules left open, with its quote', () => {
    const k = mergeKind(rules({ kind: null, kindGap: 'no_signal', signals: [] }), {
      promptVersion: 'p1.00000000',
      kind: {
        kind: 'not_a_pc',
        kindSource: 'title',
        kindQuote: 'Headset',
        kindStart: 0,
        kindEnd: 7,
      },
      parts: [],
    })
    expect(k).toMatchObject({ kind: 'not_a_pc', kindBy: 'ai', kindQuote: 'Headset', kindGap: null })
  })

  it('open when nobody settled it, with the rules reason (no_signal by default)', () => {
    expect(mergeKind(rules({ kind: null, kindGap: 'conflict', signals: [] }), null)).toMatchObject({
      kind: null,
      kindGap: 'conflict',
      kindBy: null,
    })
    expect(
      mergeKind(rules({ kind: null, kindGap: null, signals: [] }), {
        promptVersion: 'p1.00000000',
        kind: { kind: null, kindSource: null, kindQuote: null, kindStart: null, kindEnd: null },
        parts: [],
      }),
    ).toMatchObject({ kind: null, kindGap: 'no_signal' })
  })
})

describe('merge', () => {
  it('rule hits first, then AI parts, then photo verdicts, each with its extractor version', () => {
    const m = merge({
      listingId: LISTING,
      evidenceHash: HASH,
      rules: rules({
        parts: [
          ruleHit({ seq: 0 }),
          ruleHit({
            seq: 1,
            partType: 'ram_size',
            catalogueId: null,
            attrs: { gb: 16 },
            quote: '16GB',
            start: 20,
            end: 24,
          }),
        ],
      }),
      ai: {
        promptVersion: 'p1.00000000',
        kind: { kind: null, kindSource: null, kindQuote: null, kindStart: null, kindEnd: null },
        parts: [
          aiHit({
            partType: 'cpu',
            catalogueId: null,
            family: 'ryzen-5',
            quote: 'Ryzen 5',
            start: 30,
            end: 37,
          }),
        ],
      },
      photo: {
        photoVersion: 'v1.00000000',
        verdicts: [
          {
            listingId: LISTING,
            evidenceHash: HASH,
            photoVersion: 'v1.00000000',
            partType: 'gpu',
            catalogueId: null,
            family: null,
            photoId: 'ph1',
          },
        ],
      },
      families: FAMILIES,
    })
    expect(
      m.parts.map((p) => [p.seq, p.extractor, p.partType, p.extractorVersion, p.source]),
    ).toEqual([
      [0, 'rules', 'gpu', 'r1.00000000', 'description'],
      [1, 'rules', 'ram_size', 'r1.00000000', 'description'],
      [2, 'ai', 'cpu', 'p1.00000000', 'description'],
      [3, 'photo', 'gpu', 'v1.00000000', 'photo'],
    ])
    expect(m.parts[2]?.attrs).toEqual({ family: 'ryzen-5' })
    expect(m.parts[3]).toMatchObject({
      quote: 'ph1',
      start: 0,
      end: 1,
      inclusion: 'offered',
      conflict: false,
    })
    expect(m).toMatchObject({
      ruleVersion: 'r1.00000000',
      aiVersion: 'p1.00000000',
      photoVersion: 'v1.00000000',
      kind: 'pc',
      conflict: false,
    })
  })

  it('a source module correction is applied at the door: rejected rows drop, inclusion is corrected', () => {
    const c = { by: LISTING, reason: 'r', at: '2026-09-25T00:00:00.000Z' }
    const m = merge({
      listingId: LISTING,
      evidenceHash: HASH,
      rules: rules({
        parts: [
          ruleHit({ seq: 0, correction: { ...c, rejected: true } }),
          ruleHit({ seq: 1, correction: { ...c, inclusion: 'mention' } }),
        ],
      }),
      ai: {
        promptVersion: 'p1.00000000',
        kind: { kind: null, kindSource: null, kindQuote: null, kindStart: null, kindEnd: null },
        parts: [aiHit({ inclusion: 'offered', correction: { ...c, inclusion: 'not_included' } })],
      },
      photo: null,
      families: FAMILIES,
    })
    expect(m.parts.map((p) => [p.extractor, p.inclusion])).toEqual([
      ['rules', 'mention'],
      ['ai', 'not_included'],
    ])
    expect(m).toMatchObject({ aiVersion: 'p1.00000000', photoVersion: null })
  })
})

describe('identity and conflicts', () => {
  it('a resolved GPU carries the catalogue family; an unresolved one its own; storage nothing', () => {
    expect(
      identity(part({ partType: 'gpu', catalogueId: 'gpu:nvidia:rtx-3080:10gb' }), FAMILIES),
    ).toEqual({ family: 'rtx-3080', value: 'gpu:nvidia:rtx-3080:10gb' })
    expect(identity(part({ partType: 'gpu', attrs: { family: 'rtx-3080' } }), FAMILIES)).toEqual({
      family: 'rtx-3080',
      value: null,
    })
    expect(
      identity(part({ partType: 'storage_size', attrs: { amount: 2, unit: 'tb' } }), FAMILIES),
    ).toEqual({ family: null, value: null })
    expect(identity(part({ partType: 'ram_size', attrs: { gb: 32 } }), FAMILIES)).toEqual({
      family: null,
      value: '32gb',
    })
    expect(identity(part({ partType: 'psu_wattage', attrs: { watts: 850 } }), FAMILIES)).toEqual({
      family: null,
      value: '850w',
    })
    expect(identity(part({ partType: 'chipset', attrs: { chipset: 'B550' } }), FAMILIES)).toEqual({
      family: null,
      value: 'b550',
    })
  })

  it('two families among offered GPUs conflict; an unresolved hit of the same family does not', () => {
    const parts = [
      part({ partType: 'gpu', catalogueId: 'gpu:nvidia:rtx-3080-ti:12gb' }),
      part({ partType: 'gpu', attrs: { family: 'rtx-3080' } }),
      part({ partType: 'gpu', catalogueId: 'gpu:nvidia:rtx-3080-ti:12gb', extractor: 'ai' }),
      part({ partType: 'cpu', catalogueId: 'cpu:amd:ryzen-7-5000' }),
    ]
    expect([...findConflicts(parts, FAMILIES)].sort()).toEqual([0, 1, 2])
    expect(
      findConflicts(
        [
          part({ partType: 'gpu', catalogueId: 'gpu:nvidia:rtx-3080:10gb' }),
          part({ partType: 'gpu', attrs: { family: 'rtx-3080' } }),
        ],
        FAMILIES,
      ).size,
    ).toBe(0)
  })

  it('two variants of one family conflict on the catalogue ID', () => {
    expect(
      findConflicts(
        [
          part({ partType: 'gpu', catalogueId: 'gpu:nvidia:rtx-3080:10gb' }),
          part({ partType: 'gpu', catalogueId: 'gpu:nvidia:rtx-3080:12gb' }),
        ],
        FAMILIES,
      ).size,
    ).toBe(2)
  })

  it('mentions, not-included parts, storage and parts stating nothing never conflict', () => {
    const parts = [
      part({ partType: 'gpu', catalogueId: 'gpu:nvidia:rtx-3080:10gb' }),
      part({ partType: 'gpu', catalogueId: 'gpu:nvidia:rtx-3080-ti:12gb', inclusion: 'mention' }),
      part({ partType: 'gpu', catalogueId: 'cpu:amd:ryzen-7-5000', inclusion: 'not_included' }),
      part({ partType: 'gpu', extractor: 'photo', source: 'photo' }),
      part({ partType: 'storage_size', attrs: { amount: 1, unit: 'tb' } }),
      part({ partType: 'storage_size', attrs: { amount: 2, unit: 'tb' } }),
      part({ partType: 'storage_type', attrs: { type: 'nvme' } }),
      part({ partType: 'storage_type', attrs: { type: 'hdd' } }),
    ]
    expect(findConflicts(parts, FAMILIES).size).toBe(0)
  })

  it('RAM sizes that differ conflict; a part stating no size is left out of the flag', () => {
    const parts = [
      part({ partType: 'ram_size', attrs: { gb: 16 } }),
      part({ partType: 'ram_size', attrs: { gb: 32 } }),
      part({ partType: 'ram_size', attrs: {} }),
    ]
    expect([...findConflicts(parts, FAMILIES)].sort()).toEqual([0, 1])
  })
})

describe('carryCorrections', () => {
  it('follows the same evidence found by the same extractor, by seq', () => {
    const c = { rejected: true, by: LISTING, reason: 'r', at: '2026-09-25T00:00:00.000Z' }
    const previous = [
      { ...part({ quote: 'RTX 3080', start: 10, end: 18 }), correction: c },
      { ...part({ partType: 'cpu', quote: 'Ryzen', start: 20, end: 25 }), correction: null },
    ]
    const next = [
      part({ seq: 0, partType: 'cpu', quote: 'Ryzen', start: 20, end: 25 }),
      part({ seq: 1, quote: 'RTX 3080', start: 10, end: 18 }),
      part({ seq: 2, quote: 'RTX 3080', start: 10, end: 18, extractor: 'ai' }),
    ]
    expect([...carryCorrections(previous, next)]).toEqual([[1, c]])
  })
})

describe('addsInformation', () => {
  const stored = { ruleVersion: 'r1.00000000', aiVersion: 'p1.00000000', photoVersion: null }
  it('a new rule, AI or photo version adds; the same or a missing input does not', () => {
    expect(addsInformation(stored, null)).toBe(true)
    expect(addsInformation(stored, stored)).toBe(false)
    expect(addsInformation({ ...stored, aiVersion: null }, stored)).toBe(false)
    expect(addsInformation({ ...stored, ruleVersion: 'r2.00000000' }, stored)).toBe(true)
    expect(addsInformation({ ...stored, aiVersion: 'p2.00000000' }, stored)).toBe(true)
    expect(addsInformation({ ...stored, photoVersion: 'v1.00000000' }, stored)).toBe(true)
  })
})

describe('recordedKey', () => {
  const a = {
    listingId: LISTING,
    evidenceHash: HASH,
    ruleVersion: 'r1.00000000',
    aiVersion: null,
    photoVersion: null,
  }
  const b = { ...a, listingId: '01920000-0000-7000-8000-000000000002' }
  it('is the same for the same versions in any order, and new for a new input version', () => {
    expect(recordedKey([a, b], 0)).toBe(recordedKey([b, a], 0))
    expect(recordedKey([a, b], 0)).not.toBe(recordedKey([a, { ...b, aiVersion: 'p1.00000000' }], 0))
    expect(recordedKey([a], 0)).not.toBe(recordedKey([a], 1))
    expect(recordedKey([a], 0)).toMatch(/^parts-record\.recorded:[0-9a-f]{64}:0$/)
  })
})
