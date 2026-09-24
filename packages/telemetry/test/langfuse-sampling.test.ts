import { describe, expect, it } from 'vitest'
import { isModelSpan, sampledExport } from '../src/langfuse/sampling'

const modelAttributes = {
  'langfuse.observation.type': 'generation',
  'gen_ai.request.model': 'claude-haiku-4-5-20251001',
}
const stageAttributes = {
  'langfuse.observation.type': 'span',
  'langfuse.observation.metadata.listingId': 'listing-1',
}

describe('isModelSpan', () => {
  it('is true for a generation observation', () => {
    expect(isModelSpan(modelAttributes)).toBe(true)
  })

  it('is false for a plain pipeline-stage span', () => {
    expect(isModelSpan(stageAttributes)).toBe(false)
  })
})

describe('sampledExport', () => {
  it('always keeps a model span, even at sample rate 0', () => {
    const shouldExport = sampledExport(0)
    expect(shouldExport({ otelSpan: { attributes: modelAttributes } as never })).toBe(true)
  })

  it('drops a non-model span at sample rate 0', () => {
    const shouldExport = sampledExport(0)
    expect(shouldExport({ otelSpan: { attributes: stageAttributes } as never })).toBe(false)
  })

  it('keeps a non-model span at sample rate 1', () => {
    const shouldExport = sampledExport(1)
    expect(shouldExport({ otelSpan: { attributes: stageAttributes } as never })).toBe(true)
  })
})
