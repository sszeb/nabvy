// Pure logic of the parts-ai module: no I/O. What to ask, where a quote is, whether a catalogue
// match is borne out by the quote, and the event keys.
import { createHash } from 'node:crypto'
import type {
  PartsAiInclusion,
  PartsAiOutput,
  PartsAiProblem,
  PartsAiSource,
} from '@nabvy/contracts/modules/parts-ai'
import type {
  PartsRulesKind,
  PartsRulesPartGap,
  PartsRulesPartType,
} from '@nabvy/contracts/modules/parts-rules'
import type { Asks } from './prompt'

export * from './prompt'

/**
 * What the model is asked for one listing version: the listing kind when the rules left it open,
 * and each part type the rules left open (not stated, mention only, unresolved or conflicting).
 * Nothing when the rules settled everything: the model runs only on gaps (the card).
 */
export function asksFor(gap: { kindGap: string | null; parts: PartsRulesPartGap[] }): Asks | null {
  const parts = [...new Set(gap.parts.map((p) => p.partType))].sort()
  const asks = { kind: gap.kindGap !== null, parts }
  return asks.kind || parts.length > 0 ? asks : null
}

export interface Located {
  source: PartsAiSource
  start: number
  end: number
  /** The stored text between `start` and `end`, verbatim. */
  quote: string
}

/**
 * Finds a quote in the stored title, then the description: verbatim first, then with runs of
 * whitespace read as one space (a model may fold a line break). Returns UTF-16 offsets into the
 * stored text and the stored slice, or null when the text does not contain it.
 */
export function locate(
  texts: { title: string; description: string },
  quote: string,
): Located | null {
  const wanted = quote.trim()
  if (!wanted) return null
  for (const source of ['title', 'description'] as const) {
    const text = texts[source]
    const exact = text.indexOf(wanted)
    if (exact >= 0) return { source, start: exact, end: exact + wanted.length, quote: wanted }
    const folded = foldWhitespace(text)
    const at = folded.text.indexOf(foldWhitespace(wanted).text)
    if (at < 0) continue
    const length = foldWhitespace(wanted).text.length
    const start = folded.map[at] as number
    const end = (folded.map[at + length - 1] as number) + 1
    return { source, start, end, quote: text.slice(start, end) }
  }
  return null
}

/** Whitespace runs as one space, with each folded character's offset in the original. */
function foldWhitespace(text: string): { text: string; map: number[] } {
  let out = ''
  const map: number[] = []
  let space = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string
    if (/\s/.test(ch)) {
      if (!space && out.length > 0) {
        out += ' '
        map.push(i)
      }
      space = true
      continue
    }
    space = false
    out += ch
    map.push(i)
  }
  if (out.endsWith(' ')) {
    out = out.slice(0, -1)
    map.pop()
  }
  return { text: out, map }
}

export interface CheckedPart {
  partType: PartsRulesPartType
  name: string | null
  inclusion: PartsAiInclusion
  located: Located
}

export type Checked =
  | {
      ok: true
      kind: { kind: PartsRulesKind; located: Located } | null
      parts: CheckedPart[]
    }
  | { ok: false; problem: PartsAiProblem; detail: string }

/**
 * Checks a valid output against the stored text: every quote must be found in it, or the whole
 * output is rejected (the card; one quote the text does not hold means the output cannot be
 * trusted). Then keeps only what was asked: the kind when asked, parts of the asked types. A
 * part type named twice keeps each quote (parts-record decides).
 */
export function check(
  output: PartsAiOutput,
  asks: Asks,
  texts: { title: string; description: string },
): Checked {
  const kindLocated = output.kind ? locate(texts, output.kind.quote) : null
  if (output.kind && !kindLocated) {
    return { ok: false, problem: 'quote_not_found', detail: 'kind.quote' }
  }
  const parts: CheckedPart[] = []
  for (const [i, part] of output.parts.entries()) {
    const located = locate(texts, part.quote)
    if (!located) return { ok: false, problem: 'quote_not_found', detail: `parts[${i}].quote` }
    if (!asks.parts.includes(part.partType)) continue
    parts.push({ partType: part.partType, name: part.name, inclusion: part.inclusion, located })
  }
  const kind =
    asks.kind && output.kind && kindLocated
      ? { kind: output.kind.kind, located: kindLocated }
      : null
  return { ok: true, kind, parts }
}

/**
 * A catalogue match is kept only if every model number it names (three or more digits) appears
 * in the quote, so neither a fuzzy match nor the model's own name can turn "GTX 970" into another
 * card. A series number ("Ryzen 7 2000 series") agrees with a quoted number of the same length
 * and first digit ("2700X"). The same guard as parts-rules'.
 */
export function numbersAgree(family: string, quote: string): boolean {
  const quoted: string[] = quote.match(/\d+/g) ?? []
  return (family.match(/\d{3,}/g) ?? []).every(
    (n) =>
      quoted.includes(n) ||
      (/^\d0+$/.test(n) && quoted.some((q) => q.length === n.length && q[0] === n[0])),
  )
}

/** Splits an array into chunks of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * The key of a `parts-ai.extracted` event: the prompt version and the listing versions it names,
 * derived from stored rows, so a replay yields the same key and a new version a new one.
 */
export function extractedKey(
  promptVersion: string,
  versions: ReadonlyArray<{ listingId: string; evidenceHash: string }>,
  batch: number,
): string {
  const pairs = versions.map((v) => `${v.listingId}@${v.evidenceHash}`).sort()
  const hash = createHash('sha256').update(pairs.join('\n')).digest('hex')
  return `parts-ai.extracted:${promptVersion}:${hash}:${batch}`
}

/** GBP micros spent plus a call's estimate would pass the cap. At exactly the cap it is allowed. */
export function passesCap(spentGbpMicros: number, estimateGbpMicros: number, capGbpMicros: number) {
  return spentGbpMicros + estimateGbpMicros > capGbpMicros
}
