import { z } from 'zod'
import { defineEvents, Uuid } from '../index'
import { DetailEvidenceHash } from './detail-evidence'
import { PartsRecordPartType } from './parts-record'

// Contracts of the prepared-message module (docs/design/modules/prepared-message.md): the
// copyable "ask the seller" message and checklist a user may send about what a listing leaves
// unknown. Import from '@nabvy/contracts/modules/prepared-message'. Nabvy never sends it: the
// user copies the text. Nothing here names a seller or a recipient.

export const module = 'prepared-message'

const placeholders = (template: string): string[] => template.match(/\{[a-zA-Z]+\}/g) ?? []
const wellFormed = (template: string) => !/[{}]/.test(template.replace(/\{[a-zA-Z]+\}/g, ''))
const only =
  (...names: string[]) =>
  (template: string) =>
    placeholders(template).every((p) => names.includes(p))

const Wording = (max: number) =>
  z.string().min(1).max(max).refine(wellFormed, { message: 'placeholders must look like {name}' })

/**
 * The pack's message template. The wording shown to users is the owner's
 * (docs/questions/prepared-message.md); `message` holds `{questions}` once, where the questions
 * go, one per line; `check` holds `{quote}`, a redacted quote the listing states.
 */
export const PreparedMessageTemplate = z.strictObject({
  packId: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  version: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,31}$/),
  message: Wording(1000)
    .refine((t) => placeholders(t).filter((p) => p === '{questions}').length === 1, {
      message: 'must hold {questions} exactly once',
    })
    .refine(only('{questions}'), { message: 'only {questions} is allowed' }),
  questions: z.partialRecord(PartsRecordPartType, Wording(200).refine(only(), 'no placeholders')),
  check: Wording(200)
    .refine((t) => placeholders(t).includes('{quote}'), { message: 'must hold {quote}' })
    .refine(only('{quote}'), { message: 'only {quote} is allowed' }),
})
export type PreparedMessageTemplate = z.infer<typeof PreparedMessageTemplate>

/** `ask`: a question in the message; `check`: something the listing states, to check in person. */
export const PreparedMessageItemKind = z.enum(['ask', 'check'])
export type PreparedMessageItemKind = z.infer<typeof PreparedMessageItemKind>

export const PreparedMessageChecklistItem = z.strictObject({
  kind: PreparedMessageItemKind,
  partType: PartsRecordPartType,
  text: z.string().min(1).max(400),
})
export type PreparedMessageChecklistItem = z.infer<typeof PreparedMessageChecklistItem>

/**
 * The output of `build`: the message to copy and its checklist, for the latest assessed version
 * of one listing. `quotesShown` is false while quote-redaction is not on: the checklist then holds
 * no quote (fail closed, rule 11).
 */
export const PreparedMessage = z.strictObject({
  listingId: Uuid,
  evidenceHash: DetailEvidenceHash,
  templateVersion: PreparedMessageTemplate.shape.version,
  text: z.string().min(1).max(2000),
  checklist: z.array(PreparedMessageChecklistItem).min(1).max(16),
  quotesShown: z.boolean(),
})
export type PreparedMessage = z.infer<typeof PreparedMessage>

/** Input of `buildMany`: at most 500 listing IDs (rule 9). */
export const PreparedMessageBuildInput = z.strictObject({
  listingIds: z.array(Uuid).min(1).max(500),
})
export type PreparedMessageBuildInput = z.infer<typeof PreparedMessageBuildInput>

/** Events this module publishes: none. It builds on request and writes nothing. */
export const events = defineEvents(module, {})
