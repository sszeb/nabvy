import { z } from 'zod'

// Thresholds of the prepared-message module (rule 14 of docs/design/modules/_rules.md). Each value
// carries its basis and is a starting value until more recorded runs calibrate it. The template
// wording is not here: it is the pack's (services/prepared-message/src/domain/template.ts).

const preparedMessageConfig = z.object({
  batchSize: z.int().min(1).max(500),
  maxQuoteChars: z.int().min(10).max(200),
})

const config = preparedMessageConfig.parse({
  /** Listing IDs per `buildMany` call. Basis: rule 9 (100-500 per batch). Status: fixed by the rule. */
  batchSize: 500,
  /**
   * The longest listing quote a checklist item shows, measured after redaction; a longer quote is
   * left out, never cut, so a cut can never split a contact detail the redactor would have
   * masked. Basis: quote-redaction's "quotes therefore stay short" (its README, Decisions); the
   * confirmed-part quotes of the recorded run (listing-assessment's fixture `gpu-not-stated`) are
   * under 30 characters. Status: starting value.
   */
  maxQuoteChars: 120,
})

export const PREPARED_MESSAGE_BATCH_SIZE = config.batchSize
export const PREPARED_MESSAGE_MAX_QUOTE_CHARS = config.maxQuoteChars
