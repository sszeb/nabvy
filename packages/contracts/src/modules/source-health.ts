import { z } from 'zod'
import { defineEvents, IsoTimestamp } from '../index'

// Contracts of the source-health module (docs/design/modules/source-health.md): watches what
// Facebook serves and sets how much volume is safe. Import from
// '@nabvy/contracts/modules/source-health'.

export const module = 'source-health'

/** A calendar day in Europe/London, the timezone every day boundary in this module uses. */
export const SourceHealthCalendarDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** Why a day alerted (card: "Starting alert value" and "Tests and fixtures"). */
export const SourceHealthAlertReason = z.enum([
  // more than SOURCE_HEALTH_ALERT_PCT_DEGRADED of the day's searches were browser-fallback or failed
  'degraded-spike',
  // route-health reported a Facebook operation (query) ID this module has not recorded before today
  'new-operation-id',
])
export type SourceHealthAlertReason = z.infer<typeof SourceHealthAlertReason>

/**
 * One row of `source_health.v_health`: the day's tally (card, "Does / does not": "tracks per
 * day: searches on browser-fallback or failed, breaker trips, new Facebook operation IDs ...,
 * and whether seller blocks were present on each search page"). `blockedPages` is ordered:
 * one entry per page of apify-gateway rows processed that day, in the order they were collected
 * (apify-gateway's `v_seller_presence` rows carry no page field, so pages come from row order,
 * `fb-scrap-engine/docs/design/SELLER_DATA.md:38-41`; see README.md, "Decisions"). `alerted`
 * lists the reasons already fired today, so a reason fires its event at most once per day.
 */
export const SourceHealthDay = z.strictObject({
  day: SourceHealthCalendarDay,
  totalSearches: z.int().nonnegative(),
  degradedSearches: z.int().nonnegative(),
  pctDegraded: z.number().min(0).max(1),
  breakerTrips: z.int().nonnegative(),
  newOperationIds: z.array(z.string()),
  blockedPages: z.array(z.boolean()),
  alerted: z.array(SourceHealthAlertReason),
  updatedAt: IsoTimestamp,
})
export type SourceHealthDay = z.infer<typeof SourceHealthDay>

/**
 * One row of `source_health.v_ramp_stage`: the current ramp stage (card: "Holds the ramp stage:
 * volume rises in steps of 24-48 hours, and only while 302s and fallbacks do not rise").
 * `advancedBy` names what evidence advanced it (the day whose read allowed the rise), null for
 * the seeded first stage.
 */
export const SourceHealthRampStage = z.strictObject({
  stage: z.int().nonnegative(),
  maxChecksPerDay: z.int().positive(),
  startedAt: IsoTimestamp,
  advancedBy: SourceHealthCalendarDay.nullable(),
})
export type SourceHealthRampStage = z.infer<typeof SourceHealthRampStage>

/**
 * A day crossed an alert threshold. Thin (rule 7 of `docs/design/modules/_rules.md`): the
 * receiver reads `v_health` for `day` rather than being handed the metrics themselves.
 */
export const SourceHealthAlertedEvent = z.strictObject({
  day: SourceHealthCalendarDay,
  reasons: z.array(SourceHealthAlertReason).min(1),
})
export type SourceHealthAlertedEvent = z.infer<typeof SourceHealthAlertedEvent>

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  'source-health.alerted': { 1: SourceHealthAlertedEvent },
})

/** Error codes the module returns as values (docs/engineering.md, "Errors"). */
export const SourceHealthErrorCode = z.enum([
  // the collected job named in apify-gateway.run-collected has no v_jobs row yet
  'source-health.job_not_found',
])
export type SourceHealthErrorCode = z.infer<typeof SourceHealthErrorCode>
