import { readFileSync } from 'node:fs'
import { EnvError } from '@nabvy/config'
import { ACCOUNT_RESTRICTED_MESSAGE } from '@nabvy/contracts/modules/auth'
import { describe, expect, it, vi } from 'vitest'
import { isFounderEmail } from '../src/domain/founders'
import { isRestricted } from '../src/domain/standing'
import {
  createRecordingMagicLinkSender,
  createResendMagicLinkSender,
  MAGIC_LINK_FROM,
} from '../src/email/magic-link'
import { AccountRestrictedError, createAuthFromEnv, createAuthRouteHandlers } from '../src/index'

interface StandingCase {
  name: string
  user: { banned?: boolean | null; banExpires?: string | null }
  restricted: boolean
}
const standing = JSON.parse(
  readFileSync(new URL('./fixtures/standing.json', import.meta.url), 'utf8'),
) as { now: string; cases: StandingCase[] }

describe('isRestricted (fixtures/standing.json)', () => {
  it.each(standing.cases)('$name', ({ user, restricted }) => {
    expect(isRestricted(user, new Date(standing.now))).toBe(restricted)
    // Better Auth hands the expiry over as a Date.
    const asDate = {
      ...user,
      banExpires: user.banExpires ? new Date(user.banExpires) : user.banExpires,
    }
    expect(isRestricted(asDate, new Date(standing.now))).toBe(restricted)
  })
})

describe('isFounderEmail', () => {
  const admins = ['founder@example.com']
  it.each([
    ['founder@example.com', true],
    [' Founder@Example.COM ', true],
    ['founder@example.co', false],
    ['xfounder@example.com', false],
    ['', false],
  ])('%s → %s', (email, expected) => {
    expect(isFounderEmail(email, admins)).toBe(expected)
  })

  it('admits nobody when the list is empty', () => {
    expect(isFounderEmail('founder@example.com', [])).toBe(false)
  })
})

describe('AccountRestrictedError', () => {
  it('always carries the vague notice and nothing else', () => {
    const error = new AccountRestrictedError()
    expect(error.message).toBe(ACCOUNT_RESTRICTED_MESSAGE)
    expect(Object.keys(error.toJSON()).sort()).toEqual(['code', 'message'])
  })
})

describe('magic-link senders', () => {
  it('the recording sender keeps the newest link per address', async () => {
    const sender = createRecordingMagicLinkSender()
    await sender.send({ email: 'a@example.com', url: 'https://x.test/1' })
    await sender.send({ email: 'A@example.com', url: 'https://x.test/2' })
    expect(sender.latestFor('a@example.com')?.url).toBe('https://x.test/2')
    expect(sender.latestFor('b@example.com')).toBeUndefined()
  })

  it('the Resend sender posts one plain-text email and never logs the link on failure', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetchDouble = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      return new Response('{}', { status: calls.length === 1 ? 200 : 422 })
    })
    const sender = createResendMagicLinkSender({
      apiKey: 'test-only-key',
      fetch: fetchDouble as unknown as typeof fetch,
    })
    await sender.send({
      email: 'a@example.com',
      url: 'https://nabvy.app/api/auth/magic-link/verify?token=t',
    })
    expect(calls[0]?.url).toBe('https://api.resend.com/emails')
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe('Bearer test-only-key')
    const body = JSON.parse(String(calls[0]?.init.body))
    expect(body).toMatchObject({ from: MAGIC_LINK_FROM, to: ['a@example.com'] })
    expect(body.text).toContain('https://nabvy.app/api/auth/magic-link/verify?token=t')

    const failure = sender.send({ email: 'a@example.com', url: 'https://nabvy.app/secret-link' })
    await expect(failure).rejects.toThrow('(422)')
    await expect(failure).rejects.not.toThrow(/secret-link|a@example\.com/)
  })
})

describe('createAuthFromEnv', () => {
  it('names the missing variables and nothing else', () => {
    let error: unknown
    try {
      createAuthFromEnv({ BETTER_AUTH_SECRET: 'placeholder-secret-value' })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(EnvError)
    const message = (error as Error).message
    for (const name of [
      'BETTER_AUTH_URL',
      'ADMIN_EMAILS',
      'DATABASE_URL_AUTH',
      'TURNSTILE_SECRET_KEY',
      'RESEND_API_KEY',
    ]) {
      expect(message).toContain(name)
    }
    expect(message).not.toContain('placeholder-secret-value')
  })

  it('refuses half a Google configuration', () => {
    expect(() =>
      createAuthFromEnv({
        BETTER_AUTH_SECRET: 'placeholder-better-auth-secret-at-least-32-chars',
        BETTER_AUTH_URL: 'http://localhost:3000',
        ADMIN_EMAILS: 'founder@example.com',
        DATABASE_URL_AUTH: 'postgresql://nabvy_auth:placeholder@localhost:5432/postgres',
        TURNSTILE_SITE_KEY: 'placeholder',
        TURNSTILE_SECRET_KEY: 'placeholder',
        RESEND_API_KEY: 'placeholder',
        RESEND_WEBHOOK_SECRET: 'placeholder',
        GOOGLE_OAUTH_CLIENT_ID: 'placeholder',
      }),
    ).toThrow(/GOOGLE_OAUTH_CLIENT_SECRET/)
  })
})

describe('createAuthRouteHandlers', () => {
  it('resolves the instance on the first request, not at import', async () => {
    const handler = vi.fn(async () => new Response('ok'))
    const resolve = vi.fn(() => ({ handler }))
    const { GET, POST } = createAuthRouteHandlers(resolve)
    expect(resolve).not.toHaveBeenCalled()
    await GET(new Request('http://localhost:3000/api/auth/get-session'))
    await POST(new Request('http://localhost:3000/api/auth/sign-out', { method: 'POST' }))
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenCalledTimes(2)
  })
})
