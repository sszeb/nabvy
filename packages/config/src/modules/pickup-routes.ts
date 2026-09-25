import { z } from 'zod'

// Thresholds of the pickup-routes module (rule 14 of docs/design/modules/_rules.md), validated
// with Zod like the env groups in ../env.ts. Every value is a starting value from the
// search-map-routes draft's design choices (docs/design/drafts/search-map-routes.md §5, §6) until
// the module's fixtures calibrate it. No prices here.

const pickupRoutesConfig = z.object({
  maxStops: z.number().int().min(1).max(15),
  fixedTimeBeforeMin: z.number().int().nonnegative(),
  fixedTimeAfterMin: z.number().int().nonnegative(),
  serviceMinutesDefault: z.number().int().positive(),
  serviceMinutesTesting: z.number().int().positive(),
  dayStartDefault: z.string().regex(/^\d\d:\d\d$/),
  latestFinishDefault: z.string().regex(/^\d\d:\d\d$/),
  estimateFactor: z.number().min(1),
  estimateSpeedKmh: z.number().positive(),
  proposedSlotRoundMin: z.number().int().positive(),
  proposedSlotWidthMin: z.number().int().positive(),
  eveningReminderTime: z.string().regex(/^\d\d:\d\d$/),
  unagreedReminderTime: z.string().regex(/^\d\d:\d\d$/),
  leaveByLeadMin: z.number().int().nonnegative(),
  leaveByNoPlanMin: z.number().int().nonnegative(),
  retentionDays: z.number().int().positive(),
})

const config = pickupRoutesConfig.parse({
  /**
   * Stops a day the planner accepts. Basis: search-map-routes.md §6.1 ("at most 12 stops": the
   * navigation links, the UI and the exact solver's run time); §10 row 25 keeps the in-house
   * solver while the limit stays at or under about 15. Status: starting value.
   */
  maxStops: 12,
  /** A fixed time's window: −5 minutes (§5.1, "When", an assumption). Status: starting value. */
  fixedTimeBeforeMin: 5,
  /** A fixed time's window: +10 minutes (§5.1, "When", an assumption). Status: starting value. */
  fixedTimeAfterMin: 10,
  /** Time at the stop by default (§5.1, "Time at the stop", an assumption). Status: starting. */
  serviceMinutesDefault: 10,
  /** The "testing the item" preset (§5.1, an assumption). Status: starting value. */
  serviceMinutesTesting: 30,
  /** planner_defaults day start (§7.9, a design choice). Status: starting value. */
  dayStartDefault: '09:00',
  /** planner_defaults latest finish (§7.9, a design choice). Status: starting value. */
  latestFinishDefault: '18:00',
  /**
   * Straight-line distance × this factor stands in for road distance when router-gateway is off
   * or the VM is down, labelled "estimate" (card, "Does / does not"; §6.2). Status: starting.
   */
  estimateFactor: 1.3,
  /**
   * Speed the estimate assumes to turn an estimated distance into a duration, km/h. Basis: none
   * cited in the draft; a mixed urban/A-road average, always labelled "estimate" and never shown
   * as a measured time (docs/questions/pickup-routes.md). Status: starting value.
   */
  estimateSpeedKmh: 40,
  /** A proposed slot rounds the ETA to this many minutes (§6.5). Status: starting value. */
  proposedSlotRoundMin: 10,
  /** A proposed slot is this wide (§6.5, "20-minute window"). Status: starting value. */
  proposedSlotWidthMin: 20,
  /** Evening-before reminder, the day before (§5.4, a design choice). Status: starting value. */
  eveningReminderTime: '19:00',
  /** "Not agreed yet" reminder, the day before (§5.4, a design choice). Status: starting value. */
  unagreedReminderTime: '18:00',
  /** Leave-by reminder: planned departure minus this (§5.4). Status: starting value. */
  leaveByLeadMin: 10,
  /** Leave-by reminder with no plan: this long before the agreed time (§5.4). Status: starting. */
  leaveByNoPlanMin: 60,
  /**
   * Days after its day a pickup, with its plans and day, is deleted (§5.6, §10 row 15: the
   * interim, conservative default until the owner sets the period). Status: starting value.
   */
  retentionDays: 30,
})

export const PICKUP_ROUTES_MAX_STOPS = config.maxStops
export const PICKUP_ROUTES_FIXED_TIME_BEFORE_MIN = config.fixedTimeBeforeMin
export const PICKUP_ROUTES_FIXED_TIME_AFTER_MIN = config.fixedTimeAfterMin
export const PICKUP_ROUTES_SERVICE_MINUTES_DEFAULT = config.serviceMinutesDefault
export const PICKUP_ROUTES_SERVICE_MINUTES_TESTING = config.serviceMinutesTesting
export const PICKUP_ROUTES_DAY_START_DEFAULT = config.dayStartDefault
export const PICKUP_ROUTES_LATEST_FINISH_DEFAULT = config.latestFinishDefault
export const PICKUP_ROUTES_ESTIMATE_FACTOR = config.estimateFactor
export const PICKUP_ROUTES_ESTIMATE_SPEED_KMH = config.estimateSpeedKmh
export const PICKUP_ROUTES_PROPOSED_SLOT_ROUND_MIN = config.proposedSlotRoundMin
export const PICKUP_ROUTES_PROPOSED_SLOT_WIDTH_MIN = config.proposedSlotWidthMin
export const PICKUP_ROUTES_EVENING_REMINDER_TIME = config.eveningReminderTime
export const PICKUP_ROUTES_UNAGREED_REMINDER_TIME = config.unagreedReminderTime
export const PICKUP_ROUTES_LEAVE_BY_LEAD_MIN = config.leaveByLeadMin
export const PICKUP_ROUTES_LEAVE_BY_NO_PLAN_MIN = config.leaveByNoPlanMin
export const PICKUP_ROUTES_RETENTION_DAYS = config.retentionDays
