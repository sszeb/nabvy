import {
  CategoryPack,
  PACK_REGEX_FLAGS,
  type PartPatterns,
  type PatternItem,
} from '@nabvy/contracts/modules/packs'
import type { z } from 'zod'
import { createResolver, type Resolver } from './dictionary'

export class PackValidationError extends Error {
  constructor(
    readonly packId: string,
    readonly issues: z.core.$ZodIssue[],
  ) {
    const lines = issues.map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    super(`pack ${packId} is invalid:\n${lines.join('\n')}`)
    this.name = 'PackValidationError'
  }
}

// Distributes over unions so a compiled risk rule keeps its `action`-specific fields.
export type CompiledRule<T> = T extends unknown
  ? Omit<T, 'patterns'> & { patterns: RegExp[] }
  : never

export type LoadedPack = {
  definition: CategoryPack
  gate: Omit<CategoryPack['gate'], 'includeTitle' | 'excludeTitle'> & {
    includeTitle: RegExp[]
    excludeTitle: RegExp[]
    passesTitle: (title: string) => boolean
  }
  noise: CompiledRule<CategoryPack['noise'][number]>[]
  risk: CompiledRule<CategoryPack['risk'][number]>[]
  resolve: Resolver
}

const resolveSource = (item: PatternItem, partPatterns: PartPatterns): string => {
  if (typeof item === 'string') return item
  const [group, ...rest] = item.ref.split('.')
  const name = rest.join('.')
  const source =
    group === 'listingKind'
      ? partPatterns.listingKind[name as keyof PartPatterns['listingKind']]
      : partPatterns.fields[name]
  // The schema has already checked every reference.
  if (source === undefined) throw new Error(`unknown part-pattern reference ${item.ref}`)
  return source
}

// Validates a pack definition against the CategoryPack format and compiles its patterns.
export const loadPack = (input: unknown): LoadedPack => {
  const parsed = CategoryPack.safeParse(input)
  if (!parsed.success) {
    const id =
      typeof input === 'object' && input !== null && 'id' in input ? String(input.id) : '(no id)'
    throw new PackValidationError(id, parsed.error.issues)
  }
  const definition = parsed.data
  const { partPatterns } = definition.rules
  const compile = (items: PatternItem[]) =>
    items.map((item) => new RegExp(resolveSource(item, partPatterns), PACK_REGEX_FLAGS))

  const includeTitle = compile(definition.gate.includeTitle)
  const excludeTitle = compile(definition.gate.excludeTitle)
  return {
    definition,
    gate: {
      ...definition.gate,
      includeTitle,
      excludeTitle,
      passesTitle: (title) =>
        includeTitle.some((regex) => regex.test(title)) &&
        !excludeTitle.some((regex) => regex.test(title)),
    },
    noise: definition.noise.map((rule) => ({ ...rule, patterns: compile(rule.patterns) })),
    risk: definition.risk.map((rule) => ({ ...rule, patterns: compile(rule.patterns) })),
    resolve: createResolver(definition.dictionary, partPatterns.gpuModels),
  }
}
