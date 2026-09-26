// Pure logic, no I/O: the assessment rules of the card (docs/design/modules/listing-assessment.md,
// R1-R6) over one listing version at a time, called over a whole batch by `assess`. Every
// threshold and word list is `LISTING_ASSESSMENT_RULES` (@nabvy/config); nothing here invents a
// fact: silence is "not stated", never "no" (CONTAINER_LISTINGS.md:43-45).

import { createHash } from 'node:crypto'
import type { ListingAssessmentRules } from '@nabvy/config/modules/listing-assessment'
import type { DetailEvidenceAttribute } from '@nabvy/contracts/modules/detail-evidence'
import type {
  ListingAssessmentCaution,
  ListingAssessmentConfirmedPart,
  ListingAssessmentContainerReason,
  ListingAssessmentCoverage,
  ListingAssessmentExclusion,
  ListingAssessmentExtra,
  ListingAssessmentForm,
  ListingAssessmentGpuState,
} from '@nabvy/contracts/modules/listing-assessment'
import type { PartsRecordPart, PartsRecordRecord } from '@nabvy/contracts/modules/parts-record'

/** The parts-record columns the assessment reads for a version (`v_records`). */
export type RecordInput = Pick<
  PartsRecordRecord,
  'kind' | 'kindGap' | 'ruleVersion' | 'aiVersion' | 'photoVersion'
>

/** The `v_parts` columns the assessment reads. */
export type PartInput = Pick<
  PartsRecordPart,
  | 'seq'
  | 'partType'
  | 'catalogueId'
  | 'inclusion'
  | 'rejected'
  | 'source'
  | 'extractor'
  | 'quote'
  | 'start'
  | 'end'
  | 'conflict'
>

/** Everything one assessment reads about one listing version. */
export interface AssessmentInput {
  listingId: string
  evidenceHash: string
  /** listing-ingest's card: null while it shows none. */
  cardHash: string | null
  displayedPreviousMinor: number | null
  /** detail-evidence's version and text. */
  title: string
  description: string | null
  descriptionStatus: 'full_verified' | 'partial' | 'missing' | null
  hasDescription: boolean
  attributes: DetailEvidenceAttribute[]
  detailSections: DetailEvidenceAttribute[]
  staleFallback: boolean
  record: RecordInput
  parts: PartInput[]
}

/** One assessment, as the table stores it (before T3 and a carried correction). */
export interface Assessment {
  listingId: string
  evidenceHash: string
  cardHash: string | null
  recordHash: string
  ruleVersion: string
  form: ListingAssessmentForm
  container: boolean
  containerReason: ListingAssessmentContainerReason
  gpuState: ListingAssessmentGpuState
  cautions: ListingAssessmentCaution[]
  coverage: ListingAssessmentCoverage
  confirmedParts: ListingAssessmentConfirmedPart[]
  exclusions: ListingAssessmentExclusion[]
  extras: ListingAssessmentExtra[]
  unknowns: string[]
}

const CAUTIONS: ListingAssessmentCaution[] = [
  'box_only',
  'previous_price',
  'photo_only',
  'stale_text',
  'bundle_price',
]

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/** The rule version: `a<generation>.<first 8 hex of the rules' digest>`. */
export function ruleVersion(rules: ListingAssessmentRules): string {
  return `a${rules.ruleGeneration}.${sha256(JSON.stringify(rules)).slice(0, 8)}`
}

/**
 * The SHA-256 of what the assessment reads from parts-record for a version: its kind and
 * versions, and each part's decision and position. A new record, or a reviewer's correction
 * there, changes it, so the assessment is written again; a replay does not.
 */
export function recordHash(record: RecordInput, parts: readonly PartInput[]): string {
  const rows = [...parts]
    .sort((a, b) => a.seq - b.seq)
    .map((p) => [
      p.seq,
      p.partType,
      p.catalogueId,
      p.inclusion,
      p.rejected,
      p.source,
      p.extractor,
      p.start,
      p.end,
      p.conflict,
    ])
  return sha256(
    JSON.stringify([
      record.kind,
      record.kindGap,
      record.ruleVersion,
      record.aiVersion,
      record.photoVersion,
      rows,
    ]),
  )
}

// ---- text matching ------------------------------------------------------------------------

/** `+` between words read as a space (same length, so offsets hold), for matching only. */
export const readable = (text: string) => text.replace(/\+/g, ' ')

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A case-insensitive pattern for a phrase on word boundaries; spaces match any whitespace. */
export function phrasePattern(phrase: string): RegExp {
  const words = phrase.trim().split(/\s+/)
  const body = words.map(escapeRegExp).join('\\s+')
  const edge = /[\p{L}\p{N}]/u
  const lead = edge.test(phrase.trim()[0] ?? '') ? '(?<![\\p{L}\\p{N}])' : ''
  const tail = edge.test(phrase.trim().at(-1) ?? '') ? '(?![\\p{L}\\p{N}])' : ''
  return new RegExp(`${lead}${body}${tail}`, 'giu')
}

