// Pure logic, no I/O: the noise rules of the card (docs/design/modules/noise-filter.md) over one
// listing version at a time, called over a whole batch by `classify`. Every word list and
// threshold is `NOISE_FILTER_RULES` (@nabvy/config). Each reason needs positive evidence: silence,
// an unknown kind or a term the listing does not place is never noise. Facebook's category is
// never read.

import { createHash } from 'node:crypto'
import type { NoiseFilterRules } from '@nabvy/config/modules/noise-filter'
import type {
  NoiseFilterEvidence,
  NoiseFilterReason,
  NoiseFilterTerm,
  NoiseFilterTermStatus,
} from '@nabvy/contracts/modules/noise-filter'
import { NoiseFilterReason as Reasons } from '@nabvy/contracts/modules/noise-filter'
import type { PartsRecordPart } from '@nabvy/contracts/modules/parts-record'
import type { PartsRulesKindSignal, PartsRulesTagBlock } from '@nabvy/contracts/modules/parts-rules'

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/** A parts-rules kind signal of the version (`v_kind_signals`). */
export type SignalInput = Pick<
  PartsRulesKindSignal,
  'signal' | 'source' | 'quote' | 'start' | 'end'
>

/** A tag block of the version (`v_tag_blocks`). */
export type TagBlockInput = Pick<PartsRulesTagBlock, 'source' | 'start' | 'end'>

/** A part of the version's latest record (`v_parts`), with the decided inclusion. */
export type PartInput = Pick<
  PartsRecordPart,
  'partType' | 'inclusion' | 'rejected' | 'source' | 'quote' | 'start' | 'end'
>

/** What the rules read for one listing version. */
export interface ClassifyInput {
  listingId: string
  evidenceHash: string
  /** parts-record's kind (through `v_assessments`); null while open or off. */
  kind: string | null
  /** listing-assessment's form. */
  form: string | null
  /** The version's title (the card's while the version has none), as parts-rules read it. */
  title: string
  description: string | null
  signals: SignalInput[]
  tagBlocks: TagBlockInput[]
  parts: PartInput[]
  /** The search terms that found the listing (listing-ingest). */
  foundByTerms: string[]
  /** T1 of the input (listing-ingest's first fetch). */
  fetchedAt: Date | null
}

/** One classification, as stored. */
export interface Classification {
  listingId: string
  evidenceHash: string
  inputHash: string
  ruleVersion: string
  reasons: NoiseFilterReason[]
  evidence: NoiseFilterEvidence[]
  terms: NoiseFilterTerm[]
  fetchedAt: Date | null
}

/** The rule version of a rule set: `n<generation>.<first 8 hex of its digest>`. */
export function ruleVersion(rules: NoiseFilterRules): string {
  return `n${rules.ruleGeneration}.${sha256(JSON.stringify(rules)).slice(0, 8)}`
}

/**
 * The SHA-256 of everything a classification reads for a version, in a stable order: a new
 * input from any upstream module, or a new found-by term, changes it; a replay does not.
 */
