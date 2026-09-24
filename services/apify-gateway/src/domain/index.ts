// Pure logic: no I/O, no database, no clock or randomness passed in implicitly.
import { err, ok, type Result } from '@nabvy/contracts'
import {
  APIFY_GATEWAY_KIND_OF_SHAPE,
  type ApifyGatewayError,
  type ApifyGatewayErrorCode,
  type ApifyGatewayRunKind,
  type ApifyGatewayRunShape,
} from '@nabvy/contracts/modules/apify-gateway'
import type { SwitchesState } from '@nabvy/contracts/modules/switches'

export const failure = (
  code: ApifyGatewayErrorCode,
  message: string,
): Result<never, ApifyGatewayError> => err({ code, message })

/** The switches the gateway reads, each already failed closed by `@nabvy/switches`. */
export interface GatewaySwitches {
  /** The module switch `apify-gateway`. */
  module: SwitchesState
  /** The provider kill switch `apify`. */
  apify: SwitchesState
  /** The global pause `pipeline`. */
  pipeline: SwitchesState
  /** `cost-meter`: paid work pauses while it is off. */
  costMeter: SwitchesState
}

/**
 * Whether the gateway may work: its module switch on or in shadow (rule 11: shadow runs and
 * writes; the gateway has no user-facing output), and `apify` and `pipeline` on. The same rule is
 * `apify_gateway.enabled()` in SQL, which the Edge Function and `enqueue_run` apply.
 */
export function gatewayOpen(s: GatewaySwitches): boolean {
  return s.module !== 'off' && s.apify === 'on' && s.pipeline === 'on'
}

const nonEmptyArray = (value: unknown): boolean => Array.isArray(value) && value.length > 0

/** `search` or `details` from the actor input; null when it holds neither or both. */
export function runKindOfInput(input: Record<string, unknown>): ApifyGatewayRunKind | null {
  const searches = nonEmptyArray(input.searchTerms)
  const ids = nonEmptyArray(input.listingIds)
  if (searches === ids) return null
  return searches ? 'search' : 'details'
}

/** The input must fetch what its shape says: searches for a search shape, IDs for details. */
export function checkShape(
  shape: ApifyGatewayRunShape,
  input: Record<string, unknown>,
): Result<ApifyGatewayRunKind, ApifyGatewayError> {
  const expected = APIFY_GATEWAY_KIND_OF_SHAPE[shape]
  const actual = runKindOfInput(input)
  if (actual !== expected) {
    return failure(
      'apify-gateway.shape_mismatch',
      `Shape ${shape} needs a ${expected === 'search' ? 'searchTerms' : 'listingIds'} run with no ${
        expected === 'search' ? 'listingIds' : 'searchTerms'
      }.`,
    )
  }
  return ok(actual)
}

/**
 * A dollar amount as Postgres prints `numeric(10, 4)` ("0.3363") to integer micros, exactly: no
 * float on the way, so $0.0177 is 17 700.
 */
export function usdToMicros(usd: string): number {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(usd)
  if (!match) throw new RangeError(`Not a dollar amount: ${usd}`)
  const [, whole = '0', fraction = ''] = match
  return Number(whole) * 1_000_000 + Number(fraction.padEnd(6, '0'))
}

/** Idempotency keys: the natural ID of the job (rule 8), so each job is announced once. */
export const collectedKey = (jobId: number) => `apify-gateway.run-collected:${jobId}`
export const settledKey = (jobId: number) => `apify-gateway.run-settled:${jobId}`

/** The message of a refused query: Postgres's own text, never the input. */
export function refusalMessage(error: unknown): string {
  let current: unknown = error
  while (current instanceof Error && current.cause instanceof Error) current = current.cause
  const text = current instanceof Error ? current.message : String(current)
  return text.slice(0, 500) || 'The gateway refused the run.'
}
