import { z } from 'zod'

// Thresholds of the details-queue module (rule 14 of docs/design/modules/_rules.md), validated
// with Zod like the env groups in ../env.ts. Every value is a starting value until the first
// recorded details batch (task 1.0a) calibrates it.

const detailsQueueConfig = z.object({
  batchSize: z.number().int().min(1).max(200),
  dailyCap: z.number().int().positive(),
  maxFailures: z.number().int().positive(),
  maxRequeues: z.number().int().nonnegative(),
  maxRunSeconds: z.number().int().min(10).max(3600),
  timeoutMarginSecs: z.number().int().min(60),
  memoryMb: z.union([z.literal(512), z.literal(1024), z.literal(2048)]),
  requestsPerId: z.number().int().positive(),
  requestsMargin: z.number().int().nonnegative(),
  maxRequests: z.number().int().min(1).max(1000),
  leaseSecs: z.number().int().positive(),
  defaultRegion: z.string().min(1).max(100),
  photoLaneOpen: z.boolean(),
  eventBatchSize: z.number().int().min(1).max(500),
})

const config = detailsQueueConfig.parse({
  /**
   * Listing IDs per details run. Basis: at most about 200 per details run
   * (`CONTAINER_LISTINGS.md:68,108-109`; question 6). Starting value.
   */
  batchSize: 200,
  /**
   * IDs submitted per London calendar day; past it, work is deferred with a visible status.
   * Basis: $0.00092 per listing on graphql and $0.00166 on page (settled, the actor's guide,
   * `docs/design/actor-app-guide.md`, "Costs"): 1,000 a day is about $28 a month on graphql and
   * $50 on page, a third of the owner's $150 monthly Apify cap, leaving the rest for searches.
   * Starting value (docs/questions/details-queue.md).
   */
  dailyCap: 1000,
  /** Failed attempts (sent, but no usable row) before an item is `failed`. Basis: 2.10. Starting value. */
  maxFailures: 2,
  /**
   * Refreshes of a `partial` or `missing` description before the item is left as it is. Basis:
   * 1–2% stay missing for unknown reasons (`EVIDENCE_LEDGER.md:189-190`); 2.10 "requeue once".
   * Starting value.
   */
  maxRequeues: 1,
  /** The actor's own time limit per run: its default (actor guide, input v3). Starting value. */
  maxRunSeconds: 900,
  /** Run timeout = maxRunSeconds + this: the gateway requires at least 60 s (supabase/README.md). */
  timeoutMarginSecs: 60,
  /** Detail runs stay at 1,024 MB (actor guide, "What changes for Nabvy", item 7). */
  memoryMb: 1024,
  /**
   * `maxRequests` = IDs × requestsPerId + requestsMargin, at most maxRequests. Basis: the recorded
   * run needed 22 requests for 20 details (`run-summary.json`: `requests` 22); twice that covers
   * retries. Undersizing only leaves IDs not attempted, which are requeued without a failure
   * (2.10); oversizing only raises the reservation. Starting value.
   */
  requestsPerId: 2,
  requestsMargin: 20,
  /** The gateway's cap on `maxRequests` (supabase/README.md, "Input rules"). Fixed. */
  maxRequests: 1000,
  /**
   * How long a batch's lease holds before the queue looks at its job again. A lease never expires
   * while the job is pending or running: only a finished job that was refused, failed, or never
   * announced frees its IDs. Basis: timeout (960 s) plus collection and a watcher tick. Starting
   * value.
   */
  leaseSecs: 1800,
  /** Region tag for items no caller placed (pasted links): the national UK grid. Starting value. */
  defaultRegion: 'uk',
  /**
   * Photo captures are recorded but not submitted: the actor cannot capture photos yet
   * (`docs/questions.md`, photo capture; actor guide, open question 3). Fixed until it can.
   */
  photoLaneOpen: false,
  /** Listing IDs per `details-queue.deferred` event. Basis: rule 7. Fixed. */
  eventBatchSize: 500,
})

export const DETAILS_QUEUE_BATCH_SIZE = config.batchSize
export const DETAILS_QUEUE_DAILY_CAP = config.dailyCap
export const DETAILS_QUEUE_MAX_FAILURES = config.maxFailures
export const DETAILS_QUEUE_MAX_REQUEUES = config.maxRequeues
export const DETAILS_QUEUE_MAX_RUN_SECONDS = config.maxRunSeconds
export const DETAILS_QUEUE_TIMEOUT_MARGIN_SECS = config.timeoutMarginSecs
export const DETAILS_QUEUE_MEMORY_MB = config.memoryMb
export const DETAILS_QUEUE_REQUESTS_PER_ID = config.requestsPerId
export const DETAILS_QUEUE_REQUESTS_MARGIN = config.requestsMargin
export const DETAILS_QUEUE_MAX_REQUESTS = config.maxRequests
export const DETAILS_QUEUE_LEASE_SECS = config.leaseSecs
export const DETAILS_QUEUE_DEFAULT_REGION = config.defaultRegion
export const DETAILS_QUEUE_PHOTO_LANE_OPEN = config.photoLaneOpen
export const DETAILS_QUEUE_EVENT_BATCH_SIZE = config.eventBatchSize