export function inputHash(input: ClassifyInput): string {
  const by = <T>(rows: readonly T[], key: (r: T) => string) =>
    [...rows]
      .map((r) => [key(r), r] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return sha256(
    JSON.stringify([
      input.kind,
      input.form,
      input.title,
      input.description,
      by(input.signals, (s) => `${s.source}:${s.start}:${s.end}:${s.signal}`).map(([, s]) => [
        s.signal,
        s.source,
        s.quote,
        s.start,
        s.end,
      ]),
      by(input.tagBlocks, (b) => `${b.source}:${b.start}:${b.end}`).map(([, b]) => [
        b.source,
        b.start,
        b.end,
      ]),
      by(input.parts, (p) => `${p.source}:${p.start}:${p.end}:${p.partType}:${p.quote}`).map(
        ([, p]) => [p.partType, p.inclusion, p.rejected, p.source, p.quote, p.start, p.end],
      ),
      normaliseTerms(input.foundByTerms),
    ]),
  )
}

/** Distinct, trimmed, lower-cased search terms, sorted. */
export function normaliseTerms(terms: readonly string[]): string[] {
  return [...new Set(terms.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0))].sort()
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A phrase as a pattern: any run of spaces, `+`, `-` or `/` between words; either apostrophe. */
function phrase(p: string): string {
  return p
    .trim()
    .split(/[\s+]+/)
    .map((w) => escapeRegex(w).replace(/'/g, "['’]?"))
    .join('[\\s+\\-/]+')
}

/** One pattern matching any of the phrases on word boundaries. */
export function phrasesRegex(phrases: readonly string[], flags = 'iu'): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${phrases.map(phrase).join('|')})(?![\\p{L}\\p{N}])`,
    flags,
  )
}

/** Compiled patterns of a rule set. */
export interface Compiled {
  rules: NoiseFilterRules
  wantedTitle: RegExp
  wantedAnywhere: RegExp
  buyInTitle: RegExp
  buyInTitleStart: RegExp
  buyInDescription: RegExp
  swapTitle: RegExp
  swapSaleCues: RegExp
  negated: RegExp
  serviceTitle: RegExp
  serviceTitleExcept: RegExp
  serviceDescription: RegExp[]
  termModel: RegExp
}

export function compile(rules: NoiseFilterRules): Compiled {
  const whole = (phrases: readonly string[]) =>
    new RegExp(`^${phrasesRegex(phrases).source}$`, 'iu')
  return {
    rules,
    wantedTitle: whole(rules.wantedTitle),
    wantedAnywhere: phrasesRegex(rules.wantedTitle),
    buyInTitle: whole(rules.buyInTitle),
    buyInTitleStart: whole(rules.buyInTitleStart),
    buyInDescription: phrasesRegex(rules.buyInDescription),
    swapTitle: whole(rules.swapTitle),
    swapSaleCues: phrasesRegex(rules.swapSaleCues),
    negated: new RegExp(`${phrasesRegex(rules.negators).source}[^\\p{L}\\p{N}]*$`, 'iu'),
    serviceTitle: phrasesRegex(rules.serviceTitle),
    serviceTitleExcept: phrasesRegex(rules.serviceTitleExcept, 'giu'),
    serviceDescription: rules.serviceDescription.map((p) => new RegExp(p, 'iu')),
    termModel: new RegExp(rules.termModelPattern, 'iu'),
  }
}

/** True when a negator ("no", "not"...) sits just before `start` in `text`. */
function isNegated(text: string, start: number, c: Compiled): boolean {
  return c.negated.test(text.slice(Math.max(0, start - c.rules.negatorChars), start))
}

/** True when nothing but punctuation, spaces or symbols comes before `start`. */
const opens = (text: string, start: number) => !/[\p{L}\p{N}]/u.test(text.slice(0, start))

type Found = { reason: NoiseFilterReason; evidence: NoiseFilterEvidence }

const quoted = (
  reason: NoiseFilterReason,
  source: 'title' | 'description',
  quote: string,
  start: number,
  end: number,
): Found => ({ reason, evidence: { reason, source, quote: quote.slice(0, 400), start, end } })

/**
 * Wanted, buy-in and swap adverts, from parts-rules' `wanted_or_swap` signals (the actor's
 * `wantedTitle` and `wantedDescriptionFirst400Chars`) narrowed by this module's own words. A
 * negated signal ("No swaps") never counts.
 */
export function advertReasons(input: ClassifyInput, c: Compiled): Found[] {
  const out: Found[] = []
  const titleOffers = input.parts.some(
    (p) => p.source === 'title' && p.inclusion === 'offered' && !p.rejected,
  )
  for (const s of input.signals) {
    if (s.signal !== 'wanted_or_swap') continue
    if (s.source === 'title') {
      const title = input.title
      if (isNegated(title, s.start, c)) continue
      const q = s.quote.trim()
      if (c.wantedTitle.test(q)) out.push(quoted('wanted', 'title', s.quote, s.start, s.end))
      else if (c.buyInTitle.test(q) || (c.buyInTitleStart.test(q) && opens(title, s.start)))
        out.push(quoted('buy_in', 'title', s.quote, s.start, s.end))
      else if (c.swapTitle.test(q) && !c.swapSaleCues.test(title)) {
        const after = title.slice(s.end)
        if (opens(title, s.start) || /^[^\p{L}\p{N}]*(?:\S+\s+){0,4}?for\b/iu.test(after))
          out.push(quoted('swap', 'title', s.quote, s.start, s.end))
      }
    } else if (s.source === 'description' && input.description) {
      const text = input.description
      if (s.start >= c.rules.descriptionFirstChars || titleOffers) continue
      if (/[.!?\n]/.test(text.slice(0, s.start))) continue // not the first sentence
      if (isNegated(text, s.start, c) || !c.buyInDescription.test(s.quote)) continue
      const reason = c.wantedAnywhere.test(s.quote) ? 'wanted' : 'buy_in'
      out.push(quoted(reason, 'description', s.quote, s.start, s.end))
    }
  }
  return out
}

/**
 * A service or repair advert: a service phrase in the title (after faulty-item phrases such as
 * "spares or repairs" are blanked), or a service offer in the description's first characters
 * when the listing offers no part.
 */
export function serviceReasons(input: ClassifyInput, c: Compiled): Found[] {
  const blanked = input.title.replace(c.serviceTitleExcept, (m) => ' '.repeat(m.length))
  const t = c.serviceTitle.exec(blanked)
  if (t)
    return [
      quoted(
        'service',
        'title',
        input.title.slice(t.index, t.index + t[0].length),
        t.index,
        t.index + t[0].length,
      ),
    ]
  if (!input.description) return []
  if (input.parts.some((p) => p.inclusion === 'offered' && !p.rejected)) return []
  const head = input.description.slice(0, c.rules.descriptionFirstChars)
  for (const re of c.serviceDescription) {
    const m = re.exec(head)
    if (m) return [quoted('service', 'description', m[0], m.index, m.index + m[0].length)]
  }
  return []
}

/** The model key a term names ("rtx 5080" → "5080", "4070 ti" → "4070ti"), or null. */
export function termKey(term: string, c: Compiled): { key: string; pattern: RegExp } | null {
  const m = c.termModel.exec(term)
  if (!m?.[1]) return null
  const suffix = (m[2] ?? '').toLowerCase()
  const pattern = new RegExp(
    `(?<!\\p{N})${m[1]}${suffix ? `\\s*-?\\s*${escapeRegex(suffix)}` : ''}(?!\\p{N})`,
    'giu',
  )
  return { key: `${m[1]}${suffix}`, pattern }
}

const matches = (re: RegExp, text: string) => [...text.matchAll(new RegExp(re.source, re.flags))]

/** How each found-by term relates to the listing (`NoiseFilterTermStatus`). */
export function termStatuses(input: ClassifyInput, c: Compiled): NoiseFilterTerm[] {
  return normaliseTerms(input.foundByTerms).map((term) => {
    const k = termKey(term, c)
    if (!k) return { term: term.slice(0, 200), key: null, status: 'generic' as const }
    const naming = input.parts.filter((p) => p.quote && matches(k.pattern, p.quote).length > 0)
    let status: NoiseFilterTermStatus
    if (naming.some((p) => p.inclusion === 'offered' && !p.rejected)) status = 'offered'
    else if (naming.length > 0) status = 'mention'
    else {
      const hits = [
        ...matches(k.pattern, input.title).map((m) => ({ source: 'title', m })),
        ...matches(k.pattern, input.description ?? '').map((m) => ({ source: 'description', m })),
      ]
      if (hits.length === 0) status = 'absent'
      else
        status = hits.every(({ source, m }) =>
          input.tagBlocks.some(
            (b) => b.source === source && m.index >= b.start && m.index + m[0].length <= b.end,
          ),
        )
          ? 'tag_only'
          : 'unplaced'
    }
    return { term: term.slice(0, 200), key: k.key.slice(0, 20), status }
  })
}

/**
 * Mention-only hits and keyword stuffing: every term that found the listing names a model the
 * listing only mentions, or finds only inside a tag block. A generic, offered, unplaced or absent
 * term keeps the listing a candidate for that search, so it is never noise.
 */
export function termReasons(terms: readonly NoiseFilterTerm[]): Found[] {
  if (terms.length === 0) return []
  if (!terms.every((t) => t.status === 'mention' || t.status === 'tag_only')) return []
  const out: Found[] = []
  for (const t of terms) {
    const reason = t.status === 'mention' ? 'mention_only' : 'keyword_stuffing'
    out.push({
      reason,
      evidence: { reason, source: 'terms', quote: t.term, start: null, end: null },
    })
  }
  return out
}

/** Classifies one listing version. */
export function classifyOne(input: ClassifyInput, c: Compiled, version: string): Classification {
  const found: Found[] = []
  found.push(...advertReasons(input, c))
  if (input.kind === 'laptop') {
    found.push({
      reason: 'laptop',
      evidence: { reason: 'laptop', source: 'kind', quote: null, start: null, end: null },
    })
  }
  if (input.form === 'box_only') {
    found.push({
      reason: 'box_only',
      evidence: { reason: 'box_only', source: 'form', quote: null, start: null, end: null },
    })
  }
  const terms = termStatuses(input, c)
  found.push(...termReasons(terms))
  found.push(...serviceReasons(input, c))
  const present = new Set(found.map((f) => f.reason))
  return {
    listingId: input.listingId,
    evidenceHash: input.evidenceHash,
    inputHash: inputHash(input),
    ruleVersion: version,
    reasons: Reasons.options.filter((r) => present.has(r)),
    evidence: found.map((f) => f.evidence).slice(0, 64),
    terms: terms.slice(0, 64),
    fetchedAt: input.fetchedAt,
  }
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** The versions an event batch announces, as stored. */
export interface Announced {
  listingId: string
  evidenceHash: string
  inputHash: string
  ruleVersion: string
}

/**
 * The idempotency key of one `noise-filter.classified` event: the SHA-256 of the sorted
 * `listing@evidence@input@rule` lines of the stored rows it announces, plus its batch index.
 */
export function classifiedKey(rows: readonly Announced[], batch: number): string {
  const lines = rows
    .map((r) => `${r.listingId}@${r.evidenceHash}@${r.inputHash}@${r.ruleVersion}`)
    .sort()
  return `noise-filter.classified:${sha256(lines.join('\n'))}:${batch}`
}
