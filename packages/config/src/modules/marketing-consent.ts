import { z } from 'zod'

// Thresholds of the marketing-consent module (rule 14 of docs/design/modules/_rules.md).

const marketingConsentConfig = z.object({
  pauseAllDurationMs: z.number().int().positive(),
})

const config = marketingConsentConfig.parse({
  /**
   * "Pause all marketing for 30 days" (docs/marketing.md, "Preference centre"). Status: fixed by
   * the card's own wording, not a starting value to calibrate.
   */
  pauseAllDurationMs: 30 * 24 * 60 * 60 * 1000,
})

export const MARKETING_CONSENT_PAUSE_ALL_DURATION_MS = config.pauseAllDurationMs
