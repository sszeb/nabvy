// Thresholds and the model price table of the cost-meter module (rule 14 of
// docs/design/modules/_rules.md). They live here until @nabvy/config gains per-module files
// (packages/config/src/modules/cost-meter.ts); moving them changes no value. Each carries its basis.

/**
 * An Apify reading counts as final only this long after the run finished. Basis: Apify finalises
 * `usageTotalUsd` minutes after a run ends; the recorded run read $0.0003 at finish and $0.0177
 * later, and the gateway settles on an invocation at least 10 minutes after the finish
 * (supabase/README.md, "Spend"). Status: starting value, matched to the gateway.
 */
export const APIFY_SETTLE_DELAY_MS = 10 * 60 * 1000

/**
 * Model prices in nano-USD per token (USD per million tokens × 1000), so every price is an
 * integer: $1.00/MTok is 1000. Cache writes cost 1.25× input for the 5-minute TTL and 2× for the
 * 1-hour TTL; cache reads 0.1× input. Basis: Anthropic's first-party API list prices, 2026-06-24.
 * A model missing here is refused (`cost-meter.unknown_model`), never priced by guess. Update
 * with the model IDs in @nabvy/config (MODEL_DEFAULT, MODEL_ESCALATION, MODEL_VISION).
 */
export interface ModelPrice {
  input: number
  output: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheRead: number
}

const HAIKU_4_5: ModelPrice = {
  input: 1000,
  output: 5000,
  cacheWrite5m: 1250,
  cacheWrite1h: 2000,
  cacheRead: 100,
}
const SONNET_5: ModelPrice = {
  input: 2000,
  output: 10000,
  cacheWrite5m: 2500,
  cacheWrite1h: 4000,
  cacheRead: 200,
}

export const MODEL_PRICES_NANO_USD: Readonly<Record<string, ModelPrice>> = {
  'claude-haiku-4-5': HAIKU_4_5,
  'claude-haiku-4-5-20251001': HAIKU_4_5,
  'claude-sonnet-5': SONNET_5,
}
