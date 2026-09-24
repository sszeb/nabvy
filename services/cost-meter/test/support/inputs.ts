import type {
  CostMeterModelCallInput,
  CostMeterRecordInput,
  CostMeterSettleInput,
} from '@nabvy/contracts/modules/cost-meter'
import type { CostMeterContext } from '../../src'

// Builders for test inputs. The rate is synthetic: USD_GBP_RATE is set weekly in config and no
// recorded value exists, so tests use 0.75 and say so.
export const RATE = 0.75
export const ON: CostMeterContext = { state: 'on', usdGbpRate: RATE }
export const SHADOW: CostMeterContext = { state: 'shadow', usdGbpRate: RATE }
export const OFF: CostMeterContext = { state: 'off', usdGbpRate: RATE }

export const apifyReservation = (
  over: Partial<CostMeterRecordInput> = {},
): CostMeterRecordInput => ({
  module: 'apify-gateway',
  provider: 'apify',
  refId: 'VkryjpwS6U2GBDh3k',
  currency: 'USD',
  reservedMicros: 336_300,
  status: 'pending',
  at: '2026-09-24T01:40:18.718Z',
  ...over,
})

export const apifySettlement = (
  over: Partial<CostMeterSettleInput> = {},
): CostMeterSettleInput => ({
  provider: 'apify',
  refId: 'VkryjpwS6U2GBDh3k',
  currency: 'USD',
  settledMicros: 17_700,
  status: 'succeeded',
  finishedAt: '2026-09-24T01:40:44.010Z',
  readAt: '2026-09-24T01:50:44.010Z',
  ...over,
})

export const haikuCall = (
  over: Partial<CostMeterModelCallInput> = {},
): CostMeterModelCallInput => ({
  module: 'listing-assessment',
  refId: 'msg_synthetic_0001',
  usage: {
    model: 'claude-haiku-4-5-20251001',
    inputTokens: 1_200,
    outputTokens: 300,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    cacheReadTokens: 2_000,
  },
  status: 'succeeded',
  latencyMs: 900,
  at: '2026-09-24T12:00:00.000Z',
  ...over,
})
