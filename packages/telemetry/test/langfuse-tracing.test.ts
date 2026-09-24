import type { ExportResult } from '@opentelemetry/core'
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base'
import { afterEach, describe, expect, it } from 'vitest'
import { traceStage } from '../src/langfuse/trace-stage'
import { registerTracing, type Tracing } from '../src/langfuse/tracing'

const withKeys = {
  LANGFUSE_PUBLIC_KEY: 'pk-lf-test',
  LANGFUSE_SECRET_KEY: 'sk-lf-test',
  LANGFUSE_HOST: 'https://cloud.langfuse.com',
  LANGFUSE_SAMPLE_RATE: '1',
}

function stubExporter(): { exporter: SpanExporter; spans: ReadableSpan[] } {
  const spans: ReadableSpan[] = []
  return {
    spans,
    exporter: {
      export(batch, resultCallback) {
        spans.push(...batch)
        resultCallback({ code: 0 } satisfies ExportResult)
      },
      shutdown: () => Promise.resolve(),
    },
  }
}

let tracing: Tracing | undefined

afterEach(async () => {
  await tracing?.shutdown()
  tracing = undefined
})

describe('registerTracing', () => {
  it('does nothing and builds no processor or SDK when Langfuse keys are absent', async () => {
    tracing = registerTracing({ source: {} })
    expect(tracing.enabled).toBe(false)
    await expect(tracing.forceFlush()).resolves.toBeUndefined()
  })

  it('sends a stubbed exporter a span with the required attributes and masked fields', async () => {
    const { exporter, spans } = stubExporter()
    tracing = registerTracing({ source: withKeys, exporter })
    expect(tracing.enabled).toBe(true)

    const span = traceStage('extraction', {
      listingId: 'listing-1',
      packId: 'gpu-pc',
      tier: 'default',
    })
    span.update({ input: { sellerEmail: 'seller@example.com', note: 'call 07123 456789' } })
    span.end()

    await tracing.forceFlush()

    expect(spans.length).toBeGreaterThan(0)
    const attributes = spans[0]?.attributes ?? {}
    expect(attributes['langfuse.observation.metadata.listingId']).toBe('listing-1')
    expect(attributes['langfuse.observation.metadata.packId']).toBe('gpu-pc')
    expect(attributes['langfuse.observation.metadata.tier']).toBe('default')

    const input = String(attributes['langfuse.observation.input'] ?? '')
    expect(input).not.toContain('seller@example.com')
    expect(input).not.toContain('07123 456789')
  })
})
