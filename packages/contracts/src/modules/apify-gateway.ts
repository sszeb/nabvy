import { z } from 'zod'
import { defineEvents, IsoTimestamp, ModuleName } from '../index'

// Contracts of the apify-gateway module (services/apify-gateway): the only module that talks to
// Apify. Import from '@nabvy/contracts/modules/apify-gateway'. Samples in
// fixtures/contracts/apify-gateway/. The actor-input schema (`ApifyGatewayActorInput`) follows
// with task 1.1a; until then the gateway's SQL checks every input (supabase/README.md).

export const module = 'apify-gateway'

/** What a run fetched: searches, or a `listingIds` batch. Never both (the gateway refuses it). */
export const ApifyGatewayRunKind = z.enum(['search', 'details'])
export type ApifyGatewayRunKind = z.infer<typeof ApifyGatewayRunKind>

/** A gateway job: a paid run, a free re-download of a finished run, or a free check. */
export const ApifyGatewayJobKind = z.enum(['env_check', 'actor_info', 'run', 'collect'])
export type ApifyGatewayJobKind = z.infer<typeof ApifyGatewayJobKind>

export const ApifyGatewayJobStatus = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'refused',
])
export type ApifyGatewayJobStatus = z.infer<typeof ApifyGatewayJobStatus>

/**
 * The run shapes of actor-integration.md 2.3. The shape names the job; its sizes are the
 * caller's (task 1.1a builds them). Each shape fetches one run kind. No `catch-up` shape: actor
 * test T2 dropped the default-order catch-up job ("Do not schedule it"; task 1.1i).
 */
export const ApifyGatewayRunShape = z.enum([
  'verification',
  'newest-check',
  'sweep-narrow',
  'sweep-broad',
  'details-text',
  'details-photo',
])
export type ApifyGatewayRunShape = z.infer<typeof ApifyGatewayRunShape>

export const APIFY_GATEWAY_KIND_OF_SHAPE: Record<ApifyGatewayRunShape, ApifyGatewayRunKind> = {
  verification: 'search',
  'newest-check': 'search',
  'sweep-narrow': 'search',
  'sweep-broad': 'search',
  'details-text': 'details',
  'details-photo': 'details',
}

/** Who asked for a run and why (modules.md, apify-gateway card). Never a user ID. */
export const ApifyGatewayTags = z.strictObject({
  module: ModuleName,
  region: z.string().min(1).max(100),
  purpose: z.string().min(1).max(100),
})
export type ApifyGatewayTags = z.infer<typeof ApifyGatewayTags>

/**
 * A request to queue one run. `input` is the actor input as it will be sent; the gateway's SQL
 * validates it and reserves its worst-case cost (supabase/README.md, "How it works").
 */
export const ApifyGatewaySubmitRunInput = z.strictObject({
  shape: ApifyGatewayRunShape,
  input: z.record(z.string(), z.unknown()),
  memoryMb: z.union([z.literal(512), z.literal(1024), z.literal(2048)]),
  timeoutSecs: z.int().min(60).max(1800),
  tags: ApifyGatewayTags,
  note: z.string().min(1).max(500).optional(),
})
export type ApifyGatewaySubmitRunInput = z.infer<typeof ApifyGatewaySubmitRunInput>

/** A queued run: its job ID and the reservation the gateway holds against the monthly cap. */
export const ApifyGatewaySubmitted = z.strictObject({
  jobId: z.int().positive(),
  reserveUsd: z.string().regex(/^\d+\.\d{4}$/),
})
export type ApifyGatewaySubmitted = z.infer<typeof ApifyGatewaySubmitted>

/**
 * One actor row as stored. Rows are kept whole, so unknown fields pass through untouched; only
 * `recordType` is required (`listing` and `sourceOutcome` in the recorded run). Listing IDs stay
 * strings: one recorded ID has 17 digits.
 */
export const ApifyGatewayRow = z.looseObject({
  recordType: z.string().min(1),
  listingId: z.string().regex(/^\d+$/).optional(),
})
export type ApifyGatewayRow = z.infer<typeof ApifyGatewayRow>

/**
 * The actor's `RUN_SUMMARY` record, kept whole (internal data, never shown to users). The fields
 * named here are the ones readers use; everything else passes through.
 */
export const ApifyGatewayRunSummary = z.looseObject({
  searches: z.array(z.looseObject({})).optional(),
  detailRoute: z.looseObject({}).nullable().optional(),
  requests: z.number().int().nonnegative().optional(),
  listingsFound: z.number().int().nonnegative().optional(),
})
export type ApifyGatewayRunSummary = z.infer<typeof ApifyGatewayRunSummary>

const JobId = z.int().positive()
const ApifyRunId = z.string().regex(/^[A-Za-z0-9]{17}$/)
const Usd = z.string().regex(/^\d+\.\d{4}$/)

/** One row of `apify_gateway.v_jobs`. */
export const ApifyGatewayJob = z.strictObject({
  id: JobId,
  kind: ApifyGatewayJobKind,
  runKind: ApifyGatewayRunKind.nullable(),
  status: ApifyGatewayJobStatus,
  tags: z.record(z.string(), z.unknown()),
  input: z.record(z.string(), z.unknown()),
  memoryMb: z.int().nullable(),
  timeoutSecs: z.int().nullable(),
  reserveUsd: Usd,
  costUsd: Usd.nullable(),
  apifyRunId: ApifyRunId.nullable(),
  itemCount: z.int().nonnegative().nullable(),
  error: z.string().nullable(),
  startedAt: IsoTimestamp.nullable(),
  finishedAt: IsoTimestamp.nullable(),
  settledAt: IsoTimestamp.nullable(),
  announcedAt: IsoTimestamp.nullable(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
})
export type ApifyGatewayJob = z.infer<typeof ApifyGatewayJob>

/** A job's rows were collected: the receiver reads them from `v_rows` by job ID. */
export const ApifyGatewayRunCollectedEvent = z.strictObject({
  jobId: JobId,
  apifyRunId: ApifyRunId,
  kind: ApifyGatewayRunKind,
})
export type ApifyGatewayRunCollectedEvent = z.infer<typeof ApifyGatewayRunCollectedEvent>

/** A paid run's final cost is in cost-meter. */
export const ApifyGatewayRunSettledEvent = z.strictObject({ jobId: JobId })
export type ApifyGatewayRunSettledEvent = z.infer<typeof ApifyGatewayRunSettledEvent>

/** Error codes the module returns as values (docs/engineering.md, "Errors"). */
export const ApifyGatewayErrorCode = z.enum([
  'apify-gateway.off', //             module, provider `apify` or `pipeline` switched off
  'apify-gateway.cost_meter_off', //  the cost meter is off: paid work pauses (fail closed)
  'apify-gateway.shape_mismatch', //  the input's searches or IDs do not match the shape
  'apify-gateway.refused', //         the gateway's SQL refused the input (its message says why)
])
export type ApifyGatewayErrorCode = z.infer<typeof ApifyGatewayErrorCode>

export const ApifyGatewayError = z.strictObject({
  code: ApifyGatewayErrorCode,
  message: z.string().min(1),
})
export type ApifyGatewayError = z.infer<typeof ApifyGatewayError>

/** Events this module publishes, keyed by job ID so each job is announced once. */
export const events = defineEvents(module, {
  'apify-gateway.run-collected': { 1: ApifyGatewayRunCollectedEvent },
  'apify-gateway.run-settled': { 1: ApifyGatewayRunSettledEvent },
})
