import {
  AuthError,
  accountRestrictedNotice,
  type RestrictionPolicy,
  type RestrictionStep,
} from '@nabvy/contracts/modules/auth'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { liftRestriction, restrictAccount } from '../src/admin'
import { AccountRestrictedError, ForbiddenError, UnauthenticatedError } from '../src/domain'
import { assertAccountActive, isAccountActive } from '../src/repo'
import { getSession, requireActiveUser, requireAdmin, requireUser } from '../src/session'
import {
  BASE_URL,
  cookieHeader,
  createHarness,
  FOUNDER,
  type Harness,
  headersWith,
  ipHeaders,
  requestMagicLink,
  signInByMagicLink,
} from './support/harness'
import { PASS_TOKEN } from './support/turnstile'

// End to end through the mounted /api/auth/* handlers, Better Auth and the real better_auth
// migrations on PGlite, connected as nabvy_auth. Emails go to the recording sender and captcha
// checks to a local Turnstile double.

let harness: Harness

beforeAll(async () => {
  harness = await createHarness()
}, 60_000)

afterAll(async () => {
  await harness.close()
})

async function userRow(email: string) {
  const [row] = await harness.database.sql(
    'select id, role, email_verified, banned, ban_reason, ban_expires from better_auth."user" where email = $1',
    [email],
  )
  return row as
    | {
        id: string
        role: string | null
        email_verified: boolean
        banned: boolean | null
        ban_reason: string | null
        ban_expires: Date | null
      }
    | undefined
}

async function sessionCount(userId: string): Promise<number> {
  const [row] = await harness.database.sql(
    'select count(*)::int as n from better_auth.session where user_id = $1',
    [userId],
  )
  return Number(row?.n)
}

describe('sign-up by magic link', () => {
  it('creates a verified user with the user role and a session', async () => {
    const email = 'new.user@example.com'
    expect(await userRow(email)).toBeUndefined()

    const cookie = await signInByMagicLink(harness, email)

    const link = harness.sender.latestFor(email)
    expect(link?.url).toMatch(`${BASE_URL}/api/auth/magic-link/verify?token=`)
    const row = await userRow(email)
    expect(row).toMatchObject({ role: 'user', email_verified: true })
    const signedIn = await requireActiveUser(headersWith(cookie), harness.auth)
    expect(signedIn.user).toMatchObject({ email, role: 'user', emailVerified: true })
    expect(signedIn.user.id).toBe(row?.id)
  })

  it('stores only a hash of the link token', async () => {
    const email = 'hashed.token@example.com'
    await requestMagicLink(harness, email)
    const token = new URL(harness.sender.latestFor(email)?.url ?? '').searchParams.get('token')
    const rows = await harness.database.sql('select identifier from better_auth.verification')
    expect(token).toBeTruthy()
    expect(rows.map((row) => row.identifier)).not.toContain(token)
  })

  it('a link works once', async () => {
    const email = 'once@example.com'
    await signInByMagicLink(harness, email)
    const link = harness.sender.latestFor(email)
    const again = await harness.routes.GET(
      new Request(link?.url ?? '', { headers: ipHeaders(email) }),
    )
    expect(cookieHeader(again)).not.toContain('session_token')
    expect(again.headers.get('location')).toContain('error=INVALID_TOKEN')
  })

  it('refuses a request without a Turnstile token, and sends nothing', async () => {
    const email = 'no.captcha@example.com'
    const response = await requestMagicLink(harness, email, null)
    expect(response.status).toBe(400)
    expect(harness.sender.latestFor(email)).toBeUndefined()
  })

  it('refuses a request whose Turnstile token fails verification', async () => {
    const email = 'bad.captcha@example.com'
    const before = harness.turnstile.verifications
    const response = await requestMagicLink(harness, email, 'forged-token')
    expect(response.status).toBe(403)
    expect(harness.turnstile.verifications).toBe(before + 1)
    expect(harness.sender.latestFor(email)).toBeUndefined()
  })
})

