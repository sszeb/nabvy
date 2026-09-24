import { type Auth, createAuth } from '../../src/auth'
import {
  createRecordingMagicLinkSender,
  type RecordingMagicLinkSender,
} from '../../src/email/magic-link'
import { createAuthRouteHandlers } from '../../src/route-handler'
import { createTestDatabase, type TestDatabase } from './database'
import { type FakeTurnstile, PASS_TOKEN, startFakeTurnstile } from './turnstile'

export const BASE_URL = 'http://localhost:3000'
export const FOUNDER = 'founder@example.com'

export interface Harness {
  auth: Auth
  database: TestDatabase
  sender: RecordingMagicLinkSender
  turnstile: FakeTurnstile
  /** The mounted /api/auth/* handlers, as apps/web would export them. */
  routes: ReturnType<typeof createAuthRouteHandlers>
  /** Another instance on the same database, e.g. with a different ADMIN_EMAILS. */
  withAdminEmails(adminEmails: readonly string[]): Auth
  close(): Promise<void>
}

export async function createHarness(adminEmails: readonly string[] = [FOUNDER]): Promise<Harness> {
  const database = await createTestDatabase()
  const sender = createRecordingMagicLinkSender()
  const turnstile = await startFakeTurnstile()
  const build = (emails: readonly string[]) =>
    createAuth({
      db: database.db,
      baseURL: BASE_URL,
      secret: 'test-only-secret-that-is-at-least-32-characters-long',
      adminEmails: emails,
      magicLinkSender: sender,
      turnstile: { secretKey: 'test-only-turnstile-secret', siteVerifyURL: turnstile.url },
      quiet: true,
    })
  const auth = build(adminEmails)
  return {
    auth,
    database,
    sender,
    turnstile,
    routes: createAuthRouteHandlers(() => auth),
    withAdminEmails: build,
    async close() {
      await turnstile.close()
      await database.close()
    },
  }
}

/** Cookies from Set-Cookie headers, as a browser would send them back. */
export function cookieHeader(response: Response, previous = ''): string {
  const jar = new Map<string, string>()
  for (const pair of previous.split('; ').filter(Boolean)) {
    const [name, ...value] = pair.split('=')
    jar.set(name as string, value.join('='))
  }
  for (const line of response.headers.getSetCookie()) {
    const [pair = ''] = line.split(';')
    const [name, ...value] = pair.split('=')
    const expired = /max-age=0/i.test(line) || value.join('=') === ''
    if (expired) jar.delete(name as string)
    else jar.set(name as string, value.join('='))
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
}

export function headersWith(cookie: string): Headers {
  return new Headers({ cookie, origin: BASE_URL })
}

/** POST /api/auth/sign-in/magic-link through the mounted handler. */
export function requestMagicLink(
  harness: Harness,
  email: string,
  captcha: string | null = PASS_TOKEN,
): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json', origin: BASE_URL })
  if (captcha !== null) headers.set('x-captcha-response', captcha)
  return harness.routes.POST(
    new Request(`${BASE_URL}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, callbackURL: '/dashboard' }),
    }),
  )
}

/** Requests a link, follows it from the recording sender, and returns the session cookie. */
export async function signInByMagicLink(harness: Harness, email: string): Promise<string> {
  const requested = await requestMagicLink(harness, email)
  if (requested.status !== 200) throw new Error(`magic link request: ${requested.status}`)
  const link = harness.sender.latestFor(email)
  if (!link) throw new Error(`no magic link recorded for ${email}`)
  const verified = await harness.routes.GET(
    new Request(link.url, { headers: { origin: BASE_URL } }),
  )
  const cookie = cookieHeader(verified)
  if (!cookie.includes('session_token')) {
    throw new Error(`sign-in failed: ${verified.status} ${verified.headers.get('location')}`)
  }
  return cookie
}
