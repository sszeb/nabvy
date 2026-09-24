import { LangfuseClient, type TextPromptClient } from '@langfuse/client'
import { type EnvSource, safeLoadEnv } from '@nabvy/config'

/**
 * Fetches a pack instruction block or model prompt by name and label (`"production"` or
 * `"staging"`), cached client-side (docs/analytics.md:46: "the pipeline fetches by label and
 * caches"). Without Langfuse keys, `getPrompt()` resolves to `undefined` and makes no network
 * call.
 */
export interface PromptClient {
  readonly enabled: boolean
  getPrompt(
    name: string,
    label: string,
    cacheTtlSeconds?: number,
  ): Promise<TextPromptClient | undefined>
}

const noopPromptClient: PromptClient = {
  enabled: false,
  async getPrompt() {
    return undefined
  },
}

export function createLangfusePromptClient(source?: EnvSource): PromptClient {
  const parsed = safeLoadEnv(['langfuse'], source)
  if (!parsed.success) return noopPromptClient

  const client = new LangfuseClient({
    publicKey: parsed.data.LANGFUSE_PUBLIC_KEY,
    secretKey: parsed.data.LANGFUSE_SECRET_KEY,
    baseUrl: parsed.data.LANGFUSE_HOST,
  })

  return {
    enabled: true,
    async getPrompt(name, label, cacheTtlSeconds) {
      return client.prompt.get(name, { label, type: 'text', cacheTtlSeconds })
    },
  }
}
