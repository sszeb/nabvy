import { z } from 'zod'

// Thresholds of the asking-price-position module (rule 14 of docs/design/modules/_rules.md),
// validated with Zod like the env groups in ../env.ts. Each is a starting value until this
// module's fixtures calibrate it.

const askingPricePositionConfig = z.object({
  minShownN: z.number().int().min(1),
  madScale: z.number().gt(0),
  minNewContextN: z.number().int().min(1),
  ruleVersion: z.string().regex(/^p\d+$/),
  eventBatchSize: z.number().int().min(1).max(500),
})

const config = askingPricePositionConfig.parse({
  /**
   * Smallest counted n at which a position is shown to users; below it the position is recorded
   * (T4) but hidden. Basis: "aggregates appear only at n≥10" (nabvy/docs/decisions.md:15;
   * fb-scrap-engine/docs/design/SELLER_DATA.md:329). Status: the owner's rule.
   */
  minShownN: 10,
  /**
   * Scale that makes the median absolute deviation comparable to a standard deviation for normal
   * data, used in robust z = (ask − median) / (scale·MAD). Basis: the standard consistency constant
   * 1/Φ⁻¹(3/4). Status: fixed; robust z is internal only (the card: no score shown).
   */
  madScale: 1.4826,
  /**
   * Smallest n of the new-condition group whose median is kept as context ("a new build asks the
   * same", fb-scrap-engine/docs/HANDOFF.md:189-190). Basis: the same n≥10 rule as any aggregate
   * (nabvy/docs/decisions.md:15). Status: the owner's rule.
   */
  minNewContextN: 10,
  /** Version of the positioning rules; a change re-positions every listing (rule 8). */
  ruleVersion: 'p1',
  /** Listing IDs per `positioned` event. Basis: rule 7 (at most 500 identifiers per event). */
  eventBatchSize: 500,
})

export const ASKING_PRICE_POSITION_MIN_SHOWN_N = config.minShownN
export const ASKING_PRICE_POSITION_MAD_SCALE = config.madScale
export const ASKING_PRICE_POSITION_MIN_NEW_CONTEXT_N = config.minNewContextN
export const ASKING_PRICE_POSITION_RULE_VERSION = config.ruleVersion
export const ASKING_PRICE_POSITION_EVENT_BATCH_SIZE = config.eventBatchSize
