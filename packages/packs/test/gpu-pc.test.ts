import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  GpuPcCondition,
  NoiseRuleName,
  PartPatterns,
  RiskFlag,
  sellerDerivedRiskFlags,
} from '@nabvy/contracts/modules/packs'
import { describe, expect, it } from 'vitest'
import source from '../gpu-pc/data/part-patterns.source.json'
import { getPack, gpuPcDefinition, loadPack, PackValidationError } from '../src'

const readRepoFile = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url))
const pack = getPack('gpu-pc')

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

  it('references every risk flag once and keeps seller-derived and photo flags internal', () => {
    expect(pack.risk.map((rule) => rule.flag).sort()).toEqual([...RiskFlag.options].sort())
    const publicFlags = pack.risk.filter((rule) => rule.action !== 'internal').map((r) => r.flag)
    for (const flag of [...sellerDerivedRiskFlags, 'stock_photo']) {
      expect(publicFlags).not.toContain(flag)
    }
  })

  it("keeps the actor's broad wanted and laptop patterns out of destructive rules", () => {
    const destructive = [...pack.definition.gate.excludeTitle]
    for (const rule of pack.definition.risk)
      if (rule.action === 'drop') destructive.push(...rule.patterns)
    expect(destructive).not.toContainEqual({ ref: 'listingKind.wantedTitle' })
    expect(destructive).not.toContainEqual({ ref: 'listingKind.laptopTitle' })
  })

  it("covers the brief's noise filter", () => {
    expect(pack.noise.map((rule) => rule.rule).sort()).toEqual([...NoiseRuleName.options].sort())
  })

  it('keeps the explanation away from users until the owner approves its wording', () => {
    const { template, displayable } = pack.definition.explanation
    expect(displayable).toBe(false)
    expect(template).not.toMatch(/sold for|dealScore|partOutTotal/)
  })

  it('runs every noise rule in shadow until fixtures measure it', () => {
    for (const rule of pack.noise) expect(rule.mode).toBe('shadow')
  })

  it('prices in GBP', () => {
    expect(pack.definition.currency).toBe('GBP')
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
