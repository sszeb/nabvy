import { ACCOUNT_RESTRICTED_MESSAGE, AuthError } from '@nabvy/contracts/modules/auth'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
  requestMagicLink,
  signInByMagicLink,
} from './support/harness'

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
    const again = await harness.routes.GET(new Request(link?.url ?? ''))
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
  async function restrict(email: string, banExpires: Date | null, reason = 'chargeback abuse') {
    // What the account-integrity module will do: set Better Auth's ban fields directly.
    await harness.database.sql(
      `update better_auth."user" set banned = true, ban_reason = $2,
         ban_expires = ($3::timestamptz at time zone 'UTC') where email = $1`,
      [email, reason, banExpires?.toISOString() ?? null],
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

  function expectVague(error: AccountRestrictedError): void {
    expect(error.message).toBe(ACCOUNT_RESTRICTED_MESSAGE)
    expect(error.status).toBe(403)
    const json = JSON.parse(JSON.stringify(error))
    expect(json).toEqual({ code: 'auth.account_restricted', message: ACCOUNT_RESTRICTED_MESSAGE })
    expect(AuthError.parse(json)).toEqual(json)
    expect(JSON.stringify(json)).not.toMatch(/chargeback|abuse|ban|suspend|until|20\d\d/i)
  }

  it('refuses a banned user with the vague message, never the reason', async () => {
    const email = 'banned@example.com'
    const cookie = await signInByMagicLink(harness, email)
    await restrict(email, null)
    expectVague(await refusal(requireActiveUser(headersWith(cookie), harness.auth)))
    expectVague(await refusal(requireAdmin(headersWith(cookie), harness.auth)))
    // Still signed in, so the app can show the notice and offer sign-out.
    await expect(requireUser(headersWith(cookie), harness.auth)).resolves.toBeTruthy()
  })

  it('refuses a suspended user until the suspension ends', async () => {
    const email = 'suspended@example.com'
    const cookie = await signInByMagicLink(harness, email)
    const until = new Date(Date.now() + 7 * 24 * 3600 * 1000)
    await restrict(email, until, 'fair use: too many scans')
    expectVague(await refusal(requireActiveUser(headersWith(cookie), harness.auth)))
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

  it('an admin ban revokes sessions, and sign-in shows only the vague notice', async () => {
    const adminCookie = await signInByMagicLink(harness, FOUNDER)
    const email = 'admin.banned@example.com'
    const userCookie = await signInByMagicLink(harness, email)
    const id = (await userRow(email))?.id as string

    const response = await harness.routes.POST(
      new Request(`${BASE_URL}/api/auth/admin/ban-user`, {
        method: 'POST',
        headers: { cookie: adminCookie, origin: BASE_URL, 'content-type': 'application/json' },
        body: JSON.stringify({ userId: id, banReason: 'internal evidence' }),
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.text()).not.toContain('internal evidence')
    expect(await sessionCount(id)).toBe(0)
    await expect(requireActiveUser(headersWith(userCookie), harness.auth)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    )

    // Signing in again is refused with the vague notice only.
    await requestMagicLink(harness, email)
    const link = harness.sender.latestFor(email)
    const verified = await harness.routes.GET(new Request(link?.url ?? ''))
    expect(verified.status).toBe(403)
    expect(cookieHeader(verified)).not.toContain('session_token')
    const body = await verified.text()
    expect(JSON.parse(body).message).toBe(ACCOUNT_RESTRICTED_MESSAGE)
    expect(body).not.toContain('internal evidence')
  })

  it('jobs acting for a user check standing on the app and pipeline roles', async () => {
    const active = await userRow('new.user@example.com')
    const banned = await userRow('banned@example.com')
    for (const role of ['nabvy_app', 'nabvy_pipeline'] as const) {
      await harness.database.as(role, async (db) => {
        expect(await isAccountActive(db, active?.id as string)).toBe(true)
        await expect(assertAccountActive(db, active?.id as string)).resolves.toBeUndefined()
        expect(await isAccountActive(db, banned?.id as string)).toBe(false)
        expectVague(await refusal(assertAccountActive(db, banned?.id as string)))
        // Unknown users are not acted for.
        expect(await isAccountActive(db, '00000000-0000-4000-8000-000000000000')).toBe(false)
      })
    }
  })
})