export interface Match {
  start: number
  end: number
  text: string
}

/** Every match of any of `phrases` in `text`, longest first where two overlap, in text order. */
export function findPhrases(text: string, phrases: readonly string[]): Match[] {
  const source = readable(text)
  const all: Match[] = []
  for (const phrase of phrases) {
    for (const m of source.matchAll(phrasePattern(phrase))) {
      all.push({
        start: m.index,
        end: m.index + m[0].length,
        text: text.slice(m.index, m.index + m[0].length),
      })
    }
  }
  all.sort((a, b) => a.start - b.start || b.end - a.end)
  const kept: Match[] = []
  for (const m of all) {
    if (kept.some((k) => m.start < k.end && k.start < m.end)) continue
    kept.push(m)
  }
  return kept
}

const hasPhrase = (text: string, phrases: readonly string[]) =>
  findPhrases(text, phrases).length > 0

/**
 * The clean-context window of `[start, end)`: `chars` either side, clipped to its sentence (or
 * line, or bullet), so a spec line next to "RTX 4090 not included" is read on its own.
 */
export function cleanContext(text: string, start: number, end: number, chars: number): string {
  const [from, to] = sentence(text, start, end)
  return text.slice(Math.max(from, start - chars), Math.min(to, end + chars))
}

/** The bounds of the sentence (or line, or bullet) holding `[start, end)`. */
export function sentence(text: string, start: number, end: number): [number, number] {
  const stop = /[.!?\n•*|]/
  let from = start
  while (from > 0 && !stop.test(text[from - 1] ?? '')) from -= 1
  let to = end
  while (to < text.length && !stop.test(text[to] ?? '')) to += 1
  return [from, to]
}

// ---- the rules ----------------------------------------------------------------------------

const isOffered = (p: PartInput) => p.inclusion === 'offered' && !p.rejected
const CORE: Record<'cpu' | 'ram' | 'storage', readonly string[]> = {
  cpu: ['cpu'],
  ram: ['ram_size', 'ram_generation'],
  storage: ['storage_size', 'storage_type'],
}

const attributeText = (a: DetailEvidenceAttribute) =>
  [a.name, a.label].filter((s): s is string => s !== null).join(' ')

/**
 * R1, R1b: never a container when the title says box only (the box holds no parts). Otherwise a
 * container when the description, attributes or detail sections name at least
 * `containerMinCoreParts` of CPU, RAM and storage; or a seller attribute such as "Processor type"
 * or "Is for gaming: Yes"; or a title word such as "bundle"; or the record's kind is a PC; or the
 * rules could not place it (no kind). Otherwise the record placed it as something else.
 */
export function containerOf(
  input: AssessmentInput,
  rules: ListingAssessmentRules,
): { container: boolean; reason: ListingAssessmentContainerReason } {
  const named = Object.values(CORE).filter((types) =>
    input.parts.some(
      (p) =>
        isOffered(p) &&
        (p.source === 'description' || p.source === 'attribute') &&
        types.includes(p.partType),
    ),
  ).length
  if (hasPhrase(input.title, rules.boxOnlyPhrases)) return { container: false, reason: 'box_only' }
  if (named >= rules.containerMinCoreParts) return { container: true, reason: 'parts' }
  const attributes = [...input.attributes, ...input.detailSections]
  const byName = attributes.some((a) => hasPhrase(attributeText(a), rules.containerAttributeNames))
  const gaming = attributes.some(
    (a) =>
      hasPhrase(attributeText(a), rules.gamingAttributeNames) && /^\s*yes\s*$/i.test(a.value ?? ''),
  )
  if (byName || gaming) return { container: true, reason: 'attributes' }
  if (hasPhrase(input.title, rules.containerTitleWords)) {
    return { container: true, reason: 'title_words' }
  }
  if (input.record.kind === 'pc') return { container: true, reason: 'kind' }
  if (input.record.kind === null) return { container: true, reason: 'unplaced' }
  return { container: false, reason: 'placed' }
}

/**
 * R1c: the bundle extras a container is sold with, from the title and then the description, one
 * per item. An extra is left out when its sentence, within `contextChars` either side, says it is
 * optional, extra or not included, or a "no" or "without" comes just before it.
 */
