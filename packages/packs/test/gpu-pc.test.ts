import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  GpuPcCondition,
  NoiseRuleName,
  PartPatterns,
  RiskFlag,
  sellerDerivedRiskFlags,
} from '@nabvy/contracts'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import source from '../gpu-pc/data/part-patterns.source.json'
import { getPack, gpuPcDefinition, loadPack, PackValidationError } from '../src'

const readRepoFile = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url))
const pack = getPack('gpu-pc')

const AliasFixtures = z.strictObject({
  about: z.string(),
  cases: z
    .array(
      z.strictObject({
        text: z.string().min(1),
        family: z.string().nullable(),
        productKey: z.string().nullable(),
      }),
    )
    .min(1),
})
const aliases = AliasFixtures.parse(
  JSON.parse(readRepoFile('fixtures/packs/gpu-pc/aliases.json').toString('utf8')),
)

type Draft = {
  factTemplate: unknown
  gate: { includeTitle: unknown[]; excludeTitle: unknown[] }
  risk: Array<{ flag: string }>
  dictionary: Array<{ family?: string }>
}
// A deep copy of the gpu-pc definition to break; the Zod fact template cannot be cloned.
const withChanges = (change: (definition: Draft) => void) => {
  const { factTemplate, ...data } = gpuPcDefinition as Draft
  const copy: Draft = { ...structuredClone(data), factTemplate }
  change(copy)
  return copy
}
const issuesOf = (input: unknown) => {
  try {
    loadPack(input)
  } catch (error) {
    if (error instanceof PackValidationError) return error.message
    throw error
  }
  throw new Error('expected loadPack to throw')
}

describe('gpu-pc pack', () => {
  it('validates against the CategoryPack format', () => {
    expect(pack.definition.id).toBe('gpu-pc')
    expect(pack.definition.version).toBe('1')
    expect(pack.definition.dictionary.length).toBeGreaterThan(100)
  })

  it('prices every condition in the fact template', () => {
    expect(Object.keys(pack.definition.valuation.conditionMultipliers).sort()).toEqual(
      [...GpuPcCondition.options].sort(),
    )
  })

  it('references every risk flag once and keeps seller-derived flags internal', () => {
    expect(pack.risk.map((rule) => rule.flag).sort()).toEqual([...RiskFlag.options].sort())
    const publicFlags = pack.risk.filter((rule) => rule.action !== 'internal').map((r) => r.flag)
    for (const flag of sellerDerivedRiskFlags) expect(publicFlags).not.toContain(flag)
  })

  it("covers the brief's noise filter", () => {
    expect(pack.noise.map((rule) => rule.rule).sort()).toEqual([...NoiseRuleName.options].sort())
  })

  it('fills the explanation template only from named placeholders', () => {
    const names = [...pack.definition.explanationTemplate.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
    expect(names).toContain('ask')
    expect(names).not.toContain('partOutTotal')
  })
})

describe('part-patterns.json', () => {
  const bytes = readRepoFile('packages/packs/gpu-pc/data/part-patterns.json')

  it('is the unedited copy named in its source note', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.sha256)
    expect(source.path).toBe('docs/data/part-patterns.json')
  })

  it('loads and validates', () => {
    const parsed = PartPatterns.parse(JSON.parse(bytes.toString('utf8')))
    expect(parsed.gpuModels.length).toBeGreaterThan(0)
    expect(pack.definition.rules.partPatterns).toEqual(parsed)
  })

  it('maps every GPU model onto a dictionary family', () => {
    for (const { model } of pack.definition.rules.partPatterns.gpuModels) {
      expect(pack.definition.dictionary.some((entry) => entry.family === model)).toBe(true)
    }
  })
})

