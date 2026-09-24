// Pure logic: no I/O, no database. `resolve()` in ../index wires this to the repository.
import { PRODUCT_CATALOGUE_MOBILE_INDICATOR_PATTERN } from '@nabvy/config/modules/product-catalogue'
import type { DictionaryEntry } from '@nabvy/contracts/modules/packs'
import {
  isPatternSource,
  type ProductCatalogueId,
  type ProductCatalogueKind,
  type ProductCatalogueMatch,
} from '@nabvy/contracts/modules/product-catalogue'
import { createResolver } from '@nabvy/packs'

export interface CatalogueItemRow {
  catalogueId: ProductCatalogueId
  kind: ProductCatalogueKind
  family: string | null
  name: string
  variant: string | null
  isMobile: boolean
}

export interface CatalogueAliasRow {
  catalogueId: ProductCatalogueId
  alias: string
  source: string
}

export interface NegativeContextRow {
  pattern: string
}

// Reused across calls: recompiled from the current item and alias rows on every resolve() (no
// caching yet; services/product-catalogue/README.md, "Decisions" notes this as a starting point).
const MOBILE_INDICATOR = new RegExp(PRODUCT_CATALOGUE_MOBILE_INDICATOR_PATTERN, 'i')

const VRAM_VARIANT = /^(\d+)gb$/

function parseVramGb(variant: string | null): number | undefined {
  const match = variant ? VRAM_VARIANT.exec(variant) : null
  return match ? Number(match[1]) : undefined
}

/** Converts this module's own rows to the shape `@nabvy/packs`' `createResolver` expects. */
function toDictionaryEntries(
  items: CatalogueItemRow[],
  aliases: CatalogueAliasRow[],
): DictionaryEntry[] {
  const literalAliases = new Map<string, string[]>()
  const patterns = new Map<string, string[]>()
  for (const row of aliases) {
    const bucket = isPatternSource(row.source) ? patterns : literalAliases
    const list = bucket.get(row.catalogueId) ?? []
    list.push(row.alias)
    bucket.set(row.catalogueId, list)
  }
  return items.map((item) => ({
    productKey: item.catalogueId,
    name: item.name,
    family: item.family ?? item.catalogueId,
    vramGb: parseVramGb(item.variant),
    aliases: literalAliases.get(item.catalogueId) ?? [],
    patterns: patterns.get(item.catalogueId) ?? [],
    eans: [],
    cexBoxIds: [],
  }))
}

/**
 * Blanks every negative-context pattern in `text` (replaced with spaces of the same length, so
 * match positions of whatever is left still point into the original text), so e.g. a Dell
 * "OptiPlex 3090" never resolves as an RTX 3090 (docs/design/modules/product-catalogue.md).
 * Applied globally: a pattern is only ever written because it collides with a catalogue mention
 * it must never produce, never because it might remove a legitimate one (README.md, "Decisions").
 */
export function blankNegativeContexts(
  text: string,
  negativeContexts: NegativeContextRow[],
): string {
  return negativeContexts.reduce((blanked, { pattern }) => {
    const regex = new RegExp(pattern, 'gi')
    return blanked.replace(regex, (found) => ' '.repeat(found.length))
  }, text)
}

/**
 * The dictionary tier of `resolve(text)` (docs/design/modules/product-catalogue.md): aliases and
 * patterns only, no model call, no guessing. Desktop and mobile GPUs are resolved independently
 * (a mobile chip is a different part from its desktop namesake), chosen by whether `text` carries
 * a laptop indicator; everything else (today: CPUs) is resolved regardless of that indicator.
 */
export function resolveDictionary(
  text: string,
  items: CatalogueItemRow[],
  aliases: CatalogueAliasRow[],
  negativeContexts: NegativeContextRow[],
): ProductCatalogueMatch[] {
  const blanked = blankNegativeContexts(text, negativeContexts)
  const isLaptop = MOBILE_INDICATOR.test(blanked)

  const desktopGpu = items.filter((item) => item.kind === 'gpu' && !item.isMobile)
  const mobileGpu = items.filter((item) => item.kind === 'gpu' && item.isMobile)
  const other = items.filter((item) => item.kind !== 'gpu')

  const gpuResolver = createResolver(
    toDictionaryEntries(isLaptop ? mobileGpu : desktopGpu, aliases),
  )
  const otherResolver = createResolver(toDictionaryEntries(other, aliases))

  return [...gpuResolver(blanked), ...otherResolver(blanked)]
    .map(
      (match): ProductCatalogueMatch => ({
        family: match.family,
        catalogueId: match.productKey as ProductCatalogueId | null,
        candidates: match.candidates as ProductCatalogueId[],
        text: match.text,
        index: match.index,
      }),
    )
    .sort((a, b) => a.index - b.index)
}
