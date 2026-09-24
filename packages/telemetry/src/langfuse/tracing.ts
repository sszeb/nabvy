import { LangfuseSpanProcessor } from '@langfuse/otel'
import { type EnvSource, safeLoadEnv } from '@nabvy/config'
import { NodeSDK } from '@opentelemetry/sdk-node'
import type { SpanExporter } from '@opentelemetry/sdk-trace-base'
import { maskSensitiveData } from './masking'
import { sampledExport } from './sampling'

export interface Tracing {
  readonly enabled: boolean
  /** Flushes buffered spans; call before a short-lived process instance freezes or exits. */
  forceFlush(): Promise<void>
  shutdown(): Promise<void>
}

const noopTracing: Tracing = {
  enabled: false,
  async forceFlush() {},
  async shutdown() {},
}

export interface RegisterTracingOptions {
  source?: EnvSource
  /** A stubbed exporter for tests; production uses `@langfuse/otel`'s own OTLP exporter. */
  exporter?: SpanExporter
}

/**
 * Sets up OpenTelemetry with a `LangfuseSpanProcessor`: the mask function (`./masking`) and the
 * sampling rate (`./sampling`, `LANGFUSE_SAMPLE_RATE`) applied to every span exported.
 * `traceStage()` still returns a working (no-op) span when tracing was never registered.
 * Without `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY`/`LANGFUSE_HOST`, does nothing: no
 * processor or SDK is built, so nothing is captured and no network call is made.
 */
export function registerTracing(options: RegisterTracingOptions = {}): Tracing {
  const parsed = safeLoadEnv(['langfuse'], options.source)
  if (!parsed.success) return noopTracing

  const processor = new LangfuseSpanProcessor({
    publicKey: parsed.data.LANGFUSE_PUBLIC_KEY,
    secretKey: parsed.data.LANGFUSE_SECRET_KEY,
    baseUrl: parsed.data.LANGFUSE_HOST,
    exporter: options.exporter,
    mask: maskSensitiveData,
    shouldExportSpan: sampledExport(parsed.data.LANGFUSE_SAMPLE_RATE),
  })

  const sdk = new NodeSDK({ spanProcessors: [processor] })
  sdk.start()

  return {
    enabled: true,
    forceFlush: () => processor.forceFlush(),
    shutdown: () => sdk.shutdown(),
  }
}
