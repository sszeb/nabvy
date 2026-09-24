import { z } from 'zod'
import { RiskFlag, sellerDerivedRiskFlags } from './enums'

// The category pack format (docs/contracts.md, "Category pack format"). A pack is data: regexes are
// stored as source strings and compiled case-insensitively by the loader in @nabvy/packs.

export const PACK_REGEX_FLAGS = 'i'

const compiles = (source: string) => {
  try {
    new RegExp(source, PACK_REGEX_FLAGS)
    return true
  } catch {
    return false
  }
}

export const PatternSource = z
  .string()
  .min(1)
  .refine(compiles, { message: 'must compile as a JavaScript RegExp with the i flag' })

// A pattern is inline, or a reference into the pack's part patterns, for example
// `listingKind.wantedTitle` or `fields.GPU model`. References are checked when the pack is parsed.
export const PatternRef = z.strictObject({
  ref: z.string().regex(/^(listingKind|fields)\..+$/, 'must start with listingKind. or fields.'),
})
export type PatternRef = z.infer<typeof PatternRef>

export const PatternItem = z.union([PatternSource, PatternRef])
export type PatternItem = z.infer<typeof PatternItem>

const MinorInt = z.number().int().nonnegative()
const Fraction = z.number().min(0).max(1)

// The actor's docs/data/part-patterns.json, kept verbatim. Strict objects, so a change to its
// shape upstream fails validation instead of being silently dropped.
export const ListingKindKey = z.enum([
  'wantedTitle',
  'wantedDescriptionFirst400Chars',
  'laptopTitle',
  'pcTitle',
  'notAPcTitle',
  'cpuOrPcTitle',
])
export type ListingKindKey = z.infer<typeof ListingKindKey>

export const PartPatterns = z.strictObject({
  about: z.string().min(1),
  flags: z.literal(PACK_REGEX_FLAGS),
  listingKind: z.strictObject({
    wantedTitle: PatternSource,
    wantedDescriptionFirst400Chars: PatternSource,
    laptopTitle: PatternSource,
    pcTitle: PatternSource,
    notAPcTitle: PatternSource,
    cpuOrPcTitle: PatternSource,
  }),
  fields: z.record(z.string().min(1), PatternSource),
  gpuModels: z.array(z.strictObject({ model: z.string().min(1), pattern: PatternSource })).min(1),
})
export type PartPatterns = z.infer<typeof PartPatterns>

// Where a data file copied from another repository came from.
export const DataSource = z.strictObject({
  repository: z.string().min(1),
  path: z.string().min(1),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  committedAt: z.iso.datetime({ offset: true }),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  copiedAt: z.iso.date(),
  note: z.string().min(1),
})
export type DataSource = z.infer<typeof DataSource>

export const DetailFetchAll = z.union([
  z.boolean(),
  z.strictObject({ categories: z.array(z.string().min(1)).min(1) }),
])

export const PackGate = z.strictObject({
  includeTitle: z.array(PatternItem).min(1),
  excludeTitle: z.array(PatternItem),
  minPriceMinor: MinorInt,
  maxPriceMinor: MinorInt.optional(),
  detailFetchAll: DetailFetchAll,
})

// The brief's free noise filter: wanted, swap and "I buy" adverts, keyword stuffing, laptops and
// mention-only hits (docs/decisions.md, "Actor data kept in full"). `test` names a rule in the
// noise module; `patterns` are the inputs it reads from the pack.
export const NoiseRuleName = z.enum([
  'wanted_advert',
  'swap_advert',
  'i_buy_advert',
  'keyword_stuffing',
  'laptop',
  'mention_only',
])
export type NoiseRuleName = z.infer<typeof NoiseRuleName>

export const NoiseRule = z.strictObject({
  rule: NoiseRuleName,
  test: z.string().min(1),
  patterns: z.array(PatternItem).default([]),
})

// `test` names a rule in the risk module. `weight` adds to the listing's risk; `drop` removes the
// listing; `internal` is recorded only in the restricted store and never reaches a public table
// or a public score. Seller-derived flags may only be `internal`.
const riskBase = {
  flag: RiskFlag,
  test: z.string().min(1),
  patterns: z.array(PatternItem).default([]),
  params: z.record(z.string().min(1), z.number()).default({}),
}
export const RiskRule = z
  .discriminatedUnion('action', [
    z.strictObject({ ...riskBase, action: z.literal('weight'), weight: Fraction }),
    z.strictObject({ ...riskBase, action: z.literal('drop') }),
    z.strictObject({
      ...riskBase,
      action: z.literal('internal'),
      shadowWeight: Fraction.optional(),
    }),
  ])
  .superRefine((rule, ctx) => {
    if (
      (sellerDerivedRiskFlags as readonly string[]).includes(rule.flag) &&
      rule.action !== 'internal'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['action'],
        message: `${rule.flag} is derived from seller data and may only be internal`,
      })
    }
  })
