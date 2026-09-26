import type { RouterGatewayEnv } from '@nabvy/config/modules/router-gateway'
import { createMemoryPublisher } from '@nabvy/transport'
import type { RouterDeps, RouterLogLine } from '../../src'
import type { TestDatabase } from './database'

// A recorded provider answer replayed through an injected fetch: no test makes a live call.

export interface Recorded {
  status: number
  body: unknown
  /** Raw text instead of JSON (for a malformed or oversized body). */
  raw?: string
}

export const TEST_KEY = 'test-key-not-a-secret'
export const ENV: RouterGatewayEnv = {
  ROUTER_PROVIDER: 'openrouteservice',
  ROUTER_BASE_URL: 'https://api.openrouteservice.org',
  ROUTER_API_KEY: TEST_KEY,
}

export interface Harness {
  deps: RouterDeps & { log: (line: RouterLogLine) => void }
  publisher: ReturnType<typeof createMemoryPublisher>
  requests: { url: string; init: RequestInit }[]
  logs: RouterLogLine[]
}

export function harness(
  db: TestDatabase,
  answer: Recorded | (() => Promise<Response>),
  now = () => new Date(),
): Harness {
  const publisher = createMemoryPublisher()
  const requests: Harness['requests'] = []
  const logs: RouterLogLine[] = []
  const fakeFetch = (async (url: URL | string, init: RequestInit = {}) => {
    requests.push({ url: String(url), init })
    if (typeof answer === 'function') return answer()
    const text = answer.raw ?? JSON.stringify(answer.body)
    return new Response(text, {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return {
    deps: {
      publisher,
      run: (fn) => db.as('nabvy_pipeline', fn),
      env: ENV,
      fetch: fakeFetch,
      now,
      log: (line) => logs.push(line),
    },
    publisher,
    requests,
    logs,
  }
}