export function extrasOf(
  input: AssessmentInput,
  rules: ListingAssessmentRules,
): ListingAssessmentExtra[] {
  const found: ListingAssessmentExtra[] = []
  const seen = new Set<string>()
  const texts: [ListingAssessmentExtra['source'], string][] = [
    ['title', input.title],
    ['description', input.description ?? ''],
  ]
  for (const [source, text] of texts) {
    const matches = findPhrases(
      text,
      rules.extras.flatMap((e) => e.words),
    )
    for (const m of matches) {
      const [from] = sentence(text, m.start, m.end)
      if (hasPhrase(cleanContext(text, m.start, m.end, rules.contextChars), rules.extraDemoters))
        continue
      // "Desk 119%": a benchmark score, not a desk.
      if (/^\s*\d+(\.\d+)?\s*%/.test(text.slice(m.end))) continue
      const before = readable(text.slice(Math.max(from, m.start - 25), m.start))
      if (/(?<![\p{L}\p{N}])(no|without|not|excluding)(?![\p{L}\p{N}])[^,;]*$/iu.test(before)) {
        continue
      }
      const lower = readable(m.text).toLowerCase().replace(/\s+/g, ' ')
      for (const extra of rules.extras) {
        if (!extra.words.includes(lower) || seen.has(extra.item)) continue
        seen.add(extra.item)
        found.push({ item: extra.item, source, quote: m.text, start: m.start, end: m.end })
      }
    }
  }
  return found
}

/** The stored text a part quotes verbatim at its offsets, or null when it is not there. */
function quotedIn(input: AssessmentInput, p: PartInput): string | null {
  const texts =
    p.source === 'title'
      ? [input.title]
      : p.source === 'description'
        ? [input.description]
        : p.source === 'attribute'
          ? [...input.attributes, ...input.detailSections].flatMap((a) => [a.value, a.label])
          : []
  return texts.find((t) => t != null && t.slice(p.start, p.end) === p.quote) ?? null
}

/**
 * R5: a part is confirmed when it is offered and not rejected, quoted verbatim from the stored
 * title, description or attribute (never a photo), the detail is fresh (not a stale-cache copy;
 * a description quote needs a `full_verified` description) and its clean context (`cleanContext`)
 * holds no demoting word ("not included", "upgraded to", "swap" and the rest) and no box-only
 * wording. Nothing is confirmed in a box-only listing.
 */
export function confirmedOf(
  input: AssessmentInput,
  rules: ListingAssessmentRules,
): ListingAssessmentConfirmedPart[] {
  if (input.staleFallback || hasPhrase(input.title, rules.boxOnlyPhrases)) return []
  return input.parts
    .filter((p) => {
      if (!isOffered(p) || p.source === 'photo') return false
      if (p.source === 'description' && input.descriptionStatus !== 'full_verified') return false
      const text = quotedIn(input, p)
      if (text === null) return false
      const around = cleanContext(text, p.start, p.end, rules.contextChars)
      return !hasPhrase(around, rules.demoters) && !hasPhrase(around, rules.boxOnlyPhrases)
    })
    .map((p) => ({
      seq: p.seq,
      partType: p.partType,
      catalogueId: p.catalogueId,
      extractor: p.extractor,
      source: p.source,
      quote: p.quote,
      start: p.start,
      end: p.end,
    }))
}

const ISSUE_AFTER = /^\s*(issues?|problems?|faults?|errors?)(?![\p{L}\p{N}])/iu

/** "No GPU" and the like in the title or description (never followed by "issues"). */
function gpuNoneMatches(input: AssessmentInput, rules: ListingAssessmentRules) {
  const texts: ['title' | 'description', string][] = [
    ['title', input.title],
    ['description', input.description ?? ''],
  ]
  return texts.flatMap(([source, text]) =>
    findPhrases(text, rules.gpuNonePhrases)
      .filter((m) => !ISSUE_AFTER.test(readable(text.slice(m.end))))
      .map((m) => ({ source, ...m })),
  )
}

/**
 * R6: the parts a listing expressly leaves out, from positive evidence only: a part the record
 * reads as not included (the "RTX 4090 not included" of CONTAINER_LISTINGS.md:179-180), or a
 * "no GPU" phrase not already covered by such a part.
 */
export function exclusionsOf(
  input: AssessmentInput,
  rules: ListingAssessmentRules,
): ListingAssessmentExclusion[] {
  const fromParts: ListingAssessmentExclusion[] = input.parts
    .filter((p) => p.inclusion === 'not_included' && !p.rejected)
    .map((p) => ({
      partType: p.partType,
      seq: p.seq,
      source: p.source,
      quote: p.quote,
      start: p.start,
      end: p.end,
    }))
  const fromPhrases: ListingAssessmentExclusion[] = gpuNoneMatches(input, rules)
    .filter(
      (m) =>
        !fromParts.some(
          (x) => x.source === m.source && m.start < x.end + 40 && x.start < m.end + 40,
        ),
    )
    .map((m) => ({
      partType: 'gpu',
      seq: null,
      source: m.source,
      quote: m.text,
      start: m.start,
      end: m.end,
    }))
  return [...fromParts, ...fromPhrases]
}

