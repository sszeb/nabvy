import { type LangfuseSpan, startObservation } from '@langfuse/tracing'

/**
 * The identifiers one pipeline-stage trace carries (docs/analytics.md:44): thin, like an event
 * payload (`packages/contracts/src/core/events.ts`) -- ids and a tier, never a whole listing or
 * scan. `areaId` and `runId` are added by task 1.5.
 */
export interface TraceStageIds {
  listingId?: string
  scanId?: string
  packId?: string
  tier?: 'rules' | 'default' | 'escalation'
  areaId?: string
  runId?: string
}

/**
 * Starts one trace for a pipeline stage (`stage`, e.g. `"extraction"`, `"recognition"`,
 * `"valuation"`), carrying `ids` as span metadata. The caller ends it (`.end()`) when the stage
 * finishes, or wraps it with `startActiveObservation` for automatic lifecycle management.
 * Returns a working span even when `registerTracing()` was never called: OpenTelemetry's default
 * global tracer is a no-op, so the span is created but nothing is exported.
 */
export function traceStage(stage: string, ids: TraceStageIds): LangfuseSpan {
  return startObservation(stage, { metadata: { ...ids } as Record<string, unknown> })
}
