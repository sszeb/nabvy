import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createAuth, createRecordingMagicLinkSender } from '@nabvy/auth'
import { createDb } from '@nabvy/db'
import { expect, test } from '@playwright/test'
import { GATE_BASE_URL, GATE_DATABASE_URL, GATE_FOUNDER, GATE_SECRET } from './admin-gate.env'

/**
 * The admin gate, end to end (task 4.3af; docs/design/admin-hardening.md H1, H13, A1, A11):
 * plain HTTP against the production build, no browser. Nobody signed in gets 401, a signed-in
 * plain user gets 403, and neither response carries admin data. An admin passes the gate, and the
 * production build then refuses the admin fixtures rather than show them as real.
 *
 * Sessions are made through the auth module on the same database and secret as the server
 * (admin-gate.env.ts), by the magic-link flow, exactly as a browser would get them.
 */

const ADMIN_PATHS = ['/admin', '/admin/review'] as const
// Text that only a rendered admin page carries (a refused response still resolves the route's
// static title): its absence proves nothing admin was rendered.
const ADMIN_MARKERS = ['Actor spend today', 'Facebook collection', 'Correct a field']

test('nobody signed in: 401, no admin data, not indexed', async ({ request }) => {
  for (const path of ADMIN_PATHS) {
    const response = await request.get(path, { maxRedirects: 0 })
    expect(response.status(), path).toBe(401)
    const html = await response.text()
    for (const marker of ADMIN_MARKERS)
      expect(html, `${path} shows ${marker}`).not.toContain(marker)
    expect(html, `${path} is indexable`).toMatch(/<meta name="robots" content="noindex/)
  }
})

test.describe('signed in', () => {
  test.skip(
    !GATE_DATABASE_URL,
    'needs DATABASE_URL pointing at a migrated Postgres (CI: the migration dry-run job)',
  )

  let sessions: Sessions
  test.beforeAll(async () => {
    sessions = await startSessions(GATE_DATABASE_URL as string)
  })
  test.afterAll(async () => {
    await sessions?.close()
  })

  test('a plain user: 403 and no admin data', async ({ request }) => {
    const cookie = await sessions.signIn(`user-${randomBytes(4).toString('hex')}@example.com`)
    for (const path of ADMIN_PATHS) {
      const response = await request.get(path, { headers: { cookie }, maxRedirects: 0 })
      expect(response.status(), path).toBe(403)
      const html = await response.text()
      for (const marker of ADMIN_MARKERS)
        expect(html, `${path} shows ${marker}`).not.toContain(marker)
    }
  })

  test('an admin passes the gate, and the production build refuses the fixtures', async ({
    request,
  }) => {
    const cookie = await sessions.signIn(GATE_FOUNDER)
    for (const path of ADMIN_PATHS) {
      const response = await request.get(path, { headers: { cookie }, maxRedirects: 0 })
      expect([401, 403], `${path} refused an admin`).not.toContain(response.status())
      // H13: `next start` is a production build, so the fixture reads throw (500) instead of
      // rendering placeholder spend and runs as if they were real.
      expect(response.status(), path).toBe(500)
      const html = await response.text()
      for (const marker of ADMIN_MARKERS)
        expect(html, `${path} shows ${marker}`).not.toContain(marker)
    }
  })
})

interface Sessions {
  /** Signs an address in by magic link and returns its session cookie header. */
  signIn(email: string): Promise<string>
  close(): Promise<void>
}

async function startSessions(databaseUrl: string): Promise<Sessions> {
  const turnstile = await startFakeTurnstile()
  const sender = createRecordingMagicLinkSender()
  const handle = createDb(databaseUrl)
  const auth = createAuth({
    db: handle.db,
    baseURL: GATE_BASE_URL,
    secret: GATE_SECRET,
    adminEmails: [GATE_FOUNDER],
    magicLinkSender: sender,
    turnstile: { secretKey: 'e2e-only', siteVerifyURL: turnstile.url },
    quiet: true,
  })
  // One client address per sign-in, so a re-run never trips the per-IP sign-in limit.
  const clientAddress = () => `10.${randomBytes(3).join('.')}`
  return {
    async signIn(email) {
      const ip = clientAddress()
      const requested = await auth.handler(
        new Request(`${GATE_BASE_URL}/api/auth/sign-in/magic-link`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: GATE_BASE_URL,
            'x-forwarded-for': ip,
            'x-captcha-response': PASS_TOKEN,
          },
          body: JSON.stringify({ email, callbackURL: '/app' }),
        }),
      )
      expect(requested.status, 'magic-link request').toBe(200)
      const link = sender.latestFor(email)
      if (!link) throw new Error(`no magic link recorded for ${email}`)
      const verified = await auth.handler(
        new Request(link.url, { headers: { origin: GATE_BASE_URL, 'x-forwarded-for': ip } }),
      )
      const cookie = verified.headers
        .getSetCookie()
        .map((line) => line.split(';')[0] ?? '')
        .filter((pair) => pair.includes('session_token') && !pair.endsWith('='))
        .join('; ')
      if (!cookie) throw new Error(`sign-in failed: ${verified.status}`)
      return cookie
    },
    async close() {
      await turnstile.close()
      await handle.pool.end()
    },
  }
}

// A local stand-in for Cloudflare Turnstile's siteverify endpoint, as services/auth's tests use.
const PASS_TOKEN = 'turnstile-e2e-pass'

async function startFakeTurnstile(): Promise<{ url: string; close(): Promise<void> }> {
  const server: Server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      const { response: token } = JSON.parse(body || '{}') as { response?: string }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(token === PASS_TOKEN ? { success: true } : { success: false }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/siteverify`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
