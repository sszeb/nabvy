import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  BASE_URL,
  createHarness,
  FOUNDER,
  type Harness,
  signInByMagicLink,
} from './support/harness'

// Email verification is required before any session exists (docs/security.md), whatever creates
// it: the session hook refuses an unverified address, such as a Google account whose email Google
// has not verified. A magic link verifies the address before its session is made.

let harness: Harness

beforeAll(async () => {
  harness = await createHarness()
}, 60_000)

afterAll(async () => {
  await harness.close()
})

async function unverifiedUser(email: string): Promise<string> {
  const [row] = await harness.database.sql(
    `insert into better_auth."user" (name, email, email_verified) values ('', $1, false) returning id`,
    [email],
  )
  return row?.id as string
}

async function sessionCount(userId: string): Promise<number> {
  const [row] = await harness.database.sql(
    'select count(*)::int as n from better_auth.session where user_id = $1',
    [userId],
  )
  return Number(row?.n)
}

describe('email verification', () => {
  it('refuses a session for an unverified address through an endpoint', async () => {
    const id = await unverifiedUser('unverified@example.com')
    const adminCookie = await signInByMagicLink(harness, FOUNDER)
    // Impersonation is an endpoint that creates a session for someone else's account.
    const response = await harness.routes.POST(
      new Request(`${BASE_URL}/api/auth/admin/impersonate-user`, {
        method: 'POST',
        headers: { cookie: adminCookie, origin: BASE_URL, 'content-type': 'application/json' },
        body: JSON.stringify({ userId: id }),
      }),
    )
    expect(response.status).toBe(403)
    expect(((await response.json()) as { code: string }).code).toBe('EMAIL_NOT_VERIFIED')
    expect(await sessionCount(id)).toBe(0)
  })

  it('fails closed when a session is created outside a request', async () => {
    const id = await unverifiedUser('outside@example.com')
    const context = await harness.auth.$context
    expect(await context.internalAdapter.createSession(id)).toBeNull()
    expect(await sessionCount(id)).toBe(0)
  })

  it('a magic link verifies an unverified account before its session', async () => {
    const id = await unverifiedUser('late.verifier@example.com')
    await signInByMagicLink(harness, 'late.verifier@example.com')
    expect(await sessionCount(id)).toBe(1)
  })
})
