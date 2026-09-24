import type { ShouldExportSpan } from '@langfuse/otel'

// A model call is a Langfuse "generation" or "embedding" observation (`@langfuse/tracing` sets
// `langfuse.observation.type` on every span it creates), or carries `gen_ai.*`/`ai.*` attributes
// (the Vercel AI SDK's and known LLM instrumentation libraries' own convention). Cost and quality
// analysis needs every one of those; a plain pipeline-stage span (`traceStage`, type "span") is
// sampled to control Langfuse unit spend (design section 6, `LANGFUSE_SAMPLE_RATE`).
const OBSERVATION_TYPE_ATTRIBUTE = 'langfuse.observation.type'
const MODEL_OBSERVATION_TYPES = new Set(['generation', 'embedding'])
const MODEL_ATTRIBUTE_PREFIXES = ['gen_ai.', 'ai.']

export function isModelSpan(attributes: Record<string, unknown>): boolean {
  const observationType = attributes[OBSERVATION_TYPE_ATTRIBUTE]
  if (typeof observationType === 'string' && MODEL_OBSERVATION_TYPES.has(observationType)) {
    return true
  }
  return Object.keys(attributes).some((key) =>
    MODEL_ATTRIBUTE_PREFIXES.some((prefix) => key.startsWith(prefix)),
  )
}

/** Always exports model spans; samples every other span at `sampleRate` (0-1). */
export function sampledExport(sampleRate: number): ShouldExportSpan {
  return ({ otelSpan }) => isModelSpan(otelSpan.attributes) || Math.random() < sampleRate
}
