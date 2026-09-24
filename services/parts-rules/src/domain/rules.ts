// The rule pass over one listing version (pure): working copies of the texts, negative contexts
// and tag blocks blanked, the `part-patterns.json` field patterns applied to structured
// attributes first, then the title, then each description line, each hit quoted verbatim with its
// position and an inclusion candidate, and the listing-kind signals. Catalogue resolution and the
// gaps come after (index.ts, gaps.ts). No model, no price, no guess.

import type { DetailEvidenceAttribute } from '@nabvy/contracts/modules/detail-evidence'
import type { PartPatterns } from '@nabvy/contracts/modules/packs'
import type {
  PartsRulesAttrs,
  PartsRulesInclusion,
  PartsRulesKind,
  PartsRulesKindGap,
  PartsRulesPartType,
  PartsRulesSignal,
  PartsRulesSource,
} from '@nabvy/contracts/modules/parts-rules'
import { blank, lines, located, type Working, workingCopy } from './text'

/** Bumped when this file's rules change; the patterns' checksum is added to it (`ruleVersion`). */
export const RULES_REVISION = 1

export function ruleVersion(patternsSha256: string): string {
  return `r${RULES_REVISION}.${patternsSha256.slice(0, 8)}`
}

/** `part-patterns.json` field name → part type (fb-scrap-engine/docs/data/part-patterns.json:12-21). */
export const FIELD_PART_TYPES: Record<string, PartsRulesPartType> = {
  'GPU model': 'gpu',
  'CPU model': 'cpu',
  'RAM size': 'ram_size',
  'RAM generation': 'ram_generation',
  'Storage size': 'storage_size',
  'Storage type': 'storage_type',
  'PSU wattage': 'psu_wattage',
  'Motherboard chipset': 'chipset',
}

/**
 * Office "OptiPlex 3080/3090" model numbers, blanked before matching even when the catalogue's
 * negative contexts are unavailable (its switch off): the same pattern the catalogue seeds from
 * the gpu-pc pack (fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:244;
 * fb-scrap-engine/docs/data/part-patterns.json:2, the `optiplex` lookbehinds of lines 82-95).
 */
export const OPTIPLEX = String.raw`\boptiplex\s*(ultra\s*)?\d{4}\b`

export interface CompiledRules {
  fields: { partType: PartsRulesPartType; ruleId: string; regex: RegExp }[]
  gpuModels: { model: string; regex: RegExp }[]
  kind: {
    wantedTitle: RegExp
    wantedDescription: RegExp
    laptopTitle: RegExp
    pcTitle: RegExp
    notAPcTitle: RegExp
    cpuOrPcTitle: RegExp
  }
}

export function compileRules(patterns: PartPatterns): CompiledRules {
  const g = (source: string) => new RegExp(source, 'gi')
  const fields = Object.entries(patterns.fields).flatMap(([name, source]) => {
    const partType = FIELD_PART_TYPES[name]
    return partType ? [{ partType, ruleId: `field.${partType}`, regex: g(source) }] : []
  })
  const k = patterns.listingKind
  return {
    fields,
    gpuModels: patterns.gpuModels.map((m) => ({
      model: m.model,
      regex: new RegExp(m.pattern, 'i'),
    })),
    kind: {
      wantedTitle: g(k.wantedTitle),
      wantedDescription: g(k.wantedDescriptionFirst400Chars),
      laptopTitle: g(k.laptopTitle),
      pcTitle: g(k.pcTitle),
      notAPcTitle: g(k.notAPcTitle),
      cpuOrPcTitle: g(k.cpuOrPcTitle),
    },
  }
}

export interface RuleSettings {
  contextChars: number
  wantedDescriptionChars: number
  tagBlockMinHashtags: number
  tagBlockMinModels: number
}

export interface ListingText {
  title: string
  description: string | null
  attributes: DetailEvidenceAttribute[]
  detailSections: DetailEvidenceAttribute[]
}

