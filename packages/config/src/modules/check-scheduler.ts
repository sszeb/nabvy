import { z } from 'zod'

// Thresholds of the check-scheduler module (rule 14 of docs/design/modules/_rules.md), validated
// with Zod like search-planner's. Every cadence and cap is the conservative option (fewer, cheaper
// runs) where actor test T2 or the owner leaves it open (docs/questions/check-scheduler.md).

const searchShape = z.object({
  sort: z.enum(['newest', 'default']),
  pages: z.int().min(1).max(60),
  maxRunSeconds: z.int().min(30).max(1740),
  memoryMb: z.union([z.literal(512), z.literal(1024), z.literal(2048)]),
})

const checkSchedulerConfig = z
  .object({
    tickSeconds: z.int().min(60).max(3600),
    newestCadenceS: z.int().positive(),
    sweepCadenceS: z.int().positive(),
    activeHours: z.object({ from: z.int().min(0).max(23), to: z.int().min(1).max(24) }),
    slowFactor: z.int().min(2),
    maxTermsPerRun: z.int().min(1).max(20),
    listingsPerPage: z.int().positive(),
    maxListings: z.int().positive(),
    maxRequests: z.int().min(1).max(1000),
    timeoutMarginS: z.int().min(60),
    newest: searchShape,
    sweep: searchShape,
    verification: searchShape,
    yieldWindowDays: z.int().positive(),
  })
  .refine((c) => c.activeHours.from < c.activeHours.to, 'active hours must not wrap midnight')

const config = checkSchedulerConfig.parse({
  /**
   * The tick slot: one tick per slot, and a retried tick in the same slot submits nothing.
   * Basis: the Trigger.dev task runs every 5 minutes; the fastest cadence below is hourly, so a
   * 5-minute slot delays a due check by at most 5 minutes. Status: starting value.
   */
  tickSeconds: 300,
  /**
   * Newest-first page 1, per region: hourly. Basis: actor test T2, "newest-first is hourly in
   * active hours" (`docs/design/actor-app-guide.md` item 16; `docs/decisions.md` "Cadence and
   * tiers"): 86-91% of new local broad-term listings for about $2 a month per two-term centre.
   * The card's 30-60 minutes is the brief's starting range; T2 has reported, and hourly is its
   * slow end. Status: starting value (question 1).
   */
  newestCadenceS: 3600,
  /**
   * Full sweep per term class and region: daily. Basis: the owner's decision reported with T2
   * (guide item 16, "§9"); every 4-6 hours only if nationwide demand appears. Status: fixed.
   */
  sweepCadenceS: 86_400,
  /**
   * Active hours for newest-first checks, Europe/London, [from, to). Basis: the card's
   * "frequent, daytime" and T2's "in active hours"; no source fixes the hours, so the narrower
   * 08:00-22:00 is taken. Sweeps run at any hour. Status: starting value (question 2).
   */
  activeHours: { from: 8, to: 22 },
  /**
   * How much a throttle level slows the cadences it names (spend-governor's order: slow-free,
   * slow-paid, slow-sweeps, hold-new). Basis: none cited; doubling halves the spend of the pairs
   * it touches. Status: starting value (question 3).
   */
  slowFactor: 2,
  /** Terms in one run. Basis: the actor's schema allows 20 (source-adapters, MAX_TERMS). Fixed. */
  maxTermsPerRun: 20,
  /**
   * Listings per page for sizing `maxListings`. Basis: source-adapters' LISTINGS_PER_PAGE (a
   * page holds "roughly 22"; 24 seen on newest page 1). Status: fixed by that basis.
   */
  listingsPerPage: 25,
  /** Schema: `maxListings` is at most 5,000 run-wide (source-adapters, MAX_LISTINGS). Fixed. */
  maxListings: 5000,
  /** Gateway: a run may reserve at most 1,000 requests (`apify_gateway.enqueue_run`). Fixed. */
  maxRequests: 1000,
  /** Gateway: the Apify timeout exceeds `maxRunSeconds` by at least 60 s. Fixed. */
  timeoutMarginS: 60,
  /**
   * Newest-first check: page 1, 120 s, 512 MB. Basis: source-adapters' preset A (page 1, 120 s;
   * 3 page-1 terms took 26 s); 512 MB is safe for early checks with the browser fallback off
   * (guide item 7: peaked at 103 MB), and cuts the reservation. Status: starting value.
   */
  newest: { sort: 'newest', pages: 1, maxRunSeconds: 120, memoryMb: 512 },
  /**
   * Full sweep: default order, up to 60 pages a term (a full read is about 60 pages), 900 s,
   * 1,024 MB. Basis: source-adapters' preset C; guide item 7 keeps 1,024 MB for sweeps. Pages
   * shrink with the term count so `maxListings` stays within 5,000. Status: starting value.
   */
  sweep: { sort: 'default', pages: 60, maxRunSeconds: 900, memoryMb: 1024 },
  /**
   * A verification run proves a centre answers: newest-first page 1, like the newest check.
   * Basis: `actor-integration.md` 2.1 step 4 (one small run per unverified centre). Status:
   * starting value.
   */
  verification: { sort: 'newest', pages: 1, maxRunSeconds: 120, memoryMb: 512 },
  /**
   * The window for a pair's yield (new listings its checks found), used only to order regions
   * when the ramp cap cannot fit them all. Basis: none cited; a week covers weekday and weekend
   * posting. Status: starting value.
   */
  yieldWindowDays: 7,
})

export const CHECK_SCHEDULER_TICK_SECONDS = config.tickSeconds
export const CHECK_SCHEDULER_NEWEST_CADENCE_S = config.newestCadenceS
export const CHECK_SCHEDULER_SWEEP_CADENCE_S = config.sweepCadenceS
export const CHECK_SCHEDULER_ACTIVE_HOURS = config.activeHours
export const CHECK_SCHEDULER_SLOW_FACTOR = config.slowFactor
export const CHECK_SCHEDULER_MAX_TERMS_PER_RUN = config.maxTermsPerRun
export const CHECK_SCHEDULER_LISTINGS_PER_PAGE = config.listingsPerPage
export const CHECK_SCHEDULER_MAX_LISTINGS = config.maxListings
export const CHECK_SCHEDULER_MAX_REQUESTS = config.maxRequests
export const CHECK_SCHEDULER_TIMEOUT_MARGIN_S = config.timeoutMarginS
export const CHECK_SCHEDULER_NEWEST_SHAPE = config.newest
export const CHECK_SCHEDULER_SWEEP_SHAPE = config.sweep
export const CHECK_SCHEDULER_VERIFICATION_SHAPE = config.verification
export const CHECK_SCHEDULER_YIELD_WINDOW_DAYS = config.yieldWindowDays
export type CheckSchedulerSearchShapeConfig = z.infer<typeof searchShape>