describe('dictionary', () => {
  it.each(aliases.cases)('resolves "$text"', ({ text, family, productKey }) => {
    const [first] = pack.resolve(text)
    expect(first?.family ?? null).toBe(family)
    expect(first?.productKey ?? null).toBe(productKey)
  })

  it('lists the variants when the VRAM is not stated', () => {
    const [match] = pack.resolve('RTX 3060 Gaming X')
    expect(match?.productKey).toBeNull()
    expect(match?.candidates).toEqual(['gpu:nvidia:rtx-3060:8gb', 'gpu:nvidia:rtx-3060:12gb'])
  })

  it('finds each product once, in text order', () => {
    const found = pack.resolve('Ryzen 7 5800X3D, RTX 3080 Ti, spare 3080 ti cooler')
    expect(found.map((m) => m.family)).toEqual(['cpu:amd:ryzen-7-5000', 'RTX 3080 Ti'])
  })
})

describe('title gate', () => {
  it.each([
    ['Gaming PC RTX 3070 with monitor, keyboard and mouse', true],
    ['RTX 4070 Super', true],
    ['3080 ti founders', true],
    ['Arc B580', true],
    ['Dell OptiPlex 7070 i7', true],
    ['WTB RTX 3080', false],
    ['Looking for a gaming PC', false],
    ['Swap my 3080 for a 6800xt', false],
    ['I buy gaming PCs, cash paid', false],
    ['Asus ROG Zephyrus G14 RTX 4060', false],
    ['RTX 3080 box only', false],
    ['Office chair', false],
  ])('%s → %s', (title, expected) => {
    expect(pack.gate.passesTitle(title)).toBe(expected)
  })
})

describe('risk patterns', () => {
  const test = (flag: string, text: string) =>
    pack.risk.find((rule) => rule.flag === flag)?.patterns.some((regex) => regex.test(text))

  it('does not read a gaming rig as mining', () => {
    expect(test('mining', 'Gaming rig, RTX 3080')).toBe(false)
    expect(test('mining', 'ex mining rig card')).toBe(true)
  })

  it('flags deposits, parts-only, untested and empty boxes', () => {
    expect(test('deposit_request', 'Need a deposit to hold it')).toBe(true)
    expect(test('parts_only', 'Spares or repairs')).toBe(true)
    expect(test('untested', 'Sold as seen')).toBe(true)
    expect(test('empty_box', 'Empty box for 4090')).toBe(true)
  })
})

describe('loadPack', () => {
  it('rejects a public seller-derived flag', () => {
    const input = withChanges((definition) => {
      definition.risk = definition.risk.map((rule) =>
        rule.flag === 'new_seller'
          ? { flag: 'new_seller', test: 'new_seller', action: 'weight', weight: 0.15 }
          : rule,
      )
    })
    expect(issuesOf(input)).toContain('new_seller is derived from seller data')
  })

  it('rejects an unknown part-pattern reference', () => {
    const input = withChanges((definition) => {
      definition.gate.excludeTitle.push({ ref: 'listingKind.missing' })
    })
    expect(issuesOf(input)).toContain('unknown part-pattern reference listingKind.missing')
  })

  it('rejects a regex that does not compile', () => {
    const input = withChanges((definition) => {
      definition.gate.includeTitle.push('(unclosed')
    })
    expect(issuesOf(input)).toContain('must compile as a JavaScript RegExp')
  })

  it('rejects duplicate product keys', () => {
    const input = withChanges((definition) => {
      definition.dictionary.push({ ...definition.dictionary[0] })
    })
    expect(issuesOf(input)).toContain('duplicate productKey')
  })

  it('rejects a GPU model with no dictionary family', () => {
    const input = withChanges((definition) => {
      definition.dictionary = definition.dictionary.filter((entry) => entry.family !== 'RTX 5090')
    })
    expect(issuesOf(input)).toContain('RTX 5090 has no dictionary family')
  })

  it('rejects a fact template that is not a Zod schema', () => {
    const input = withChanges((definition) => {
      definition.factTemplate = { itemType: 'gpu' }
    })
    expect(issuesOf(input)).toContain('factTemplate: must be a Zod schema')
  })
})

describe('compiled risk rules', () => {
  it('keep their weights', () => {
    const deposit = pack.risk.find((rule) => rule.flag === 'deposit_request')
    expect(deposit?.action === 'weight' && deposit.weight).toBe(0.3)
  })
})
