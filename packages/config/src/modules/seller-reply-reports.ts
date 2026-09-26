import { z } from 'zod'

// Thresholds of the seller-reply-reports module (rule 14 of docs/design/modules/_rules.md),
// from the too-good-to-be-true design §6.7. Every value is a starting value until the module's
// shadow run calibrates it; nothing here is a price.

const sellerReplyReportsConfig = z.object({
  eventBatchSize: z.number().int().min(1).max(500),
  minMinutesAfterOpen: z.number().int().min(0).max(1440),
  maxDaysAfterOpen: z.number().int().min(1).max(90),
  minAccountAgeDays: z.number().int().min(0).max(365),
  ratePerHour: z.number().int().min(1).max(100),
  ratePerDay: z.number().int().min(1).max(500),
  burstCount: z.number().int().min(2).max(50),
  burstWindowHours: z.number().int().min(1).max(168),
  gemBurstCount: z.number().int().min(2).max(50),
  gemBurstWindowHours: z.number().int().min(1).max(168),
  editWindowHours: z.number().int().min(0).max(168),
  reportThenBuyDays: z.number().int().min(0).max(90),
  collectionElsewhereMinKm: z.number().positive().max(1000),
  singleLevelMinWeight: z.number().positive().max(10),
  multipleLevelMinWeight: z.number().positive().max(20),
  exactCountFrom: z.number().int().min(10).max(1000),
  reportedValueMinPeople: z.number().int().min(1).max(100),
  relistCarryDays: z.number().int().min(0).max(365),
  retentionDaysAfterClose: z.number().int().min(1).max(3650),
})

const config = sellerReplyReportsConfig.parse({
  /** Listing IDs per event and per handled batch. Basis: rule 7 and CLAUDE.md. Fixed by the rule. */
  eventBatchSize: 500,
  /** The open gate: at least this long after the open (time to message and read a reply). §3.1. */
  minMinutesAfterOpen: 5,
  /** The open gate: at most this long after the open (recorded listings were 16.6-33.7 h old). §3.1. */
  maxDaysAfterOpen: 14,
  /** An established account (docs/decisions.md:158; catalogue question 43). §3.2. */
  minAccountAgeDays: 30,
  /** Reports per user per hour; beyond it the report saves silently at weight 0. §3.3 (an estimate). */
  ratePerHour: 5,
  /** Reports per user per day. §3.3 (an estimate, recalibrated to honest reporters' p99). */
  ratePerDay: 15,
  /** Reports on one listing or cluster within `burstWindowHours`, any account age, that hold it. §3.3. */
  burstCount: 3,
  burstWindowHours: 24,
  /** The same on a gem candidate (a rival buyer's target). §3.3. */
  gemBurstCount: 2,
  gemBurstWindowHours: 6,
  /** A report can be edited this long after it was made; withdrawn at any time. §3.2. */
  editWindowHours: 24,
  /** A "bought" verdict this soon after a report removes its weight (outcome `unknown`). §3.3. */
  reportThenBuyDays: 7,
  /** `collection_elsewhere` counts only at this distance or more (the L4 basis). §3.1, §2.2. */
  collectionElsewhereMinKm: 50,
  /** Summed weight for `single` and `multiple` (the latter also needs 2 people). §3.2. */
  singleLevelMinWeight: 1.0,
  multipleLevelMinWeight: 2.0,
  /** Exact counts only from here (docs/decisions.md:15, aggregates at n>=10). §4.3. */
  exactCountFrom: 10,
  /** A reported place or distance is published only when this many people agree. §4.3. */
  reportedValueMinPeople: 3,
  /** Owner decision 24's carry window; carried reports are never shown in this build. §3.2. */
  relistCarryDays: 30,
  /** Owner decision 15's default; not enforced in this build (docs/questions). §6.2. */
  retentionDaysAfterClose: 90,
})

export const SELLER_REPLY_REPORTS_EVENT_BATCH_SIZE = config.eventBatchSize
export const SELLER_REPLY_REPORTS_MIN_MINUTES_AFTER_OPEN = config.minMinutesAfterOpen
export const SELLER_REPLY_REPORTS_MAX_DAYS_AFTER_OPEN = config.maxDaysAfterOpen
export const SELLER_REPLY_REPORTS_MIN_ACCOUNT_AGE_DAYS = config.minAccountAgeDays
export const SELLER_REPLY_REPORTS_RATE_PER_HOUR = config.ratePerHour
export const SELLER_REPLY_REPORTS_RATE_PER_DAY = config.ratePerDay
export const SELLER_REPLY_REPORTS_BURST_COUNT = config.burstCount
export const SELLER_REPLY_REPORTS_BURST_WINDOW_HOURS = config.burstWindowHours
export const SELLER_REPLY_REPORTS_GEM_BURST_COUNT = config.gemBurstCount
export const SELLER_REPLY_REPORTS_GEM_BURST_WINDOW_HOURS = config.gemBurstWindowHours
export const SELLER_REPLY_REPORTS_EDIT_WINDOW_HOURS = config.editWindowHours
export const SELLER_REPLY_REPORTS_REPORT_THEN_BUY_DAYS = config.reportThenBuyDays
export const SELLER_REPLY_REPORTS_COLLECTION_ELSEWHERE_MIN_KM = config.collectionElsewhereMinKm
export const SELLER_REPLY_REPORTS_SINGLE_LEVEL_MIN_WEIGHT = config.singleLevelMinWeight
export const SELLER_REPLY_REPORTS_MULTIPLE_LEVEL_MIN_WEIGHT = config.multipleLevelMinWeight
export const SELLER_REPLY_REPORTS_EXACT_COUNT_FROM = config.exactCountFrom
export const SELLER_REPLY_REPORTS_REPORTED_VALUE_MIN_PEOPLE = config.reportedValueMinPeople
export const SELLER_REPLY_REPORTS_RELIST_CARRY_DAYS = config.relistCarryDays
export const SELLER_REPLY_REPORTS_RETENTION_DAYS_AFTER_CLOSE = config.retentionDaysAfterClose