export interface Hit {
  partType: PartsRulesPartType
  source: PartsRulesSource
  /** Offsets into the stored text and its verbatim quote. */
  start: number
  end: number
  quote: string
  /** The quote as the rules read it (working copy). */
  reading: string
  /**
   * The reading and up to 24 more characters of its line, passed to the catalogue so a stated
   * variant ("RTX 3080 10GB") is read; only a match starting inside the reading is kept.
   */
  resolveText: string
  ruleId: string
  attrs: PartsRulesAttrs
  inclusion: PartsRulesInclusion
  catalogueId: string | null
}

export interface Signal {
  signal: PartsRulesSignal
  source: PartsRulesSource
  quote: string
  start: number
  end: number
  ruleId: string
}

export interface TagBlock {
  source: PartsRulesSource
  start: number
  end: number
  ruleId: string
}

export interface Analysis {
  hits: Hit[]
  signals: Signal[]
  tagBlocks: TagBlock[]
  kind: PartsRulesKind | null
  kindGap: PartsRulesKindGap | null
}

// Spec-line labels ("GPU: ...", "Ram- ddr4 16gb"): a hit in a line labelled for another part is
// dropped, so "Graphics Card: GTX 970 4GB" gives no RAM and "Case: Corsair 4500X" no CPU. Longer
// labels first. `[]` means the line names something that is not one of these parts.
const LABEL_GROUPS: [string, PartsRulesPartType[]][] = [
  ['cpu cooler', []],
  ['cpu fan', []],
  ['graphics card', ['gpu']],
  ['video card', ['gpu']],
  ['power supply', ['psu_wattage']],
  ['hard drive', ['storage_size', 'storage_type']],
  ['operating system', []],
  ['optical drive', []],
  ['processor type', ['cpu']],
  ['processor', ['cpu']],
  ['graphics', ['gpu']],
  ['gpu', ['gpu']],
  ['cpu', ['cpu']],
  ['memory', ['ram_size', 'ram_generation']],
  ['ram', ['ram_size', 'ram_generation']],
  ['storage', ['storage_size', 'storage_type']],
  ['ssd', ['storage_size', 'storage_type']],
  ['hdd', ['storage_size', 'storage_type']],
  ['nvme', ['storage_size', 'storage_type']],
  ['m.2', ['storage_size', 'storage_type']],
  ['psu', ['psu_wattage']],
  ['power', ['psu_wattage']],
  ['motherboard', ['chipset']],
  ['mobo', ['chipset']],
  ['board', ['chipset']],
  ['case', []],
  ['cooler', []],
  ['cooling', []],
  ['fans', []],
  ['fan', []],
  ['monitor', []],
  ['keyboard', []],
  ['mouse', []],
  ['os', []],
  ['peripherals', []],
  ['networking', []],
  ['wi-fi', []],
  ['wifi', []],
  ['colour', []],
  ['color', []],
  ['brand', []],
  ['condition', []],
  ['price', []],
]
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const LABEL_WORDS = LABEL_GROUPS.map(([label]) => escapeRegExp(label)).join('|')
const LINE_LABEL = new RegExp(
  `^[^\\p{L}\\p{N}]*(${LABEL_WORDS})(?![\\p{L}\\p{N}])[^\\p{L}\\p{N}\\n:=–-]{0,3}[:=–-]`,
  'iu',
)
const NAME_LABEL = new RegExp(`(?<![\\p{L}\\p{N}])(${LABEL_WORDS})(?![\\p{L}\\p{N}])`, 'iu')
const groupOf = (label: string) =>
  LABEL_GROUPS.find(([l]) => l === label.toLowerCase())?.[1] ?? null

/** The part types a spec line's label allows; null for an unlabelled line (all allowed). */
export function lineLabel(line: string): PartsRulesPartType[] | null {
  const m = LINE_LABEL.exec(line)
  return m?.[1] ? groupOf(m[1]) : null
}

