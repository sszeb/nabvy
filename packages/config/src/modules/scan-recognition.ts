import { z } from 'zod'

// Thresholds of the scan-recognition module (rule 14 of docs/design/modules/_rules.md). The
// per-user spend cap itself is SCAN_SPEND_CAP_MINOR, in the `spendCaps` env group
// (packages/config/src/env.ts; docs/secrets.md), which the caller loads and passes in.

const scanRecognitionConfig = z.object({
  confirmationThreshold: z.number().min(0).max(1),
  capWindowHours: z.int().positive(),
  photoRetentionDays: z.int().positive(),
  visionMaxInputTokens: z.int().positive(),
  visionMaxOutputTokens: z.int().positive(),
})

const config = scanRecognitionConfig.parse({
  /**
   * Below this confidence the app shows the top candidate and asks the user to confirm or pick.
   * Basis: docs/scan-mode.md, "Identify" ("Confidence below 0.8"). Status: fixed by the spec.
   */
  confirmationThreshold: 0.8,
  /**
   * The window SCAN_SPEND_CAP_MINOR applies to, per user, rolling. Basis: none measured; the card
   * says "capped per user" without a period (docs/questions/scan-recognition.md). Status: starting
   * value, the conservative reading (a daily cap, not a per-scan budget).
   */
  capWindowHours: 24,
  /**
   * Scan photos expire after this many days (docs/security.md, "Snapshots and scan photos expire
   * after 30 days"; docs/scan-mode.md, "Guardrails"). Status: fixed by the spec.
   */
  photoRetentionDays: 30,
  /**
   * Upper bound on a vision call's input tokens, used to refuse a scan before the call when the
   * call could pass the cap. Basis: Anthropic's image estimate (width × height / 750, about 1,600
   * tokens for a photo downscaled to 1.15 megapixels) plus the system prompt and schema, rounded
   * up. The model client must downscale photos to 1.15 megapixels. Status: starting value, to be
   * checked against metered calls.
   */
  visionMaxInputTokens: 2500,
  /**
   * The model call's `max_tokens`, so the output side of the estimate is a hard bound. Basis:
   * the recognition output (seven short facts, three candidates, five phrases) fits well inside
   * it. Status: starting value.
   */
  visionMaxOutputTokens: 600,
})

export const SCAN_RECOGNITION_CONFIRMATION_THRESHOLD = config.confirmationThreshold
export const SCAN_RECOGNITION_CAP_WINDOW_HOURS = config.capWindowHours
export const SCAN_RECOGNITION_PHOTO_RETENTION_DAYS = config.photoRetentionDays
export const SCAN_RECOGNITION_VISION_MAX_INPUT_TOKENS = config.visionMaxInputTokens
export const SCAN_RECOGNITION_VISION_MAX_OUTPUT_TOKENS = config.visionMaxOutputTokens
