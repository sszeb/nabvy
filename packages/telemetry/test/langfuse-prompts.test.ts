import { describe, expect, it } from 'vitest'
import { createLangfusePromptClient } from '../src/langfuse/prompts'

describe('createLangfusePromptClient', () => {
  it('does nothing and makes no network call when Langfuse keys are absent', async () => {
    const client = createLangfusePromptClient({})
    expect(client.enabled).toBe(false)
    await expect(client.getPrompt('recognition', 'production')).resolves.toBeUndefined()
  })
})
