import { z } from 'zod'

// Thresholds of the source-health module (rule 14 of docs/design/modules/_rules.md), validated
// with Zod like route-health's own config file. docs/design/modules/source-health.md is the card.

const rampStage = z.object({
  maxChecksPerDay: z.int().positive(),
  minHoursAtStage: z.number().positive(),
})

const sourceHealthConfig = z.object({
  alertPctDegraded: z.number().min(0).max(1),
  pageSize: z.int().positive(),
  rampStages: z.array(rampStage).min(1),
})

const config = sourceHealthConfig.parse({
  /**
   * Starting alert value: more than this share of a day's searches degraded (browser-fallback or
   * failed). Basis: 9 of 10 search bootstraps succeeded on build 1.0.79
   * (`fb-scrap-engine/docs/EVIDENCE_LEDGER.md:84-91`; the card). Starting value.
   */
  alertPctDegraded: 0.1,
  /**
   * Rows per search page, for grouping apify-gateway's `v_seller_presence` rows (which carry no
   * page field) into pages by row order (`fb-scrap-engine/docs/design/SELLER_DATA.md:38-41`; the
   * card). Basis: the recorded run's one page held 20 listings (`run-coverage`'s card, "Page 1").
   * Starting value (`docs/questions/source-health.md`).
   */
  pageSize: 20,
  /**
   * Ramp stages, each a volume cap and the minimum hours to hold it before advancing (card:
   * "volume rises in steps of 24-48 hours, and only while 302s and fallbacks do not rise"). The
   * conservative end of that range (48h) is taken per CLAUDE.md's "Ask, don't guess": a slower
   * ramp is the safer default against a block (`docs/questions/source-health.md`). The caps
   * themselves are starting values pending calibration (rule 14): the cited sources give no
   * volume figures.
   */
  rampStages: [
    { maxChecksPerDay: 50, minHoursAtStage: 48 },
    { maxChecksPerDay: 100, minHoursAtStage: 48 },
    { maxChecksPerDay: 200, minHoursAtStage: 48 },
    { maxChecksPerDay: 400, minHoursAtStage: 48 },
    { maxChecksPerDay: 800, minHoursAtStage: 48 },
  ],
})

export const SOURCE_HEALTH_ALERT_PCT_DEGRADED = config.alertPctDegraded
export const SOURCE_HEALTH_PAGE_SIZE = config.pageSize
export const SOURCE_HEALTH_RAMP_STAGES = config.rampStages
export type SourceHealthRampStageConfig = (typeof config.rampStages)[number]