/** The part types an attribute's name allows; null for an unknown name (all allowed). */
export function attributeLabel(name: string): PartsRulesPartType[] | null {
  const m = NAME_LABEL.exec(name)
  return m?.[1] ? groupOf(m[1]) : null
}

// Inclusion candidates (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:556-559: "upgraded to a 5080",
// "waiting for my 5080", swap or "I buy" adverts, and "equivalent to RTX 5080" are mentions;
// CONTAINER_LISTINGS.md:177-180: "RTX 4090 not included" is demoted). Anchored at the quote,
// with at most two words between, so a mention elsewhere in the window does not demote an offer.
const BEFORE_MENTION =
  /\b(upgrad(?:ed|ing) (?:to|from)|waiting (?:for|on)|equivalent (?:to|of)|similar to|comparable to|on par with|swap(?:s|ped|ping)? (?:for|to|with)|trade (?:for|with)|px (?:for|with)|i buy|we buy|i'?m buying|we'?re buying|looking for|in need of|replaced (?:with|by)|used to (?:have|run))\s+(?:[\w'.-]+\s+){0,2}$/iu
const BEFORE_NOT_INCLUDED =
  /\b(without|minus|excluding|excludes|not including|doesn'?t (?:come with|include))\s+(?:an?\s+|the\s+|my\s+)?(?:[\w'.-]+\s+){0,1}$/iu
const AFTER_NOT_INCLUDED =
  /^\s*(?:[\w'.-]+\s+){0,3}?[(\-–,]?\s*(not included|isn'?t included|not inc|sold separately|box only|empty box|not for sale)\b/iu
const AFTER_MENTION = /^\s*[-\s]?(equivalent|level|class)\b/iu

export function inclusionOf(before: string, after: string): PartsRulesInclusion {
  if (BEFORE_NOT_INCLUDED.test(before) || AFTER_NOT_INCLUDED.test(after)) return 'not_included'
  if (BEFORE_MENTION.test(before) || AFTER_MENTION.test(after)) return 'mention'
  return 'offered'
}

const BOX_ONLY =
  /\b(box only|empty box|just the box|only the box|box and (?:manuals?|paperwork) only)\b/giu
const EXPLICIT_LAPTOP = /laptop|notebook|macbook|chromebook|sodimm|so-dimm/i

/** A GPU's comparison key: model number plus suffix ("3090ti", "2070super"), else the text. */
export function gpuKey(reading: string): string {
  const m = /(\d{3,4})\s*-?\s*(ti|super|xtx|xt|gre|s)?\b/i.exec(reading)
  if (!m) return reading.toLowerCase().replace(/\s+/g, ' ').trim()
  const suffix = (m[2] ?? '').toLowerCase()
  return `${m[1]}${suffix === 's' ? 'super' : suffix}`
}

/** A CPU's comparison key: its model number with suffix ("2700x", "12900kf", "9800x3d"). */
export function cpuKey(reading: string): string {
  const all = [...reading.matchAll(/\d{3,5}[a-z0-9]*/gi)]
  const last = all.at(-1)?.[0]
  return (last ?? reading).toLowerCase()
}

/** What the quote itself states, parsed from the working quote only. */
export function attrsOf(
  partType: PartsRulesPartType,
  reading: string,
  rules: CompiledRules,
): PartsRulesAttrs {
  switch (partType) {
    case 'gpu': {
      const model = rules.gpuModels.find((m) => m.regex.test(reading))?.model
      return model ? { model } : {}
    }
    case 'ram_size': {
      const out: PartsRulesAttrs = {}
      const mod = /(\d+)\s*x\s*(\d+)\s*gb/i.exec(reading)
      if (mod) {
        out.modules = Number(mod[1])
        out.moduleGb = Number(mod[2])
      }
      const total = /(\d+)\s*(?:gb|gigs?|g)\b/i.exec(reading)
      const insideModules =
        mod && total && total.index >= mod.index && total.index < mod.index + mod[0].length
      if (total && !insideModules) out.gb = Number(total[1])
      return out
    }
    case 'ram_generation': {
      const m = /ddr\s*-?\s*(\d)|pc(\d)-/i.exec(reading)
      return m ? { ddr: Number(m[1] ?? m[2]) } : {}
    }
    case 'storage_size': {
      const m = /(\d+(?:\.\d+)?)\s*(tb|gb)/i.exec(reading)
      return m ? { amount: Number(m[1]), unit: (m[2] as string).toLowerCase() as 'gb' | 'tb' } : {}
    }
    case 'storage_type': {
      if (/nvme/i.test(reading)) return { type: 'nvme' }
      if (/\bm\.?2\b/i.test(reading)) return { type: 'm2' }
      if (/\bssd\b/i.test(reading)) return { type: 'ssd' }
      if (/\bhdd\b|hard (?:disk|drive)/i.test(reading)) return { type: 'hdd' }
      if (/\bsata\b/i.test(reading)) return { type: 'sata' }
      return {}
    }
    case 'psu_wattage': {
      const m = /(\d{3,4})/.exec(reading)
      return m ? { watts: Number(m[1]) } : {}
    }
    case 'chipset':
      return { chipset: reading.trim().toUpperCase() }
    default:
      return {}
  }
}

interface Span {
  start: number
  end: number
  ruleId: string
}

/** Tag blocks in a working copy: hashtag runs, labelled keyword blocks and model-number lists. */
export function tagBlocksIn(w: Working, rules: CompiledRules, settings: RuleSettings): Span[] {
  const spans: Span[] = []
  const hashtags = new RegExp(
    `(?:#[\\p{L}\\p{N}_]+(?:[\\s,]+|$)){${settings.tagBlockMinHashtags},}`,
    'gu',
  )
  for (const m of w.text.matchAll(hashtags)) {
    spans.push({ start: m.index, end: m.index + m[0].trimEnd().length, ruleId: 'tag.hashtags' })
  }
  const label =
    /(?:^|\n)[^\S\n]*[^\p{L}\p{N}\n]*(?:ignore\s+)?(?:tags?|keywords?|search\s+(?:terms|tags|words))(?:\s+ignore)?\s*[:\-–]/giu
  for (const m of w.text.matchAll(label)) {
    const start = m.index + (m[0].startsWith('\n') ? 1 : 0)
    const next = w.text.indexOf('\n\n', start)
    spans.push({ start, end: next === -1 ? w.text.length : next, ruleId: 'tag.label' })
  }
  const gpu = rules.fields.find((f) => f.partType === 'gpu')?.regex
  if (gpu) {
    for (const line of lines(w)) {
      const keys = new Set([...line.text.matchAll(gpu)].map((m) => gpuKey(m[0])))
      if (keys.size >= settings.tagBlockMinModels && line.text.trim()) {
        const lead = line.text.length - line.text.trimStart().length
        spans.push({
          start: line.offset + lead,
          end: line.offset + line.text.trimEnd().length,
          ruleId: 'tag.model-list',
        })
      }
    }
  }
  return spans.filter((s) => s.end > s.start)
}

function blankNegatives(w: Working, negativeContexts: string[]): void {
  for (const pattern of [OPTIPLEX, ...negativeContexts]) {
    let regex: RegExp
    try {
      regex = new RegExp(pattern, 'gi')
    } catch {
      continue
    }
    for (const m of w.text.matchAll(regex)) {
      if (m[0].length > 0) blank(w, m.index, m.index + m[0].length)
    }
  }
}

/** Every field hit in one working copy, line by line, with the line-label filter. */
function fieldHits(
  w: Working,
  source: PartsRulesSource,
  rules: CompiledRules,
  settings: RuleSettings,
  allowed: PartsRulesPartType[] | null,
  attributeName?: string,
): Hit[] {
  const hits: Hit[] = []
  for (const line of lines(w)) {
    if (!line.text.trim()) continue
    const lineAllowed = source === 'description' ? lineLabel(line.text) : null
    for (const field of rules.fields) {
      if (allowed && !allowed.includes(field.partType)) continue
      if (lineAllowed && !lineAllowed.includes(field.partType)) continue
      for (const m of line.text.matchAll(field.regex)) {
        const text = m[0].trimEnd()
        if (!text.trim()) continue
        const ws = line.offset + m.index
        const we = ws + text.length
        const reading = w.text.slice(ws, we)
        if (field.partType === 'ram_size' && /gddr/i.test(reading)) continue
        const at = located(w, ws, we)
        const before = line.text.slice(Math.max(0, m.index - settings.contextChars), m.index)
        const after = line.text.slice(
          m.index + text.length,
          m.index + text.length + settings.contextChars,
        )
        const resolveText = line.text.slice(m.index, m.index + text.length + 24)
        const attrs = attrsOf(field.partType, reading, rules)
        if (attributeName) attrs.attributeName = attributeName
        hits.push({
          partType: field.partType,
          source,
          ...at,
          reading,
          resolveText,
          ruleId: field.ruleId,
          attrs,
          inclusion: source === 'attribute' ? 'offered' : inclusionOf(before, after),
          catalogueId: null,
        })
      }
    }
  }
  return hits
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end && b.start < a.end

/**
 * Drops hits another rule reads better: storage sizes inside RAM hits; bare GPU words ("Founders
 * Edition") beside a GPU model; and a "RAM ... 12gb" reading whose size runs straight into a GPU
 * model ("ram Msi gaming trio 12gb 5070", recorded row 1397200465308431), which is the card's
 * memory.
 */
function prune(hits: Hit[]): Hit[] {
  return hits.filter((hit) => {
    const same = hits.filter((h) => h !== hit && h.source === hit.source)
    if (
      hit.partType === 'ram_size' &&
      /^(ram|memory)\b/i.test(hit.reading) &&
      same.some((h) => h.partType === 'gpu' && h.start >= hit.end && h.start - hit.end <= 3)
    )
      return false
    if (
      hit.partType === 'storage_size' &&
      same.some((h) => h.partType === 'ram_size' && overlaps(h, hit))
    )
      return false
    if (
      hit.partType === 'gpu' &&
      !/\d/.test(hit.reading) &&
      same.some((h) => h.partType === 'gpu' && /\d/.test(h.reading))
    )
      return false
    return true
  })
}

function kindSignals(
  title: Working,
  description: Working | null,
  rules: CompiledRules,
  settings: RuleSettings,
): Signal[] {
  const out: Signal[] = []
  const add = (
    w: Working,
    source: PartsRulesSource,
    regex: RegExp,
    ruleId: string,
    signal: (text: string) => PartsRulesSignal,
    limit = w.text.length,
  ) => {
    for (const m of w.text.slice(0, limit).matchAll(regex)) {
      const text = m[0].trim()
      if (!text) continue
      const lead = m[0].indexOf(text)
      const at = located(w, m.index + lead, m.index + lead + text.length)
      out.push({ signal: signal(text), source, ...at, ruleId })
    }
  }
  const k = rules.kind
  add(title, 'title', k.wantedTitle, 'kind.wantedTitle', () => 'wanted_or_swap')
  add(title, 'title', k.laptopTitle, 'kind.laptopTitle', (t) =>
    EXPLICIT_LAPTOP.test(t) ? 'laptop' : 'laptop_family',
  )
  add(title, 'title', k.pcTitle, 'kind.pcTitle', () => 'pc')
  add(title, 'title', k.notAPcTitle, 'kind.notAPcTitle', () => 'not_a_pc')
  add(title, 'title', k.cpuOrPcTitle, 'kind.cpuOrPcTitle', () => 'cpu_or_pc')
  add(title, 'title', BOX_ONLY, 'kind.boxOnly', () => 'box_only')
  if (description) {
    add(
      description,
      'description',
      k.wantedDescription,
      'kind.wantedDescriptionFirst400Chars',
      () => 'wanted_or_swap',
      settings.wantedDescriptionChars,
    )
    add(description, 'description', BOX_ONLY, 'kind.boxOnly', () => 'box_only')
  }
  return out
}

const conflict = { kind: null, kindGap: 'conflict' as const }

/**
 * The kind the rules can settle from the title signals, else why not. A wanted or swap signal
 * wins. An explicit laptop word ("laptop", "notebook", "MacBook"...) is a laptop unless a PC word
 * disagrees. A laptop family name alone ("Legion", "Omen 16") is a laptop, but next to a PC word
 * or a CPU or desktop model it is a desktop ("Lenovo Legion Gaming PC",
 * fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:4734). A not-a-PC
 * word with no PC signal is not a PC. Anything else that disagrees is left to the model.
 */
export function decideKind(signals: Signal[]): {
  kind: PartsRulesKind | null
  kindGap: PartsRulesKindGap | null
} {
  const has = (s: PartsRulesSignal) => signals.some((x) => x.signal === s)
  const wanted = has('wanted_or_swap')
  const laptop = has('laptop')
  const family = has('laptop_family')
  const pc = has('pc') || has('cpu_or_pc')
  const notAPc = has('not_a_pc')
  if (wanted) return { kind: 'wanted_or_swap', kindGap: null }
  if (laptop) return !pc && !notAPc ? { kind: 'laptop', kindGap: null } : conflict
  if (family) {
    if (pc && !notAPc) return { kind: 'pc', kindGap: null }
    return !notAPc ? { kind: 'laptop', kindGap: null } : conflict
  }
  if (notAPc) return pc ? conflict : { kind: 'not_a_pc', kindGap: null }
  if (pc) return { kind: 'pc', kindGap: null }
  return { kind: null, kindGap: 'no_signal' }
}

/** Runs the rule pass over one listing version. */
export function analyse(
  listing: ListingText,
  rules: CompiledRules,
  settings: RuleSettings,
  negativeContexts: string[],
): Analysis {
  const title = workingCopy(listing.title)
  const description = listing.description ? workingCopy(listing.description) : null
  const signals = kindSignals(workingCopy(listing.title), description, rules, settings)

  const tagBlocks: TagBlock[] = []
  const texts: [Working, PartsRulesSource][] = [[title, 'title']]
  if (description) texts.push([description, 'description'])
  for (const [w, source] of texts) {
    blankNegatives(w, negativeContexts)
    for (const span of tagBlocksIn(w, rules, settings)) {
      const at = located(w, span.start, span.end)
      tagBlocks.push({ source, start: at.start, end: at.end, ruleId: span.ruleId })
      blank(w, span.start, span.end)
    }
  }
  const signalsOutsideTags = signals.filter(
    (s) => !tagBlocks.some((b) => b.source === s.source && overlaps(b, s)),
  )

  // Structured attributes and detail sections first (one read per distinct name and value).
  const seen = new Set<string>()
  const attributeHits: Hit[] = []
  for (const a of [...listing.attributes, ...listing.detailSections]) {
    const name = a.name ?? a.label ?? ''
    const value = a.value ?? ''
    const key = `${name}\u0000${value}`
    if (!value.trim() || seen.has(key)) continue
    seen.add(key)
    const allowed = attributeLabel(name)
    if (allowed && allowed.length === 0) continue
    const w = workingCopy(value)
    blankNegatives(w, negativeContexts)
    attributeHits.push(...fieldHits(w, 'attribute', rules, settings, allowed, name || undefined))
  }
  const hits = prune([
    ...attributeHits,
    ...fieldHits(title, 'title', rules, settings, null),
    ...(description ? fieldHits(description, 'description', rules, settings, null) : []),
  ])
  return { hits, signals: signalsOutsideTags, tagBlocks, ...decideKind(signalsOutsideTags) }
}
