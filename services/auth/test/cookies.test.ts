import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertSecureBaseURL } from '../src/auth'
import {
  createHarness,
  FOUNDER,
  type Harness,
  ipHeaders,
  requestMagicLink,
} from './support/harness'

// Session cookies on the real (https) origin: httpOnly, Secure and SameSite=Lax, under the
// __Secure- prefix.

let harness: Harness

beforeAll(async () => {
  harness = await createHarness([FOUNDER], 'https://nabvy.app')
}, 60_000)

afterAll(async () => {
  await harness.close()
})

describe('session cookies', () => {
  it('are httpOnly, Secure and SameSite=Lax over https', async () => {
    const email = 'cookie@example.com'
    expect((await requestMagicLink(harness, email)).status).toBe(200)
    const link = harness.sender.latestFor(email)
    expect(link?.url.startsWith('https://nabvy.app/api/auth/magic-link/verify')).toBe(true)
    const verified = await harness.routes.GET(
      new Request(link?.url ?? '', { headers: { origin: harness.baseURL, ...ipHeaders(email) } }),
    )
    const token = verified.headers.getSetCookie().find((line) => line.includes('session_token='))
    expect(token).toBeDefined()
    expect(token).toMatch(/^__Secure-/)
    expect(token).toMatch(/;\s*HttpOnly/i)
    expect(token).toMatch(/;\s*Secure/i)
    expect(token).toMatch(/;\s*SameSite=Lax/i)
  })
})

describe('BETTER_AUTH_URL', () => {
  it('must be https outside local development', () => {
    expect(() => assertSecureBaseURL('http://nabvy.app')).toThrow(/https/)
    expect(() => assertSecureBaseURL('https://nabvy.app')).not.toThrow()
    expect(() => assertSecureBaseURL('http://localhost:3000')).not.toThrow()
    expect(() => assertSecureBaseURL('http://127.0.0.1:3000')).not.toThrow()
  })
})
