import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'
import { DetailEvidenceHash } from './detail-evidence'
import { PartsRulesKind, PartsRulesPartType } from './parts-rules'
import { ProductCatalogueId } from './product-catalogue'

// Contracts of the parts-ai module (docs/design/modules/parts-ai.md): one model call per listing
// version, only for the gaps, conflicts and listing-kind decision the rules leave open. The model
// names facts and quotes only; every quote is checked against the stored text and every product
// is resolved through product-catalogue. Nothing here carries a price. Import from
// '@nabvy/contracts/modules/parts-ai'. The view rows are written here as Zod, as parts-rules'
// are: drizzle-zod is not a dependency yet (services/parts-ai/README.md).

export const module = 'parts-ai'

/**
 * The prompt version: `p<n>.<first 8 hex of the sha256 of the system prompt and the output
 * schema>`, so any change to either is a new version without anyone remembering to bump it. Part
 * of the idempotency key (listing, evidence hash, prompt version).
 */
export const PartsAiPromptVersion = z.string().regex(/^p\d+\.[0-9a-f]{8}$/)
export type PartsAiPromptVersion = z.infer<typeof PartsAiPromptVersion>

/** The inclusion status the model reads from the text. Only `offered` puts a part in the sale. */
export const PartsAiInclusion = z.enum(['offered', 'mention', 'not_included'])
export type PartsAiInclusion = z.infer<typeof PartsAiInclusion>

/** Where a quote was found. The model reads the title and the description only. */
export const PartsAiSource = z.enum(['title', 'description'])
export type PartsAiSource = z.infer<typeof PartsAiSource>

/** A verbatim quote from the listing text: bounded, one short span. */
const Quote = z.string().min(1).max(300)

/** No currency, no amount of money: a name is a product, never a price. */
const noMoney = (s: string) => !/[£$€]|\b(gbp|usd|eur|quid|pounds?)\b/i.test(s)

/**
 * The model's output (strict: an unknown key, such as a price, fails the whole output). `kind`
 * is answered only when the request asks for the listing kind; `parts` names only the part types
 * the request asks about. `name` is the product as the text states it (GPU and CPU only), for
 * `resolve()`; it is never stored.
 */
export const PartsAiOutput = z.strictObject({
  kind: z
    .strictObject({
      kind: PartsRulesKind,
      quote: Quote,
    })
    .nullable(),
  parts: z
    .array(
      z.strictObject({
        partType: PartsRulesPartType,
        name: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .refine(noMoney, { message: 'a name never carries a price' })
          .nullable(),
        quote: Quote,
        inclusion: PartsAiInclusion,
      }),
    )
    .max(30),
})
export type PartsAiOutput = z.infer<typeof PartsAiOutput>

/** A reviewer's correction of one AI part (`applyCorrection`, for `review-console`). */
export const PartsAiCorrection = z
  .strictObject({
    listingId: Uuid,
    evidenceHash: DetailEvidenceHash,
    promptVersion: PartsAiPromptVersion,
    seq: z.int().min(0),
    inclusion: PartsAiInclusion.optional(),
    rejected: z.boolean().optional(),
    by: Uuid,
    reason: z.string().min(1).max(500),
  })
  .refine((c) => c.inclusion !== undefined || c.rejected !== undefined, {
    message: 'a correction sets inclusion or rejected',
  })
export type PartsAiCorrection = z.infer<typeof PartsAiCorrection>

/** A stored correction, as `v_ai_parts` shows it. */
export const PartsAiStoredCorrection = z.strictObject({
  inclusion: PartsAiInclusion.optional(),
  rejected: z.boolean().optional(),
  by: Uuid,
  reason: z.string(),
  at: IsoTimestamp,
})
export type PartsAiStoredCorrection = z.infer<typeof PartsAiStoredCorrection>

/** One row of `parts_ai.v_ai_parts`: one part the model named, checked and resolved. */
export const PartsAiPart = z.strictObject({
  listingId: Uuid,
  evidenceHash: DetailEvidenceHash,
  promptVersion: PartsAiPromptVersion,
  seq: z.int().min(0),
  partType: PartsRulesPartType,
  /** Null when the catalogue named no single item, or the part type has no catalogue. */
  catalogueId: ProductCatalogueId.nullable(),
  /** The catalogue's family when it named a family but no single item. */
  family: z.string().nullable(),
  inclusion: PartsAiInclusion,
  source: PartsAiSource,
  /** The stored text, verbatim, between `start` and `end`. */
  quote: z.string().min(1),
  /** UTF-16 offsets into the stored title or description. */
  start: z.int().min(0),
  end: z.int().min(1),
  correction: PartsAiStoredCorrection.nullable(),
})
export type PartsAiPart = z.infer<typeof PartsAiPart>

/** How a call ended: its output stored, or quarantined (never retried). */
export const PartsAiRunStatus = z.enum(['extracted', 'quarantined'])
export type PartsAiRunStatus = z.infer<typeof PartsAiRunStatus>

/** One row of `parts_ai.v_runs`: one model call over one listing version. */
export const PartsAiRun = z.strictObject({
  listingId: Uuid,
  evidenceHash: DetailEvidenceHash,
  promptVersion: PartsAiPromptVersion,
  status: PartsAiRunStatus,
  /** The listing kind the model read, when it was asked and answered. */
  kind: PartsRulesKind.nullable(),
  kindSource: PartsAiSource.nullable(),
  kindQuote: z.string().nullable(),
  kindStart: z.int().min(0).nullable(),
  kindEnd: z.int().min(1).nullable(),
  doneAt: IsoTimestamp,
})
export type PartsAiRun = z.infer<typeof PartsAiRun>

/** Why a call's output was not used. Quarantined outputs are never retried at that version. */
export const PartsAiProblem = z.enum(['invalid_output', 'quote_not_found'])
export type PartsAiProblem = z.infer<typeof PartsAiProblem>

/** One row of `parts_ai.v_quarantine`. `detail` never holds model text (bounded, ours). */
export const PartsAiQuarantined = z.strictObject({
  listingId: Uuid,
  evidenceHash: DetailEvidenceHash,
  promptVersion: PartsAiPromptVersion,
  problem: PartsAiProblem,
  detail: z.string().max(500),
  at: IsoTimestamp,
})
export type PartsAiQuarantined = z.infer<typeof PartsAiQuarantined>

/** Listings whose current version has an extracted AI result (a new call, or one stored). */
export const PartsAiExtractedEvent = z.strictObject({
  listingIds: z.array(Uuid).min(1).max(500),
})
export type PartsAiExtractedEvent = z.infer<typeof PartsAiExtractedEvent>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  'parts-ai.extracted': { 1: PartsAiExtractedEvent },
})

/** Error codes the module returns as values. */
export const PartsAiErrorCode = z.enum([
  'parts-ai.too_many_listings', // a batch over 500 listing IDs
  'parts-ai.part_not_found', //    a correction names no stored AI part
])
export type PartsAiErrorCode = z.infer<typeof PartsAiErrorCode>
