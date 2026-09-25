import { z } from 'zod'

// Thresholds of the parts-rules module (rule 14 of docs/design/modules/_rules.md), validated
// with Zod like the env groups in ../env.ts.

const partsRulesConfig = z.object({
  eventBatchSize: z.number().int().min(1).max(500),
  contextChars: z.number().int().min(10).max(400),
  wantedDescriptionChars: z.number().int().min(50).max(2000),
  tagBlockMinHashtags: z.number().int().min(2).max(20),
  tagBlockMinModels: z.number().int().min(2).max(20),
})

const config = partsRulesConfig.parse({
  /**
   * Listing IDs per `parts-rules.ran` event and per handled batch. Basis: rule 7 (at most 500
   * listing IDs per event) and CLAUDE.md, "Batches, not items". Status: fixed by the rule.
   */
  eventBatchSize: 500,
  /**
   * Characters read on each side of a quote for its inclusion candidate. Basis: "a clean check
   * of about 80 characters around the quote" (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:
   * 177-180). Status: starting value.
   */
  contextChars: 80,
  /**
   * Leading description characters the wanted-advert pattern reads. Basis: the pattern's name,
   * `wantedDescriptionFirst400Chars` (fb-scrap-engine/docs/data/part-patterns.json:5). Status:
   * fixed by the source.
   */
  wantedDescriptionChars: 400,
  /**
   * Hashtags in a row (separated only by spaces, commas or line breaks) that make a tag block.
   * Basis: "10 descriptions carry keyword stuffing"; parse spec lines, not tag blocks
   * (fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:242-243). Three keeps one or two inline
   * hashtags readable. Status: starting value, no recorded run has a tag block yet.
   */
  tagBlockMinHashtags: 3,
  /**
   * Different GPU models named in one line that make it a model list (keyword stuffing such as
   * "3060 3070 3080 3090 4070 4080"), read as a tag block. Basis: as above; a spec line names one
   * GPU, and a "was/now" upgrade note two or three. Status: starting value.
   */
  tagBlockMinModels: 4,
})

export const PARTS_RULES_EVENT_BATCH_SIZE = config.eventBatchSize
export const PARTS_RULES_CONTEXT_CHARS = config.contextChars
export const PARTS_RULES_WANTED_DESCRIPTION_CHARS = config.wantedDescriptionChars
export const PARTS_RULES_TAG_BLOCK_MIN_HASHTAGS = config.tagBlockMinHashtags
export const PARTS_RULES_TAG_BLOCK_MIN_MODELS = config.tagBlockMinModels
