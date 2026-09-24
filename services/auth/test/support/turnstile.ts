import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

// Test double for Cloudflare Turnstile's siteverify endpoint: a local HTTP server that accepts
// the token PASS_TOKEN and rejects anything else. No request leaves the machine.

export const PASS_TOKEN = 'turnstile-test-pass'

export interface FakeTurnstile {
  url: string
  verifications: number
  close(): Promise<void>
}

export async function startFakeTurnstile(): Promise<FakeTurnstile> {
  const state = { verifications: 0 }
  const server: Server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      state.verifications += 1
      const { response: token } = JSON.parse(body || '{}') as { response?: string }
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify(
          token === PASS_TOKEN
            ? { success: true, hostname: 'localhost' }
            : { success: false, 'error-codes': ['invalid-input-response'] },
        ),
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/siteverify`,
    get verifications() {
      return state.verifications
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
