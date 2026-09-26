// Pure logic (no I/O): the merge of one listing version's rule rows, AI rows and photo verdicts
// into one record, the record's kind, each part's decided inclusion, the conflicts between parts,
// the carry-forward of a reviewer's corrections onto a re-merged record, and the event key.
// Nothing here prices anything or guesses: when inputs disagree, the conflict is recorded.

import { createHash } from 'node:crypto'
import type { PartsAiPart, PartsAiRun } from '@nabvy/contracts/modules/parts-ai'
import type {
  PartsRecordAttrs,
  PartsRecordExtractor,
  PartsRecordInclusion,
  PartsRecordKind,
  PartsRecordKindGap,
  PartsRecordPartType,
  PartsRecordPhotoVerdict,
  PartsRecordSource,
  PartsRecordStoredCorrection,
} from '@nabvy/contracts/modules/parts-record'
import type {
  PartsRulesKindSignal,
  PartsRulesPart,
  PartsRulesSignal,
} from '@nabvy/contracts/modules/parts-rules'

/** The rules' latest run over one listing version, with its hits and kind signals. */
export interface RulesInput {
  ruleVersion: string
  kind: PartsRecordKind | null
  kindGap: PartsRecordKindGap | null
  parts: PartsRulesPart[]
  signals: PartsRulesKindSignal[]
}

/** parts-ai's latest extracted call over the version, with its parts. Null when it has none. */
export interface AiInput {
  promptVersion: string
  kind: Pick<PartsAiRun, 'kind' | 'kindSource' | 'kindQuote' | 'kindStart' | 'kindEnd'>
  parts: PartsAiPart[]
}

/** photo-review's verdicts over the version (the injected seam). Null when it has none. */
export interface PhotoInput {
  photoVersion: string
  verdicts: PartsRecordPhotoVerdict[]
}

export interface MergeInput {
  listingId: string
  evidenceHash: string
  rules: RulesInput
  ai: AiInput | null
  photo: PhotoInput | null
  /** The catalogue's family per catalogue ID (`v_items`), for conflict detection. */
  families: ReadonlyMap<string, string | null>
}

export interface MergedPart {
  seq: number
  partType: PartsRecordPartType
  catalogueId: string | null
  attrs: PartsRecordAttrs
  inclusion: PartsRecordInclusion
  source: PartsRecordSource
  extractor: PartsRecordExtractor
  extractorVersion: string
  quote: string
  start: number
  end: number
  conflict: boolean
}

export interface MergedKind {
  kind: PartsRecordKind | null
  kindGap: PartsRecordKindGap | null
  kindBy: Extract<PartsRecordExtractor, 'rules' | 'ai'> | null
  kindSource: PartsRecordSource | null
  kindQuote: string | null
  kindStart: number | null
  kindEnd: number | null
}

export interface MergedRecord extends MergedKind {
  listingId: string
  evidenceHash: string
  ruleVersion: string
  aiVersion: string | null
  photoVersion: string | null
  conflict: boolean
  parts: MergedPart[]
}

/** The kind signals that bear out each kind, in the order a quote is taken from them. */
const SIGNALS_OF: Record<PartsRecordKind, PartsRulesSignal[]> = {
  wanted_or_swap: ['wanted_or_swap'],
  laptop: ['laptop', 'laptop_family'],
  pc: ['pc', 'cpu_or_pc'],
  not_a_pc: ['not_a_pc', 'box_only'],
}

const NO_KIND: MergedKind = {
  kind: null,
  kindGap: null,
  kindBy: null,
  kindSource: null,
  kindQuote: null,
  kindStart: null,
  kindEnd: null,
}

/**
 * The record's kind: the rules' when they settled it (quoted from the first signal that bears it
 * out), else the model's when it answered (parts-ai asks only where the rules left it open),
 * else open, with the rules' reason (`no_signal` when the rules gave none).
 */
