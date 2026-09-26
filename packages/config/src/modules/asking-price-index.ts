import { z } from 'zod'

// Thresholds of the asking-price-index module (rule 14 of docs/design/modules/_rules.md), validated
// with Zod like the env groups in ../env.ts. Every value is a starting value until the split-half
// stability backtest calibrates it (fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:386-388).

const askingPriceIndexConfig = z.object({
  windowDays: z.number().int().min(1).max(90),
  iqrFence: z.number().min(0.5).max(5),
  minBandN: z.number().int().min(1),
  thinShare: z.number().gt(0).max(1),
  onePerSellerKey: z.boolean(),
  stabilityMaxDrift: z.number().gt(0).max(1),
  eventBatchSize: z.number().int().min(1).max(500),
})

const config = askingPriceIndexConfig.parse({
  /**
   * Days an ask stays in its group after it was last seen: the group key's "× 30 days".
   * Basis: fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:262-263. Status: the brief's value.
   */
  windowDays: 30,
  /**
   * Multiplier k of the outlier fences Q1 − k·IQR and Q3 + k·IQR. Basis: Tukey's conventional
   * fence; the brief names IQR fences but no multiplier (PARTS_INTELLIGENCE.md:264-265). Status:
   * starting value, to calibrate on the split-half stability backtest (PARTS_INTELLIGENCE.md:386-388).
   */
  iqrFence: 1.5,
  /**
   * Smallest counted n at which a group's band may be shown to users. Basis: "aggregates appear
   * only at n≥10" (nabvy/docs/decisions.md:15; the card's user-facing view). Status: the owner's rule.
   */
  minBandN: 10,
  /**
   * Share of a group's counted asks one seller key may supply before the group is marked "thin".
   * Basis: fb-scrap-engine/docs/design/SELLER_DATA.md:163-165 names the mark but "the share is not
   * measured yet"; a third is a conservative start (docs/questions/asking-price-index.md). Status:
   * starting value; inert until seller-key is built.
   */
  thinShare: 1 / 3,
  /**
   * Keep only one ask per seller key in a group (the lowest-sorted listing). Basis: the brief's
   * "optionally one ask per seller key" (SELLER_DATA.md:163-165). Status: on; inert until seller-key
   * is built, since no keys are read before then.
   */
  onePerSellerKey: true,
  /**
   * Largest relative median drift between the two halves of a group with n≥10 for the stability
   * check to pass: |median(A) − median(B)| / median(all). Basis: this module, for the split-half
   * backtest (PARTS_INTELLIGENCE.md:386-388), which states no tolerance. Status: starting value.
   */
  stabilityMaxDrift: 0.25,
  /** Group keys per `updated` event. Basis: rule 7 (at most 500 identifiers per event). */
  eventBatchSize: 500,
})

export const ASKING_PRICE_INDEX_WINDOW_DAYS = config.windowDays
export const ASKING_PRICE_INDEX_IQR_FENCE = config.iqrFence
export const ASKING_PRICE_INDEX_MIN_BAND_N = config.minBandN
export const ASKING_PRICE_INDEX_THIN_SHARE = config.thinShare
export const ASKING_PRICE_INDEX_ONE_PER_SELLER_KEY = config.onePerSellerKey
export const ASKING_PRICE_INDEX_STABILITY_MAX_DRIFT = config.stabilityMaxDrift
export const ASKING_PRICE_INDEX_EVENT_BATCH_SIZE = config.eventBatchSize
