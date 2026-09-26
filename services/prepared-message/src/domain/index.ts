// Pure logic: no I/O, no database, no clock. Turns the unknowns and confirmed parts of one
// listing version into the message and checklist, with every quote passed through quote-redaction's `redact()`.

import type { PartsRecordPartType } from '@nabvy/contracts/modules/parts-record'
import type {
  PreparedMessage,
  PreparedMessageChecklistItem,
  PreparedMessageTemplate,
} from '@nabvy/contracts/modules/prepared-message'
import { PreparedMessage as PreparedMessageSchema } from '@nabvy/contracts/modules/prepared-message'
import { redact } from '@nabvy/quote-redaction'

export { PACK_ID, TEMPLATES } from './template'

/** What the repo reads for the latest assessed version of one listing. */
export interface MessageInput {
  listingId: string
  evidenceHash: string
  /** The parts `v_unknowns` lists for this version, in any order. */
  unknowns: PartsRecordPartType[]
  /** Confirmed parts, in the record's order, each with its quote from `showQuote`; null when
   * it may not be shown (quote-redaction not on, or too long). */
  confirmed: { partType: PartsRecordPartType; quote: string | null }[]
  /** Whether quote-redaction was on, so quotes could be shown at all. */
  quotesShown: boolean
}

const ORDER: PartsRecordPartType[] = [
  'gpu',
  'cpu',
  'ram_size',
  'ram_generation',
  'storage_size',
  'storage_type',
  'psu_wattage',
  'chipset',
]
const byOrder = (a: PartsRecordPartType, b: PartsRecordPartType) =>
  ORDER.indexOf(a) - ORDER.indexOf(b)

/**
 * The message and checklist, or null when there is nothing to ask: no unknown the template has a
 * question for. The asks come first (in a fixed part order), then one check per core part the
 * template asks about and the listing states, with the first shown quote of that part.
 */
export function compose(
  input: MessageInput,
  template: PreparedMessageTemplate,
): PreparedMessage | null {
  const asks = [...new Set(input.unknowns)].sort(byOrder).flatMap((partType) => {
    const text = template.questions[partType]
    return text ? [{ kind: 'ask' as const, partType, text }] : []
  })
  if (asks.length === 0) return null

  const asked = new Set(asks.map((a) => a.partType))
  const checks: PreparedMessageChecklistItem[] = []
  const checked = new Set<PartsRecordPartType>()
  for (const part of input.confirmed) {
    if (part.quote === null || asked.has(part.partType) || checked.has(part.partType)) continue
    if (template.questions[part.partType] === undefined) continue
    checked.add(part.partType)
    checks.push({
      kind: 'check',
      partType: part.partType,
      text: template.check.replace('{quote}', () => part.quote ?? ''),
    })
  }
  checks.sort((a, b) => byOrder(a.partType, b.partType))

  const text = template.message.replace('{questions}', () =>
    asks.map((a) => `- ${a.text}`).join('\n'),
  )
  return PreparedMessageSchema.parse({
    listingId: input.listingId,
    evidenceHash: input.evidenceHash,
    templateVersion: template.version,
    text,
    checklist: [...asks, ...checks],
    quotesShown: input.quotesShown,
  })
}

/**
 * A listing quote fit to show, or null. Whitespace is collapsed first and the result redacted
 * after (collapsing after redaction could join a split phone number the redactor never saw); a
 * quote longer than `max` once redacted is left out, never cut.
 */
export function showQuote(raw: string, max: number): string | null {
  const quote = redact(raw.replace(/\s+/g, ' ').trim()).text
  return quote.length > 0 && quote.length <= max ? quote : null
}