export function mergeKind(rules: RulesInput, ai: AiInput | null): MergedKind {
  if (rules.kind) {
    const signal = rules.signals.find((s) =>
      SIGNALS_OF[rules.kind as PartsRecordKind].includes(s.signal),
    )
    return {
      ...NO_KIND,
      kind: rules.kind,
      kindBy: 'rules',
      kindSource: signal?.source ?? null,
      kindQuote: signal?.quote ?? null,
      kindStart: signal?.start ?? null,
      kindEnd: signal?.end ?? null,
    }
  }
  const k = ai?.kind
  if (k?.kind) {
    return {
      ...NO_KIND,
      kind: k.kind,
      kindBy: 'ai',
      kindSource: k.kindSource,
      kindQuote: k.kindQuote,
      kindStart: k.kindStart,
      kindEnd: k.kindEnd,
    }
  }
  return { ...NO_KIND, kindGap: rules.kindGap ?? 'no_signal' }
}

/**
 * Merges the inputs into one record. Rule hits come first in their order, then AI parts, then
 * photo verdicts. A source module's own correction is applied at the door: a rejected hit is
 * left off the record, a corrected inclusion replaces the candidate. Nothing is deduplicated:
 * a part named by two extractors is two rows, each with its own evidence, and `conflict` marks
 * the rows whose products or values disagree.
 */
export function merge(input: MergeInput): MergedRecord {
  const parts: Omit<MergedPart, 'seq' | 'conflict'>[] = []
  for (const p of input.rules.parts) {
    if (p.correction?.rejected) continue
    parts.push({
      partType: p.partType,
      catalogueId: p.catalogueId,
      attrs: p.attrs,
      inclusion: p.correction?.inclusion ?? p.inclusionCandidate,
      source: p.source,
      extractor: 'rules',
      extractorVersion: p.ruleVersion,
      quote: p.quote,
      start: p.start,
      end: p.end,
    })
  }
  for (const p of input.ai?.parts ?? []) {
    if (p.correction?.rejected) continue
    parts.push({
      partType: p.partType,
      catalogueId: p.catalogueId,
      attrs: p.family ? { family: p.family } : {},
      inclusion: p.correction?.inclusion ?? p.inclusion,
      source: p.source,
      extractor: 'ai',
      extractorVersion: p.promptVersion,
      quote: p.quote,
      start: p.start,
      end: p.end,
    })
  }
  for (const v of input.photo?.verdicts ?? []) {
    parts.push({
      partType: v.partType,
      catalogueId: v.catalogueId,
      attrs: v.family ? { family: v.family } : {},
      inclusion: 'offered',
      source: 'photo',
      extractor: 'photo',
      extractorVersion: v.photoVersion,
      quote: v.photoId,
      start: 0,
      end: 1,
    })
  }
  const conflicts = findConflicts(parts, input.families)
  const merged = parts.map((p, seq) => ({ ...p, seq, conflict: conflicts.has(seq) }))
  return {
    listingId: input.listingId,
    evidenceHash: input.evidenceHash,
    ruleVersion: input.rules.ruleVersion,
    aiVersion: input.ai?.promptVersion ?? null,
    photoVersion: input.photo?.photoVersion ?? null,
    ...mergeKind(input.rules, input.ai),
    conflict: conflicts.size > 0,
    parts: merged,
  }
}

/**
 * What a part names, for comparison within its type: a family (the catalogue's for a resolved
 * ID, else the extractor's) and a value (the catalogue ID, or the stated number). Null when the
 * part states nothing comparable, so it can never conflict.
 */
export function identity(
  p: Pick<MergedPart, 'partType' | 'catalogueId' | 'attrs'>,
  families: ReadonlyMap<string, string | null>,
): { family: string | null; value: string | null } {
  const a = p.attrs
  const family = (p.catalogueId ? families.get(p.catalogueId) : undefined) ?? a.family ?? null
  switch (p.partType) {
    case 'gpu':
    case 'cpu':
      return { family, value: p.catalogueId }
    case 'ram_size':
      return { family: null, value: a.gb === undefined ? null : `${a.gb}gb` }
    case 'ram_generation':
      return { family: null, value: a.ddr === undefined ? null : `ddr${a.ddr}` }
    // A PC holds several drives, so two sizes or two types are two drives, never a conflict.
    case 'storage_size':
    case 'storage_type':
      return { family: null, value: null }
    case 'psu_wattage':
      return { family: null, value: a.watts === undefined ? null : `${a.watts}w` }
    case 'chipset':
      return { family: null, value: a.chipset?.toLowerCase() ?? null }
  }
}

