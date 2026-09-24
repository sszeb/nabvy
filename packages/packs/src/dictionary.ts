import type { DictionaryEntry, PartPatterns } from '@nabvy/contracts'
import { PACK_REGEX_FLAGS } from '@nabvy/contracts'

// Resolves product mentions in listing text to dictionary product keys. Rules tier only: no
// model call, no guessing. A family with VRAM variants resolves to a key only when the text states
// the VRAM next to the model; otherwise the match carries the candidates and no key.

export type ProductMatch = {
  family: string
  productKey: string | null
  candidates: string[]
  text: string
  index: number
}

type Family = { name: string; entries: DictionaryEntry[]; regexes: RegExp[] }

// part-patterns.json: remove office "OptiPlex 3080/3090" strings before GPU matching. Replaced
// with spaces so match positions still point into the original text.
const OPTIPLEX = /\boptiplex\s*(ultra\s*)?\d{4}\b/gi
const blankOptiplex = (text: string) => text.replace(OPTIPLEX, (found) => ' '.repeat(found.length))

// A match must stand alone: no letter or digit either side, and no currency sign before it, so
// "£1070" is a price and "b580" is not "rx 580".
const BEFORE = /[a-z0-9£$€]/i
const AFTER = /[a-z0-9]/i

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Spaces and hyphens in an alias are optional: "rtx 3080" also matches "rtx3080" and "rtx-3080".
export const aliasSource = (alias: string) =>
  alias
    .trim()
    .toLowerCase()
    .split(/[\s-]+/)
    .map(escapeRegex)
    .join('[\\s-]*')

const VRAM_AFTER = /(?<![a-z0-9])(\d{1,2})\s*(?:gb|gig|g)(?![a-z0-9])/i
const VRAM_BEFORE = /(?<![a-z0-9])(\d{1,2})\s*gb[\s-]*$/i

export type Resolver = (text: string) => ProductMatch[]

export const createResolver = (
  dictionary: readonly DictionaryEntry[],
  gpuModels: PartPatterns['gpuModels'] = [],
): Resolver => {
  const byName = new Map<string, Family>()
  for (const entry of dictionary) {
    const name = entry.family ?? entry.productKey
    const family = byName.get(name) ?? { name, entries: [], regexes: [] }
    family.entries.push(entry)
    byName.set(name, family)
  }
  const flags = `${PACK_REGEX_FLAGS}g`
  for (const family of byName.values()) {
    const sources = new Set<string>()
    for (const entry of family.entries) {
      for (const alias of entry.aliases) sources.add(aliasSource(alias))
      for (const pattern of entry.patterns) sources.add(pattern)
    }
    for (const gpu of gpuModels) if (gpu.model === family.name) sources.add(gpu.pattern)
    family.regexes = [...sources].map((source) => new RegExp(source, flags))
  }
  const families = [...byName.values()]

  const pickVariant = (family: Family, text: string, start: number, end: number) => {
    if (family.entries.length === 1) return family.entries[0]?.productKey ?? null
    const stated =
      VRAM_AFTER.exec(text.slice(end, end + 24))?.[1] ??
      VRAM_BEFORE.exec(text.slice(Math.max(0, start - 10), start))?.[1]
    if (stated === undefined) return null
    return family.entries.find((entry) => entry.vramGb === Number(stated))?.productKey ?? null
  }

  return (input) => {
    const text = blankOptiplex(input)
    const spans: Array<{ family: Family; start: number; end: number }> = []
    for (const family of families) {
      for (const regex of family.regexes) {
        for (const found of text.matchAll(regex)) {
          const start = found.index
          const end = start + found[0].length
          if (end === start) continue
          if (BEFORE.test(text.charAt(start - 1)) || AFTER.test(text.charAt(end))) continue
          spans.push({ family, start, end })
        }
      }
    }
    // Longest match wins where matches overlap: "3080 ti" beats "3080".
    spans.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)
    const kept: typeof spans = []
    for (const span of spans) {
      if (kept.every((other) => span.end <= other.start || span.start >= other.end)) kept.push(span)
    }
    kept.sort((a, b) => a.start - b.start)

    const seen = new Set<string>()
    const matches: ProductMatch[] = []
    for (const { family, start, end } of kept) {
      if (seen.has(family.name)) continue
      seen.add(family.name)
      matches.push({
        family: family.name,
        productKey: pickVariant(family, text, start, end),
        candidates: family.entries.map((entry) => entry.productKey),
        text: input.slice(start, end),
        index: start,
      })
    }
    return matches
  }
}
