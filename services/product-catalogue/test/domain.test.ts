import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  blankNegativeContexts,
  type ProductCatalogueRefused,
  planAddAlias,
  planAddCode,
  planAddItem,
  planAddNegativeContext,
  resolveDictionary,
  sameItem,
} from '../src/domain'

const ADMIN = '00000000-0000-4000-8000-0000000000a1'

const refusalCode = (fn: () => unknown): string | undefined => {
  try {
    fn()
  } catch (error) {
    return (error as ProductCatalogueRefused).code
  }
  return undefined
}

describe('planAddItem', () => {
  const item = (over: Record<string, unknown> = {}) => ({
    actorUserId: ADMIN,
    catalogueId: 'gpu:nvidia:rtx-5080:16gb',
    kind: 'gpu',
    name: 'RTX 5080 16GB',
    ...over,
  })

  it('accepts a well-formed desktop item, defaulting the optional fields', () => {
    expect(planAddItem(item())).toMatchObject({ isMobile: false, family: null, variant: null })
  })

  it('refuses a malformed catalogue ID', () => {
    expect(refusalCode(() => planAddItem(item({ catalogueId: 'not-a-catalogue-id' })))).toBe(
      'product-catalogue.invalid_input',
    )
  })

  it('refuses a mobile CPU: only GPUs have a mobile counterpart in this build', () => {
    expect(refusalCode(() => planAddItem(item({ kind: 'cpu', isMobile: true })))).toBe(
      'product-catalogue.invalid_input',
    )
  })

  it('accepts a mobile GPU', () => {
    expect(planAddItem(item({ isMobile: true, variant: 'mobile' })).isMobile).toBe(true)
  })
})

describe('planAddAlias, planAddNegativeContext, planAddCode', () => {
  it('refuses an empty alias', () => {
    expect(
      refusalCode(() =>
        planAddAlias({
          actorUserId: ADMIN,
          catalogueId: 'gpu:nvidia:rtx-5080:16gb',
          alias: '  ',
          source: 'admin',
        }),
      ),
    ).toBe('product-catalogue.invalid_input')
  })

  it('refuses a negative-context pattern that does not compile', () => {
    expect(
      refusalCode(() =>
        planAddNegativeContext({
          actorUserId: ADMIN,
          pattern: '(unclosed',
          blockedCatalogueId: 'gpu:nvidia:rtx-3090:24gb',
          source: 'admin',
        }),
      ),
    ).toBe('product-catalogue.invalid_input')
  })

  it('accepts a compiling negative-context pattern', () => {
    expect(
      planAddNegativeContext({
        actorUserId: ADMIN,
        pattern: '\\boptiplex\\b',
        blockedCatalogueId: 'gpu:nvidia:rtx-3090:24gb',
        source: 'admin',
      }).pattern,
    ).toBe('\\boptiplex\\b')
  })

  it('refuses an unknown code kind', () => {
    expect(
      refusalCode(() =>
        planAddCode({
          actorUserId: ADMIN,
          catalogueId: 'gpu:nvidia:rtx-5080:16gb',
          kind: 'upc' as never,
          code: '123',
        }),
      ),
    ).toBe('product-catalogue.invalid_input')
  })
})

describe('sameItem', () => {
  const base = {
    kind: 'gpu',
    family: 'RTX 5080',
    variant: '16gb',
    isMobile: false,
    packId: 'gpu-pc',
    name: 'RTX 5080 16GB',
  }

  it('is true when every stored field matches', () => {
    expect(sameItem(base, { ...base })).toBe(true)
  })

  it('is false when any field differs', () => {
    expect(sameItem(base, { ...base, name: 'RTX 5080' })).toBe(false)
  })
})

describe('blankNegativeContexts', () => {
  it('blanks a matched pattern, keeping the length and the rest of the text', () => {
    const text = 'Dell OptiPlex 3090 tower, no GPU'
    const blanked = blankNegativeContexts(text, [
      { pattern: '\\boptiplex\\s*(ultra\\s*)?\\d{4}\\b' },
    ])
    expect(blanked).toHaveLength(text.length)
    expect(blanked).not.toMatch(/optiplex|3090/i)
    expect(blanked.startsWith('Dell ')).toBe(true)
    expect(blanked.endsWith(' tower, no GPU')).toBe(true)
  })
})

