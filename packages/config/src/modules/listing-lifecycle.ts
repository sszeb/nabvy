import { z } from 'zod'

// Thresholds of the listing-lifecycle module (rule 14 of docs/design/modules/_rules.md), validated
// with Zod like the env groups in ../env.ts. Every value is a starting value until recorded runs
// with repeated sweeps calibrate it. The actor's figures come from about two days of mostly "3090"
// and "gaming pc" searches around Chichester (PARTS_INTELLIGENCE.md:281-282).

const hours = z
  .number()
  .int()
  .min(0)
  .max(24 * 30)

const listingLifecycleConfig = z.object({
  notSeenMinMissedSweeps: z.number().int().min(2).max(20),
  notSeenMinHours: hours,
  recheckStepsHours: z.array(hours).min(1).max(5),
  watchedBatchMin: z.number().int().min(1).max(500),
  watchedMaxWaitHours: hours,
  batchSize: z.number().int().min(1).max(500),
})

const config = listingLifecycleConfig.parse({
  /**
   * Later sweeps of the listing's last search (same term, same centre) that must miss it before it
   * is "not seen recently". Basis: two full-depth repeats of one search overlap only 87–95%
   * (fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:278-280), so one miss is expected in 5–13%
   * of sweeps and never makes a listing gone (the card). The minimum the schema allows is 2.
   * Starting value.
   */
  notSeenMinMissedSweeps: 2,
  /**
   * Hours since the listing was last observed before it can be "not seen recently", so two sweeps
   * run close together cannot flip it. Basis: the build pack's +24 h recheck
   * (docs/modules.md:31). Starting value.
   */
  notSeenMinHours: 24,
  /**
   * Recheck schedule, hours after the request, for alerted and candidate listings. Basis:
   * docs/modules.md:31 (+6 h, +24 h, +72 h), "starting values" per the card. Starting value.
   */
  recheckStepsHours: [6, 24, 72],
  /**
   * Watched listings are refreshed in daily batches of at least this many. Basis: about $0.028 per
   * watched listing per month in daily batches of 20 or more; single-listing runs cost more
   * (fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:190-191). Starting value.
   */
  watchedBatchMin: 20,
  /**
   * Hours a due watched recheck waits for its batch to fill before it is sent anyway, so a lone
   * watched listing is still refreshed. Basis: one day, the batch's own cadence. Starting value
   * (docs/questions/listing-lifecycle.md).
   */
  watchedMaxWaitHours: 24,
  /**
   * Listings per status pass, recheck submission and event. Basis: rule 7 (at most 500 listing IDs
   * per event) and CLAUDE.md, "Batches, not items". Fixed by the rule.
   */
  batchSize: 500,
})

export const LISTING_LIFECYCLE_NOT_SEEN_MIN_MISSED_SWEEPS = config.notSeenMinMissedSweeps
export const LISTING_LIFECYCLE_NOT_SEEN_MIN_HOURS = config.notSeenMinHours
export const LISTING_LIFECYCLE_RECHECK_STEPS_HOURS: readonly number[] = config.recheckStepsHours
export const LISTING_LIFECYCLE_WATCHED_BATCH_MIN = config.watchedBatchMin
export const LISTING_LIFECYCLE_WATCHED_MAX_WAIT_HOURS = config.watchedMaxWaitHours
export const LISTING_LIFECYCLE_BATCH_SIZE = config.batchSize