describe('admin role', () => {
  it('requireAdmin refuses a signed-in user without the admin role', async () => {
    const cookie = await signInByMagicLink(harness, 'plain@example.com')
    await expect(requireAdmin(headersWith(cookie), harness.auth)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('requireAdmin admits an admin', async () => {
    const cookie = await signInByMagicLink(harness, FOUNDER)
    const signedIn = await requireAdmin(headersWith(cookie), harness.auth)
    expect(signedIn.user.role).toBe('admin')
  })

  it('refuses everyone when nobody is signed in', async () => {
    const headers = new Headers({ origin: BASE_URL })
    expect(await getSession(headers, harness.auth)).toBeNull()
    await expect(requireUser(headers, harness.auth)).rejects.toBeInstanceOf(UnauthenticatedError)
    await expect(requireActiveUser(headers, harness.auth)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    )
    await expect(requireAdmin(headers, harness.auth)).rejects.toBeInstanceOf(UnauthenticatedError)
  })

  it('a user cannot give themselves a role through the API', async () => {
    const cookie = await signInByMagicLink(harness, 'climber@example.com')
    const response = await harness.routes.POST(
      new Request(`${BASE_URL}/api/auth/update-user`, {
        method: 'POST',
        headers: { cookie, origin: BASE_URL, 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'admin' }),
      }),
    )
    expect(response.status).toBe(400)
    expect((await userRow('climber@example.com'))?.role).toBe('user')
  })
})

describe('founder bootstrap from ADMIN_EMAILS', () => {
  it('gives a new founder account the admin role on first sign-in', async () => {
    const email = 'Second.Founder@Example.com'
    const auth = harness.withAdminEmails([FOUNDER, 'second.founder@example.com'])
    const local = { ...harness, auth, routes: { GET: auth.handler, POST: auth.handler } }
    await signInByMagicLink(local, email)
    expect(await userRow(email.toLowerCase())).toMatchObject({
      role: 'admin',
      email_verified: true,
    })
  })

  it('promotes an account seeded by seed_founders, and verifies it on sign-in', async () => {
    const email = 'seeded@example.com'
    await harness.database.sql('select better_auth.seed_founders($1)', [[email]])
    expect(await userRow(email)).toMatchObject({ role: 'admin', email_verified: false })
    const auth = harness.withAdminEmails([email])
    const local = { ...harness, auth, routes: { GET: auth.handler, POST: auth.handler } }
    const cookie = await signInByMagicLink(local, email)
    expect(await userRow(email)).toMatchObject({ role: 'admin', email_verified: true })
    await expect(requireAdmin(headersWith(cookie), auth)).resolves.toBeTruthy()
  })

  it('promotes an existing user once their address is added to ADMIN_EMAILS', async () => {
    const email = 'staff@example.com'
    await signInByMagicLink(harness, email)
    expect((await userRow(email))?.role).toBe('user')
    const auth = harness.withAdminEmails([FOUNDER, email])
    const local = { ...harness, auth, routes: { GET: auth.handler, POST: auth.handler } }
    await signInByMagicLink(local, email)
    expect((await userRow(email))?.role).toBe('admin')
  })

  it('does not promote other addresses', async () => {
    await signInByMagicLink(harness, 'founder@example.com.evil.test')
    expect((await userRow('founder@example.com.evil.test'))?.role).toBe('user')
  })
})

describe('sign-out', () => {
  it('revokes the session in the database, so the old cookie no longer works', async () => {
    const email = 'leaver@example.com'
    const cookie = await signInByMagicLink(harness, email)
    const id = (await userRow(email))?.id as string
    expect(await sessionCount(id)).toBe(1)

    const response = await harness.routes.POST(
      new Request(`${BASE_URL}/api/auth/sign-out`, {
        method: 'POST',
        headers: { cookie, origin: BASE_URL },
      }),
    )
    expect(response.status).toBe(200)
    expect(await sessionCount(id)).toBe(0)

    // Replaying the pre-sign-out cookies, including the five-minute cookie cache, gets nothing.
    expect(await getSession(headersWith(cookie), harness.auth)).toBeNull()
    await expect(requireUser(headersWith(cookie), harness.auth)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    )
  })
})

describe('account standing', () => {
  async function restrict(
    email: string,
    banExpires: Date | null,
    reason = 'chargeback abuse',
    policy: string | null = null,
  ) {
    // Better Auth's ban fields set directly, as an older row or a manual fix would leave them.
    await harness.database.sql(
      `update better_auth."user" set banned = true, ban_reason = $2, restriction_policy = $4,
         ban_expires = ($3::timestamptz at time zone 'UTC') where email = $1`,
      [email, reason, banExpires?.toISOString() ?? null, policy],
    )
  }

  async function refusal(promise: Promise<unknown>): Promise<AccountRestrictedError> {
    const error = await promise.then(
      () => undefined,
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(AccountRestrictedError)
    return error as AccountRestrictedError
  }

  /** The notice names the step and the policy, offers the review, and says nothing else. */
  function expectNotice(
    error: AccountRestrictedError,
    step: RestrictionStep,
    policy: RestrictionPolicy,
  ) {
    expect(error.message).toBe(accountRestrictedNotice(step, policy))
    expect(error.status).toBe(403)
    expect(error.reviewOffer).toBe('You can ask for a review within 30 days.')
    const json = JSON.parse(JSON.stringify(error))
    expect(json).toEqual({
      code: 'auth.account_restricted',
      message: accountRestrictedNotice(step, policy),
      step,
      policy,
      reviewWithinDays: 30,
    })
    expect(AuthError.parse(json)).toEqual(json)
    expect(JSON.stringify(json)).not.toMatch(/chargeback|abuse|scans|evidence|until|20\d\d/i)
  }

  it('refuses a banned user with the notice, never the reason', async () => {
    const email = 'banned@example.com'
    const cookie = await signInByMagicLink(harness, email)
    await restrict(email, null)
    expectNotice(
      await refusal(requireActiveUser(headersWith(cookie), harness.auth)),
      'banned',
      'terms',
    )
    expectNotice(await refusal(requireAdmin(headersWith(cookie), harness.auth)), 'banned', 'terms')
    // Still signed in, so the app can show the notice and offer sign-out.
    await expect(requireUser(headersWith(cookie), harness.auth)).resolves.toBeTruthy()
  })

  it('refuses a suspended user until the suspension ends, naming the policy', async () => {
    const email = 'suspended@example.com'
    const cookie = await signInByMagicLink(harness, email)
    const until = new Date(Date.now() + 7 * 24 * 3600 * 1000)
    await restrict(email, until, 'too many scans', 'fair-use')
    expectNotice(
      await refusal(requireActiveUser(headersWith(cookie), harness.auth)),
      'suspended',
      'fair-use',
    )
    const after = new Date(until.getTime() + 1000)
    await expect(requireActiveUser(headersWith(cookie), harness.auth, after)).resolves.toBeTruthy()
  })

  it('admits a user whose suspension has lapsed', async () => {
    const email = 'lapsed@example.com'
    const cookie = await signInByMagicLink(harness, email)
    await restrict(email, new Date(Date.now() - 60_000))
    await expect(requireActiveUser(headersWith(cookie), harness.auth)).resolves.toBeTruthy()
  })

  it('never returns the ban reason from the API, even to the restricted user', async () => {
    const email = 'reason.hidden@example.com'
    const cookie = await signInByMagicLink(harness, email)
    await restrict(email, null, 'secret internal reason')
    const response = await harness.routes.GET(
      new Request(`${BASE_URL}/api/auth/get-session?disableCookieCache=true`, {
        headers: { cookie, origin: BASE_URL },
      }),
    )
    const body = await response.text()
    expect(body).toContain(email)
    expect(body).not.toContain('secret internal reason')
    expect(body).not.toContain('banReason')
    const signedIn = await requireUser(headersWith(cookie), harness.auth)
    expect(signedIn.user).not.toHaveProperty('banReason')
    expect((await userRow(email))?.ban_reason).toBe('secret internal reason')
  })

  it('restrictAccount records the policy, keeps the reason, revokes sessions; sign-in shows the notice', async () => {
    const email = 'restricted.by.module@example.com'
    const cookie = await signInByMagicLink(harness, email)
    const id = (await userRow(email))?.id as string
    await signInByMagicLink(harness, FOUNDER)
    const actorUserId = (await userRow(FOUNDER))?.id as string
    await restrictAccount(
      {
        actorUserId,
        userId: id,
        policy: 'acceptable-use',
        until: new Date(Date.now() + 24 * 3600 * 1000),
        reason: 'internal evidence',
      },
      harness.auth,
    )
    expect(await sessionCount(id)).toBe(0)
    expect(await userRow(email)).toMatchObject({ banned: true, ban_reason: 'internal evidence' })
    await expect(requireActiveUser(headersWith(cookie), harness.auth)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    )

    // Signing in again is refused with the notice only.
    await requestMagicLink(harness, email)
    const link = harness.sender.latestFor(email)
    const verified = await harness.routes.GET(
      new Request(link?.url ?? '', { headers: ipHeaders(email) }),
    )
    expect(verified.status).toBe(403)
    expect(cookieHeader(verified)).not.toContain('session_token')
    const body = await verified.text()
    expect(JSON.parse(body)).toMatchObject({
      code: 'ACCOUNT_RESTRICTED',
      message: 'Your account has been suspended under our Acceptable Use Policy.',
    })
    expect(body).not.toContain('internal evidence')

    await liftRestriction({ actorUserId, userId: id }, harness.auth)
    await signInByMagicLink(harness, email)
  })

  it('jobs acting for a user check standing on the app and pipeline roles', async () => {
    const active = await userRow('new.user@example.com')
    const banned = await userRow('banned@example.com')
    const suspended = await userRow('suspended@example.com')
    for (const role of ['nabvy_app', 'nabvy_pipeline'] as const) {
      await harness.database.as(role, async (db) => {
        expect(await isAccountActive(db, active?.id as string)).toBe(true)
        await expect(assertAccountActive(db, active?.id as string)).resolves.toBeUndefined()
        expect(await isAccountActive(db, banned?.id as string)).toBe(false)
        expectNotice(
          await refusal(assertAccountActive(db, banned?.id as string)),
          'banned',
          'terms',
        )
        expectNotice(
          await refusal(assertAccountActive(db, suspended?.id as string)),
          'suspended',
          'fair-use',
        )
        // Unknown users are not acted for.
        const unknown = '00000000-0000-4000-8000-000000000000'
        expect(await isAccountActive(db, unknown)).toBe(false)
        await expect(assertAccountActive(db, unknown)).rejects.toBeInstanceOf(UnauthenticatedError)
      })
    }
  })
})

describe('Better Auth admin endpoints: reads only, every change goes through the audited functions', () => {
  let adminCookie: string | undefined
  it.each([
    ['impersonate-user', (id: string) => ({ userId: id })],
    ['set-role', (id: string) => ({ userId: id, role: 'admin' })],
    ['remove-user', (id: string) => ({ userId: id })],
    ['create-user', () => ({ email: 'made@example.com', name: '', password: 'x'.repeat(12) })],
    ['ban-user', (id: string) => ({ userId: id, banReason: 'unaudited' })],
    ['unban-user', (id: string) => ({ userId: id })],
    ['revoke-user-sessions', (id: string) => ({ userId: id })],
    ['update-user', (id: string) => ({ userId: id, data: { role: 'admin' } })],
  ])('an admin cannot %s', async (endpoint, body) => {
    adminCookie ??= await signInByMagicLink(harness, FOUNDER)
    const target = (await userRow('plain@example.com'))?.id as string
    const response = await harness.routes.POST(
      new Request(`${BASE_URL}/api/auth/admin/${endpoint}`, {
        method: 'POST',
        headers: { cookie: adminCookie, origin: BASE_URL, 'content-type': 'application/json' },
        body: JSON.stringify(body(target)),
      }),
    )
    expect(response.status).toBe(403)
    expect(await userRow('plain@example.com')).toMatchObject({ role: 'user', banned: false })
  })

  it('an admin can still list users', async () => {
    adminCookie ??= await signInByMagicLink(harness, FOUNDER)
    const response = await harness.routes.GET(
      new Request(`${BASE_URL}/api/auth/admin/list-users`, {
        headers: { cookie: adminCookie, origin: BASE_URL },
      }),
    )
    expect(response.status).toBe(200)
  })
})

describe('rate limits', () => {
  it('allows 5 magic-link emails an hour per address, then refuses without sending', async () => {
    const email = 'eager@example.com'
    for (let i = 0; i < 5; i++) {
      // A different client each time, so only the per-address limit applies.
      const response = await requestMagicLink(harness, email, PASS_TOKEN, `198.51.100.${i + 1}`)
      expect(response.status).toBe(200)
    }
    const sent = harness.sender.sent.filter((link) => link.email === email).length
    const refused = await requestMagicLink(harness, email, PASS_TOKEN, '198.51.100.99')
    expect(refused.status).toBe(429)
    expect(harness.sender.sent.filter((link) => link.email === email).length).toBe(sent)
    // The counter key holds a hash of the address, never the address.
    const keys = await harness.database.sql('select key from better_auth.rate_limit')
    expect(JSON.stringify(keys)).not.toContain(email)
  })

  it('holds at exactly 5 per address when requests arrive at the same time', async () => {
    const email = 'burst@example.com'
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        requestMagicLink(harness, email, PASS_TOKEN, `192.0.2.${i + 1}`),
      ),
    )
    const statuses = responses.map((response) => response.status).sort()
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429, 429, 429, 429])
    expect(harness.sender.sent.filter((link) => link.email === email)).toHaveLength(5)
  })

  it('allows 5 sign-in requests an hour per IP, in the shared Postgres counter', async () => {
    const ip = '203.0.113.7'
    for (let i = 0; i < 5; i++) {
      const response = await requestMagicLink(harness, `ip.user${i}@example.com`, PASS_TOKEN, ip)
      expect(response.status).toBe(200)
    }
    const refused = await requestMagicLink(harness, 'ip.user5@example.com', PASS_TOKEN, ip)
    expect(refused.status).toBe(429)
    expect(harness.sender.latestFor('ip.user5@example.com')).toBeUndefined()
    const [row] = await harness.database.sql(
      "select count from better_auth.rate_limit where key like '%203.0.113.7%'",
    )
    expect(Number(row?.count)).toBe(5)
  })

  it('Google sign-in also needs a Turnstile token', async () => {
    const response = await harness.routes.POST(
      new Request(`${BASE_URL}/api/auth/sign-in/social`, {
        method: 'POST',
        headers: { origin: BASE_URL, 'content-type': 'application/json', ...ipHeaders('google') },
        body: JSON.stringify({ provider: 'google' }),
      }),
    )
    expect(response.status).toBe(400)
  })
})
