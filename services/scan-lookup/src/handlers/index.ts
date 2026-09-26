// Event handlers: thin (parse, call, return). No stamp: scan-lookup is outside the T0-T7 chain
// (rule 10 of docs/design/modules/_rules.md); each lookup keeps its own `at` instead.
import type { Result } from '@nabvy/contracts'
import type { ScanLookupError } from '@nabvy/contracts/modules/scan-lookup'
import { events as scanRecognitionEvents } from '@nabvy/contracts/modules/scan-recognition'
import type { Queryable } from '@nabvy/db'
import { defineHandler, type EventHandler } from '@nabvy/transport'
import { lookup, type ScanLookupProviders } from '../index'

export interface ScanLookupHandlerDeps {
  /** Runs `fn` in one pipeline transaction: `withPipeline` in the task file. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
  /** Optional eBay and CeX providers; absent in the MVP (soft edges, README.md). */
  providers?: ScanLookupProviders
}

// Refusals a well-formed identified event can legitimately hit: not bugs, so acknowledged rather
// than retried. `invalid_input` would mean scan-recognition's own event payload broke its
// contract, which is retried and eventually dead-lettered for investigation.
const ACKNOWLEDGED: ScanLookupError['code'][] = [
  'scan-lookup.off',
  'scan-lookup.not_found',
  'scan-lookup.account_restricted',
  'scan-lookup.insufficient_credit',
  'scan-lookup.charge_failed',
]

/** `scan-recognition.identified` -> `lookup`: price the scan from Facebook asks (and eBay/CeX
 * when their providers are supplied). Safe to run twice: `lookup()` never recharges a replay. */
export function identifiedHandler(deps: ScanLookupHandlerDeps): EventHandler {
  return defineHandler({
    consumer: 'scan-lookup',
    registry: scanRecognitionEvents,
    type: 'scan-recognition.identified',
    handle: async (event): Promise<Result<void>> => {
      const result = await deps.transaction((q) =>
        lookup(q, { scanId: event.payload.scanId }, { providers: deps.providers }),
      )
      if (result.ok) return { ok: true, value: undefined }
      if (ACKNOWLEDGED.includes(result.error.code)) return { ok: true, value: undefined }
      return result
    },
  })
}