/**
 * The GPU state: `conflicting` when parts-record flags offered GPUs that disagree, or a GPU is
 * offered in the text while a phrase says there is none; `named` for an offered GPU in the text
 * or attributes; `none` on positive evidence of no GPU; `integrated` when the text says so;
 * `in_photos` when only a photo shows one; otherwise `not_stated`, never "none".
 */
export function gpuStateOf(
  input: AssessmentInput,
  exclusions: readonly ListingAssessmentExclusion[],
  rules: ListingAssessmentRules,
): ListingAssessmentGpuState {
  const none = exclusions.filter((x) => x.partType === 'gpu')
  // A box-only listing sells no GPU: the card it names is the box's.
  if (hasPhrase(input.title, rules.boxOnlyPhrases)) return none.length > 0 ? 'none' : 'not_stated'
  const gpus = input.parts.filter((p) => p.partType === 'gpu' && isOffered(p))
  if (gpus.some((p) => p.conflict)) return 'conflicting'
  const inText = gpus.filter((p) => p.source !== 'photo')
  if (inText.length > 0) return none.some((x) => x.seq === null) ? 'conflicting' : 'named'
  if (none.length > 0) return 'none'
  if (hasPhrase(`${input.title}\n${input.description ?? ''}`, rules.gpuIntegratedPhrases)) {
    return 'integrated'
  }
  if (gpus.length > 0) return 'in_photos'
  return 'not_stated'
}

/** The whole assessment of one listing version. */
export function assessOne(
  input: AssessmentInput,
  rules: ListingAssessmentRules,
  version: string = ruleVersion(rules),
): Assessment {
  const { container, reason } = containerOf(input, rules)
  const extras = container ? extrasOf(input, rules) : []
  const exclusions = exclusionsOf(input, rules)
  const gpuState = gpuStateOf(input, exclusions, rules)
  const boxInTitle = hasPhrase(input.title, rules.boxOnlyPhrases)
  const boxOnly = boxInTitle || hasPhrase(input.description ?? '', rules.boxOnlyPhrases)

  const offered = input.parts.filter(isOffered)
  let form: ListingAssessmentForm
  if (boxInTitle) form = 'box_only'
  else if (container) {
    form = extras.length > 0 || reason === 'title_words' ? 'bundle' : 'system'
  } else form = offered.length > 0 ? 'part' : 'unknown'

  const inText = new Set(offered.filter((p) => p.source !== 'photo').map((p) => p.partType))
  const photoOnly = offered.some((p) => p.source === 'photo' && !inText.has(p.partType))
  const flags: Record<ListingAssessmentCaution, boolean> = {
    box_only: boxOnly,
    previous_price: input.displayedPreviousMinor !== null,
    photo_only: photoOnly,
    stale_text: input.staleFallback,
    bundle_price: extras.length > 0,
  }

  const stated = new Set(offered.map((p) => p.partType))
  const unknowns = container
    ? rules.unknownPartTypes.filter((type) =>
        type === 'gpu' ? gpuState === 'not_stated' : !stated.has(type),
      )
    : []

  return {
    listingId: input.listingId,
    evidenceHash: input.evidenceHash,
    cardHash: input.cardHash,
    recordHash: recordHash(input.record, input.parts),
    ruleVersion: version,
    form,
    container,
    containerReason: reason,
    gpuState,
    cautions: CAUTIONS.filter((c) => flags[c]),
    coverage: {
      title: input.title.trim().length > 0,
      fullDescription: input.descriptionStatus === 'full_verified' && input.hasDescription,
      photos: input.record.photoVersion !== null,
    },
    confirmedParts: confirmedOf(input, rules),
    exclusions,
    extras,
    unknowns,
  }
}

/** Splits items into batches of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** The versions an event batch announces, as stored. */
export interface Announced {
  listingId: string
  evidenceHash: string
  cardHash: string | null
  recordHash: string
  ruleVersion: string
}

/**
 * The `assessed` event key: the SHA-256 of the sorted
 * `listing@hash@card@record@rule` lines of the stored assessments plus the batch index, so a
 * replay yields the same key and any new input a new one.
 */
export function assessedKey(rows: readonly Announced[], batch: number): string {
  const lines = rows
    .map(
      (r) =>
        `${r.listingId}@${r.evidenceHash}@${r.cardHash ?? ''}@${r.recordHash}@${r.ruleVersion}`,
    )
    .sort()
  return `listing-assessment.assessed:${sha256(lines.join('\n'))}:${batch}`
}