/**
 * The indexes of the offered parts that disagree with another offered part of the same type:
 * two resolved catalogue IDs that differ, two known families that differ, or (for RAM, PSU and
 * chipset) two stated values that differ. Storage never conflicts (several drives are normal).
 * Mentions and not-included parts never conflict: a seller may well mention another card than
 * the one offered.
 */
export function findConflicts(
  parts: Pick<MergedPart, 'partType' | 'catalogueId' | 'attrs' | 'inclusion'>[],
  families: ReadonlyMap<string, string | null>,
): Set<number> {
  const conflicts = new Set<number>()
  const byType = new Map<PartsRecordPartType, number[]>()
  parts.forEach((p, i) => {
    if (p.inclusion !== 'offered') return
    byType.set(p.partType, [...(byType.get(p.partType) ?? []), i])
  })
  for (const indexes of byType.values()) {
    const ids = indexes.map((i) => identity(parts[i] as MergedPart, families))
    const values = new Set(ids.map((x) => x.value).filter((v) => v !== null))
    const fams = new Set(ids.map((x) => x.family).filter((f) => f !== null))
    if (fams.size <= 1 && values.size <= 1) continue
    for (const [n, i] of indexes.entries()) {
      const x = ids[n] as { family: string | null; value: string | null }
      if (x.value !== null || x.family !== null) conflicts.add(i)
    }
  }
  return conflicts
}

/** A part's identity across re-merges: the same evidence found by the same extractor. */
export const partKey = (
  p: Pick<MergedPart, 'partType' | 'source' | 'extractor' | 'quote' | 'start' | 'end'>,
) => `${p.extractor}:${p.source}:${p.partType}:${p.start}-${p.end}:${p.quote}`

/**
 * Carries a reviewer's corrections from the previous record of the version onto the re-merged
 * one, part by part, where the same extractor found the same quote at the same position. A
 * correction on a part the new record no longer holds is left on the old row.
 */
export function carryCorrections(
  previous: (Pick<MergedPart, 'partType' | 'source' | 'extractor' | 'quote' | 'start' | 'end'> & {
    correction: PartsRecordStoredCorrection | null
  })[],
  next: MergedPart[],
): Map<number, PartsRecordStoredCorrection> {
  const byKey = new Map<string, PartsRecordStoredCorrection>()
  for (const p of previous) if (p.correction) byKey.set(partKey(p), p.correction)
  const carried = new Map<number, PartsRecordStoredCorrection>()
  for (const p of next) {
    const c = byKey.get(partKey(p))
    if (c) carried.set(p.seq, c)
  }
  return carried
}

export interface Versions {
  ruleVersion: string
  aiVersion: string | null
  photoVersion: string | null
}

/**
 * Whether a merge adds anything to the stored latest record of the version: a new rule version,
 * or an AI or photo version the stored record lacks or differs from. A merge that only lacks an
 * input the stored record has (parts-ai switched off later, say) is not written, so a record
 * never loses information.
 */
export function addsInformation(next: Versions, stored: Versions | null): boolean {
  if (!stored) return true
  if (next.ruleVersion !== stored.ruleVersion) return true
  if (next.aiVersion !== null && next.aiVersion !== stored.aiVersion) return true
  if (next.photoVersion !== null && next.photoVersion !== stored.photoVersion) return true
  return false
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * The key of a `parts-record.recorded` event: the listing versions it names with the extractor
 * versions each record merged, derived from stored rows, so a replay yields the same key and a
 * new input version a new one.
 */
export function recordedKey(
  records: ReadonlyArray<{ listingId: string; evidenceHash: string } & Versions>,
  batch: number,
): string {
  const lines = records
    .map(
      (r) =>
        `${r.listingId}@${r.evidenceHash}@${r.ruleVersion}@${r.aiVersion ?? ''}@${r.photoVersion ?? ''}`,
    )
    .sort()
  const hash = createHash('sha256').update(lines.join('\n')).digest('hex')
  return `parts-record.recorded:${hash}:${batch}`
}