export type RiskRule = z.infer<typeof RiskRule>

export const DictionaryEntry = z
  .strictObject({
    productKey: z.string().regex(/^[a-z0-9-]+(:[a-z0-9-]+)+$/),
    name: z.string().min(1),
    // Products that differ only by a variant (VRAM) share a family and its aliases.
    family: z.string().min(1).optional(),
    vramGb: z.number().int().positive().optional(),
    aliases: z.array(z.string().trim().min(1)).default([]),
    patterns: z.array(PatternSource).default([]),
    eans: z.array(z.string().regex(/^\d{8,14}$/)).default([]),
    cexBoxIds: z.array(z.string().min(1)).default([]),
  })
  .refine((entry) => entry.aliases.length > 0 || entry.patterns.length > 0, {
    message: 'needs at least one alias or pattern',
  })
export type DictionaryEntry = z.infer<typeof DictionaryEntry>

export const PackValuation = z.strictObject({
  conditionMultipliers: z.record(z.string().min(1), z.number().positive()),
  bundleHaircut: Fraction,
  bundleFixedAllowanceMinor: MinorInt,
  feePct: Fraction,
  feeFixedMinor: MinorInt,
  postageMinor: z.record(z.string().min(1), MinorInt),
  travelPerKmMinor: MinorInt,
  expectedRepairMinor: z.record(z.string().min(1), MinorInt),
})

const wellFormedTemplate = (template: string) =>
  !/[{}]/.test(template.replace(/\{[a-zA-Z]+\}/g, ''))

export const CategoryPack = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    version: z.string().min(1),
    factTemplate: z.custom<z.ZodType>((value) => value instanceof z.ZodType, {
      message: 'must be a Zod schema',
    }),
    gate: PackGate,
    rules: z.strictObject({ partPatterns: PartPatterns, partPatternsSource: DataSource }),
    noise: z.array(NoiseRule),
    dictionary: z.array(DictionaryEntry).min(1),
    valuation: PackValuation,
    risk: z.array(RiskRule),
    explanationTemplate: z
      .string()
      .min(1)
      .refine(wellFormedTemplate, { message: 'placeholders must look like {name}' }),
    embeddingModel: z.string().min(1),
  })
  .superRefine((pack, ctx) => {
    const { partPatterns } = pack.rules
    const checkRefs = (items: PatternItem[], path: (string | number)[]) => {
      items.forEach((item, index) => {
        if (typeof item === 'string') return
        const [group, ...rest] = item.ref.split('.')
        const name = rest.join('.')
        const known =
          group === 'listingKind'
            ? Object.hasOwn(partPatterns.listingKind, name)
            : Object.hasOwn(partPatterns.fields, name)
        if (!known) {
          ctx.addIssue({
            code: 'custom',
            path: [...path, index, 'ref'],
            message: `unknown part-pattern reference ${item.ref}`,
          })
        }
      })
    }
    checkRefs(pack.gate.includeTitle, ['gate', 'includeTitle'])
    checkRefs(pack.gate.excludeTitle, ['gate', 'excludeTitle'])
    pack.noise.forEach((rule, i) => {
      checkRefs(rule.patterns, ['noise', i, 'patterns'])
    })
    pack.risk.forEach((rule, i) => {
      checkRefs(rule.patterns, ['risk', i, 'patterns'])
    })

    const duplicates = (values: string[]) => values.filter((v, i) => values.indexOf(v) !== i)
    for (const key of duplicates(pack.dictionary.map((entry) => entry.productKey))) {
      ctx.addIssue({ code: 'custom', path: ['dictionary'], message: `duplicate productKey ${key}` })
    }
    for (const flag of duplicates(pack.risk.map((rule) => rule.flag))) {
      ctx.addIssue({ code: 'custom', path: ['risk'], message: `duplicate risk flag ${flag}` })
    }
    for (const rule of duplicates(pack.noise.map((rule) => rule.rule))) {
      ctx.addIssue({ code: 'custom', path: ['noise'], message: `duplicate noise rule ${rule}` })
    }

    const families = new Set(pack.dictionary.map((entry) => entry.family ?? entry.productKey))
    partPatterns.gpuModels.forEach((gpu, i) => {
      if (!families.has(gpu.model)) {
        ctx.addIssue({
          code: 'custom',
          path: ['rules', 'partPatterns', 'gpuModels', i, 'model'],
          message: `${gpu.model} has no dictionary family`,
        })
      }
    })

    const { minPriceMinor, maxPriceMinor } = pack.gate
    if (maxPriceMinor !== undefined && maxPriceMinor < minPriceMinor) {
      ctx.addIssue({
        code: 'custom',
        path: ['gate', 'maxPriceMinor'],
        message: 'must be at least minPriceMinor',
      })
    }
  })
export type CategoryPackInput = z.input<typeof CategoryPack>
export type CategoryPack = z.infer<typeof CategoryPack>
