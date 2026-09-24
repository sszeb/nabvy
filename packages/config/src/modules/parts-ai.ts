import { z } from 'zod'

// Thresholds of the parts-ai module (rule 14 of docs/design/modules/_rules.md), validated with
// Zod like the env groups in ../env.ts. The spend rate (USD_GBP_RATE) is the caller's, from the
// `exchangeRate` env group, as in scan-recognition.

const partsAiConfig = z.object({
  eventBatchSize: z.int().min(1).max(500),
  maxCallsPerBatch: z.int().min(1).max(500),
  dailySpendCapGbpMicros: z.int().positive(),
  maxInputTokens: z.int().positive(),
  maxOutputTokens: z.int().positive(),
  maxDescriptionChars: z.int().min(500).max(20000),
  allowedThrottleLevels: z.array(z.enum(['none', 'slow-free', 'slow-paid', 'slow-sweeps'])),
})

const config = partsAiConfig.parse({
  /**
   * Listing IDs per handled batch and per `parts-ai.extracted` event. Basis: rule 7 (at most 500
   * listing IDs per event) and CLAUDE.md, "Batches, not items". Status: fixed by the rule.
   */
  eventBatchSize: 500,
  /**
   * Model calls one batch may make; the rest wait for the sweep. Basis: one transaction holds the
   * batch lock across its calls, so a batch is kept to minutes. Status: starting value.
   */
  maxCallsPerBatch: 100,
  /**
   * Model spend in any rolling 24 hours, in GBP micros (£5). Basis: about $0.001–0.003 a listing
   * (fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:70) at about 1,000 new listings a day is
   * under £3; the cap leaves room without letting a loop spend freely. Status: starting value
   * (docs/questions/parts-ai.md).
   */
  dailySpendCapGbpMicros: 5_000_000,
  /**
   * Upper bound on one call's input tokens, used to price a call before it is made (the cap
   * check). Basis: the system prompt (about 400 tokens) plus a description capped at
   * `maxDescriptionChars` (about 4 characters a token) and a title, rounded up. Status: starting
   * value, to be checked against metered calls.
   */
  maxInputTokens: 2500,
  /**
   * The call's `max_tokens`, so the output side of the estimate is a hard bound. Basis: 30 parts
   * of a short name and a quote fit well inside it. Status: starting value.
   */
  maxOutputTokens: 1200,
  /**
   * Description characters sent to the model; the rest is not sent. Basis: the recorded run's
   * longest description is under 2,000 characters (fixtures/listings/facebook/runs/
   * 2026-09-24-VkryjpwS6U2GBDh3k/dataset.json). Status: starting value.
   */
  maxDescriptionChars: 6000,
  /**
   * The spend-governor levels at which calls are made. Basis: rule 13 (read the throttle before
   * spending); `slow-paid` and above hold paid work that is not already queued, the conservative
   * reading for a model call. Status: starting value (docs/questions/parts-ai.md).
   */
  allowedThrottleLevels: ['none', 'slow-free'],
})

export const PARTS_AI_EVENT_BATCH_SIZE = config.eventBatchSize
export const PARTS_AI_MAX_CALLS_PER_BATCH = config.maxCallsPerBatch
export const PARTS_AI_DAILY_SPEND_CAP_GBP_MICROS = config.dailySpendCapGbpMicros
export const PARTS_AI_MAX_INPUT_TOKENS = config.maxInputTokens
export const PARTS_AI_MAX_OUTPUT_TOKENS = config.maxOutputTokens
export const PARTS_AI_MAX_DESCRIPTION_CHARS = config.maxDescriptionChars
export const PARTS_AI_ALLOWED_THROTTLE_LEVELS: readonly string[] = config.allowedThrottleLevels