describe('resolveDictionary', () => {
  const items = [
    {
      catalogueId: 'gpu:nvidia:rtx-3090:24gb' as const,
      kind: 'gpu' as const,
      family: 'RTX 3090',
      name: 'RTX 3090 24GB',
      variant: '24gb',
      isMobile: false,
    },
    {
      catalogueId: 'gpu:nvidia:rtx-3080:10gb' as const,
      kind: 'gpu' as const,
      family: 'RTX 3080',
      name: 'RTX 3080 10GB',
      variant: '10gb',
      isMobile: false,
    },
    {
      catalogueId: 'gpu:nvidia:rtx-3080:12gb' as const,
      kind: 'gpu' as const,
      family: 'RTX 3080',
      name: 'RTX 3080 12GB',
      variant: '12gb',
      isMobile: false,
    },
    {
      catalogueId: 'gpu:nvidia:rtx-5080:16gb' as const,
      kind: 'gpu' as const,
      family: 'RTX 5080',
      name: 'RTX 5080 16GB',
      variant: '16gb',
      isMobile: false,
    },
    {
      catalogueId: 'gpu:nvidia:rtx-5080:mobile' as const,
      kind: 'gpu' as const,
      family: 'RTX 5080',
      name: 'RTX 5080 (Laptop)',
      variant: 'mobile',
      isMobile: true,
    },
    {
      catalogueId: 'cpu:intel:core-i5-gen10' as const,
      kind: 'cpu' as const,
      family: null,
      name: 'Intel Core i5 10th gen',
      variant: null,
      isMobile: false,
    },
  ]
  const aliases = [
    { catalogueId: 'gpu:nvidia:rtx-3090:24gb' as const, alias: 'rtx 3090', source: 'pack:gpu-pc' },
    { catalogueId: 'gpu:nvidia:rtx-3090:24gb' as const, alias: '3090', source: 'pack:gpu-pc' },
    { catalogueId: 'gpu:nvidia:rtx-3080:10gb' as const, alias: 'rtx 3080', source: 'pack:gpu-pc' },
    { catalogueId: 'gpu:nvidia:rtx-3080:10gb' as const, alias: '3080', source: 'pack:gpu-pc' },
    { catalogueId: 'gpu:nvidia:rtx-3080:12gb' as const, alias: 'rtx 3080', source: 'pack:gpu-pc' },
    { catalogueId: 'gpu:nvidia:rtx-3080:12gb' as const, alias: '3080', source: 'pack:gpu-pc' },
    { catalogueId: 'gpu:nvidia:rtx-5080:16gb' as const, alias: 'rtx 5080', source: 'pack:gpu-pc' },
    { catalogueId: 'gpu:nvidia:rtx-5080:16gb' as const, alias: '5080', source: 'pack:gpu-pc' },
    {
      catalogueId: 'gpu:nvidia:rtx-5080:mobile' as const,
      alias: 'rtx 5080',
      source: 'pack:gpu-pc:mobile',
    },
    {
      catalogueId: 'gpu:nvidia:rtx-5080:mobile' as const,
      alias: '5080',
      source: 'pack:gpu-pc:mobile',
    },
    {
      catalogueId: 'cpu:intel:core-i5-gen10' as const,
      alias: '\\b(?:core\\s*)?i5\\s*-?\\s*10\\d{3}[a-z]{0,3}\\b',
      source: 'pack:gpu-pc:pattern',
    },
  ]
  const negativeContexts = [{ pattern: '\\boptiplex\\s*(ultra\\s*)?\\d{4}\\b' }]

  it('"OptiPlex 3090" never resolves to the RTX 3090', () => {
    const matches = resolveDictionary('Dell OptiPlex 3090 tower', items, aliases, negativeContexts)
    expect(matches.some((m) => m.catalogueId === 'gpu:nvidia:rtx-3090:24gb')).toBe(false)
    expect(matches).toEqual([])
  })

  it('a genuine RTX 3090 mention still resolves once the number is not inside "OptiPlex"', () => {
    const matches = resolveDictionary(
      'MSI RTX 3090 Gaming X Trio',
      items,
      aliases,
      negativeContexts,
    )
    expect(matches[0]?.catalogueId).toBe('gpu:nvidia:rtx-3090:24gb')
  })

  it('desktop and mobile 5080 differ', () => {
    const desktop = resolveDictionary('RTX 5080 16GB, mint condition', items, aliases, [])
    const mobile = resolveDictionary('Gaming laptop with RTX 5080', items, aliases, [])
    expect(desktop[0]?.catalogueId).toBe('gpu:nvidia:rtx-5080:16gb')
    expect(mobile[0]?.catalogueId).toBe('gpu:nvidia:rtx-5080:mobile')
    expect(desktop[0]?.catalogueId).not.toBe(mobile[0]?.catalogueId)
  })

  it('an ambiguous VRAM leaves the catalogue ID null with both variants as candidates', () => {
    const matches = resolveDictionary('RTX 3080 Eagle', items, aliases, [])
    expect(matches[0]).toMatchObject({
      family: 'RTX 3080',
      catalogueId: null,
      candidates: expect.arrayContaining(['gpu:nvidia:rtx-3080:10gb', 'gpu:nvidia:rtx-3080:12gb']),
    })
  })

  it('a stated VRAM resolves the variant', () => {
    const matches = resolveDictionary('rtx3080 10gb', items, aliases, [])
    expect(matches[0]?.catalogueId).toBe('gpu:nvidia:rtx-3080:10gb')
  })

  it('a pattern-sourced CPU alias resolves independently of the laptop indicator', () => {
    const matches = resolveDictionary('i5-10400f laptop for sale', items, aliases, negativeContexts)
    expect(matches.some((m) => m.catalogueId === 'cpu:intel:core-i5-gen10')).toBe(true)
  })
})

describe('part-patterns.json', () => {
  // The pack's own copy (services/product-catalogue seeds from it; packages/packs/README.md).
  const partPatterns = JSON.parse(
    readFileSync(
      new URL('../../../packages/packs/gpu-pc/data/part-patterns.json', import.meta.url),
      'utf8',
    ),
  )

  it('every regex compiles with the i flag', () => {
    const sources = [
      ...Object.values(partPatterns.listingKind as Record<string, string>),
      ...Object.values(partPatterns.fields as Record<string, string>),
      ...(partPatterns.gpuModels as { pattern: string }[]).map((g) => g.pattern),
    ]
    expect(sources.length).toBeGreaterThan(0)
    for (const source of sources) {
      expect(() => new RegExp(source, 'i')).not.toThrow()
    }
  })
})
