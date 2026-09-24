import { z } from 'zod'
import { defineEvents, IsoTimestamp, ModuleName, Uuid } from '../index'

// Contracts of the cost-meter module (services/cost-meter): the ledger of every paid or counted
// provider call. Import from '@nabvy/contracts/modules/cost-meter'. Samples in
// fixtures/contracts/cost-meter/.

export const module = 'cost-meter'

/** Providers whose calls are metered (docs/engineering.md, "Cost metering"). */
export const CostMeterProvider = z.enum(['apify', 'anthropic', 'ebay', 'cex'])
export type CostMeterProvider = z.infer<typeof CostMeterProvider>

/** What was called: an Apify actor run, a model call, or a counted free API call. */
export const CostMeterKind = z.enum(['actor_run', 'model_call', 'api_call'])
export type CostMeterKind = z.infer<typeof CostMeterKind>

/** The kind each provider's calls are metered as. */
export const COST_METER_KIND_OF: Record<CostMeterProvider, CostMeterKind> = {
  apify: 'actor_run',
  anthropic: 'model_call',
  ebay: 'api_call',
  cex: 'api_call',
}

/**
 * The currency a provider bills in. Apify and Anthropic bill in USD, so the ledger keeps the USD
 * amount as billed and a GBP amount converted with `USD_GBP_RATE` beside it. This is a ledger
 * currency, not the listing `Currency` of the core: asks are never converted, costs are.
 */
export const CostMeterCurrency = z.enum(['USD', 'GBP'])
export type CostMeterCurrency = z.infer<typeof CostMeterCurrency>

/**
 * Amounts are integer micros: millionths of the currency's major unit ($0.0177 is 17 700).
 * Minor units (cents) cannot hold a run read at $0.0003 or a model call costing a fraction of a
 * cent, so the ledger counts in micros and rounds up, never down.
 */
export const CostMeterMicros = z.int().nonnegative()
export type CostMeterMicros = z.infer<typeof CostMeterMicros>

/** The provider's answer: still running, done, or failed. Settlement is `settledAt`, not this. */
export const CostMeterStatus = z.enum(['pending', 'succeeded', 'failed'])
export type CostMeterStatus = z.infer<typeof CostMeterStatus>

/** The provider's own ID for the call: the Apify run ID, the model response ID, a request ID. */
export const CostMeterRefId = z.string().min(1).max(200)

/** A reservation (or a free call) as a paying module records it before or when it spends. */
export const CostMeterRecordInput = z
  .strictObject({
    module: ModuleName,
    provider: CostMeterProvider,
    refId: CostMeterRefId,
    currency: CostMeterCurrency,
    reservedMicros: CostMeterMicros,
    status: CostMeterStatus,
    latencyMs: z.int().nonnegative().optional(),
    at: IsoTimestamp,
  })
  .refine(
    (input) =>
      input.provider === 'apify' || input.provider === 'anthropic' || input.reservedMicros === 0,
    {
      message: 'eBay and CeX calls are free: reservedMicros must be 0',
      path: ['reservedMicros'],
    },
  )
export type CostMeterRecordInput = z.infer<typeof CostMeterRecordInput>

/**
 * A settlement: the provider's final cost. For an Apify run, `finishedAt` is required and
 * `readAt` must be at least the settle delay after it, because Apify finalises `usageTotalUsd`
 * minutes after a run ends (supabase/README.md, "Spend").
 */
export const CostMeterSettleInput = z.strictObject({
  provider: CostMeterProvider,
  refId: CostMeterRefId,
  currency: CostMeterCurrency,
  settledMicros: CostMeterMicros,
  status: z.enum(['succeeded', 'failed']),
  latencyMs: z.int().nonnegative().optional(),
  finishedAt: IsoTimestamp.optional(),
  readAt: IsoTimestamp,
})
export type CostMeterSettleInput = z.infer<typeof CostMeterSettleInput>

/** Token usage of one model call, as the Messages API reports it. */
export const CostMeterModelUsage = z.strictObject({
  model: z.string().min(1),
  inputTokens: z.int().nonnegative(),
  outputTokens: z.int().nonnegative(),
  cacheWrite5mTokens: z.int().nonnegative(),
  cacheWrite1hTokens: z.int().nonnegative(),
  cacheReadTokens: z.int().nonnegative(),
})
export type CostMeterModelUsage = z.infer<typeof CostMeterModelUsage>

/** A model call, metered once it returns: tokens × the price table, settled at once. */
export const CostMeterModelCallInput = z.strictObject({
  module: ModuleName,
  refId: CostMeterRefId,
  usage: CostMeterModelUsage,
  status: z.enum(['succeeded', 'failed']),
  latencyMs: z.int().nonnegative().optional(),
  at: IsoTimestamp,
})
export type CostMeterModelCallInput = z.infer<typeof CostMeterModelCallInput>

/**
 * One row of `cost_meter.v_costs`, the ledger other modules read (spend-governor, ops-metrics).
 * `countedGbpMicros` is what the call costs now: the settlement once there is one, otherwise the
 * reservation. A settlement replaces the reservation once.
 */
export const CostMeterCall = z.strictObject({
  id: Uuid,
  module: ModuleName,
  provider: CostMeterProvider,
  kind: CostMeterKind,
  refId: CostMeterRefId,
  currency: CostMeterCurrency,
  reservedMicros: CostMeterMicros,
  settledMicros: CostMeterMicros.nullable(),
  reservedGbpMicros: CostMeterMicros,
  settledGbpMicros: CostMeterMicros.nullable(),
  countedGbpMicros: CostMeterMicros,
  status: CostMeterStatus,
  latencyMs: z.int().nonnegative().nullable(),
  settledAt: IsoTimestamp.nullable(),
  at: IsoTimestamp,
})
export type CostMeterCall = z.infer<typeof CostMeterCall>

/** Error codes the module returns as values (docs/engineering.md, "Errors"). */
export const CostMeterErrorCode = z.enum([
  'cost-meter.off', //              the switch is off: paid work pauses (fail closed)
  'cost-meter.not_found', //        settle for a call never recorded
  'cost-meter.not_final', //        an Apify reading taken too soon after the run finished
  'cost-meter.already_settled', //  a second settlement with a different amount
  'cost-meter.mismatch', //         provider, kind or currency differs from the recorded call
  'cost-meter.unknown_model', //    no price for the model: never guess a price
])
export type CostMeterErrorCode = z.infer<typeof CostMeterErrorCode>

export const CostMeterError = z.strictObject({
  code: CostMeterErrorCode,
  message: z.string().min(1),
})
export type CostMeterError = z.infer<typeof CostMeterError>

/** Events this module publishes: none. Readers use `v_costs` (the card lists no events). */
export const events = defineEvents(module, {})
