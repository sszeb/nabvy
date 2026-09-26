import { randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createAuth, createRecordingMagicLinkSender } from '@nabvy/auth'
import { safeLoadEnv } from '@nabvy/config'
import { createDb, withPipeline } from '@nabvy/db'
import { set as setSwitch } from '@nabvy/switches'
import { expect, test } from '@playwright/test'
import { sql } from 'drizzle-orm'
import { GATE_BASE_URL, GATE_DATABASE_URL, GATE_FOUNDER, GATE_SECRET } from './admin-gate.env'

/**
 * Task L1 ("Web app for the local run", `docs/backlog.md` "Milestone L"): sign-in, create a
 * want, see the feed, open a listing, flip a switch as admin. Needs a migrated Postgres in both
 * `DATABASE_URL` and `DATABASE_URL_PIPELINE` (CI's migration dry-run job; `admin-gate.spec.ts`
 * skips its own signed-in cases the same way locally, with no Postgres in this sandbox).
 *
 * Two real gaps this suite works around rather than papering over (both recorded in
 * docs/questions/L1-web.md):
 * - `app.v_listing_card` has no migration yet (listing-card, PR #81, has not merged), so no real
 *   listing can exist in this database. "See the feed" and "open a listing" prove the routes and
 *   procedures work end to end against an empty feed and a missing listing, honestly, rather
 *   than fabricate a card.
 * - The sign-in widget itself needs Cloudflare's real Turnstile CDN to render a token; getting
 *   one is exercised the same way `admin-gate.spec.ts` already does (a local fake siteverify
 *   server, a direct API call to `/api/auth/sign-in/magic-link`), and the resulting session
 *   cookie is injected into the browser. The UI-level checks below (the form, the redirect, the
 *   rendered screens) still run in a real browser.
 */

const PLAIN_USER = `user-${randomBytes(4).toString('hex')}@example.com`

const pipelineDatabase = safeLoadEnv(['pipelineDatabase'])

test.describe("L1: the owner's local run", () => {
  test.skip(
    !GATE_DATABASE_URL,
    'needs DATABASE_URL pointing at a migrated Postgres (CI: the migration dry-run job)',
  )
  test.skip(
    !pipelineDatabase.success,
    'needs DATABASE_URL_PIPELINE to turn on want-manager, location and pickup-location for the test',
  )

  let sessions: Sessions
  test.beforeAll(async () => {
    sessions = await startSessions(GATE_DATABASE_URL as string)
    for (const name of ['want-manager', 'location', 'pickup-location']) {
      await sessions.turnOn(name)
    }
  })
  test.afterAll(async () => {
    await sessions?.close()
  })

  test('sign-in form asks for an email and disables submit until Turnstile has a token', async ({
    page,
  }) => {
    await page.goto('/sign-in')
    await expect(page.getByRole('heading', { name: 'Sign in to Nabvy' })).toBeVisible()
    await page.getByLabel('Email').fill(PLAIN_USER)
    // The button needs a real Turnstile token from Cloudflare's own widget, which this sandbox
    // does not drive; the sign-in request itself (and the session it returns) is proven by
    // `sessions.signIn()` below, the same call path the widget's token would unlock.
    await expect(page.getByRole('button', { name: 'Email me a sign-in link' })).toBeDisabled()
  })

  test('create a want, see it in the hunts list', async ({ page }) => {
    const cookie = await sessions.signIn(PLAIN_USER)
    await page.context().addCookies(toPlaywrightCookies(cookie, GATE_BASE_URL))
    await page.goto('/app/hunts/new')
    await page.getByLabel('What to look for').fill('rtx 3070')
    await page.getByLabel('Postcode').fill('PO19 1SB')
    await page.getByRole('button', { name: 'Create hunt' }).click()
    await expect(page).toHaveURL(/\/app\/hunts$/)
    await expect(page.getByText('rtx 3070')).toBeVisible()
  })

  test('the results feed renders (empty until listing-card ships)', async ({ page }) => {
    const cookie = await sessions.signIn(PLAIN_USER)
    await page.context().addCookies(toPlaywrightCookies(cookie, GATE_BASE_URL))
    const response = await page.goto('/app/deals')
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'Deals' })).toBeVisible()
  })

  test('opening an unknown listing 404s cleanly', async ({ page }) => {
    const cookie = await sessions.signIn(PLAIN_USER)
    await page.context().addCookies(toPlaywrightCookies(cookie, GATE_BASE_URL))
    const response = await page.goto(`/app/deal/${randomUUID()}`)
    expect(response?.status()).toBe(404)
  })

  test('an admin flips a switch, and it stays flipped on reload', async ({ page }) => {
    const cookie = await sessions.signIn(GATE_FOUNDER)
    await page.context().addCookies(toPlaywrightCookies(cookie, GATE_BASE_URL))
    await page.goto('/admin/switches')
    const row = page.getByRole('row', { name: /^scan-recognition/ })
    await row.getByRole('combobox').selectOption('on')
    await page.waitForTimeout(300) // the write and its audit row commit before the reload
    await page.reload()
    await expect(row.getByRole('combobox')).toHaveValue('on')
  })
})

function toPlaywrightCookies(cookieHeader: string, baseUrl: string) {
  const url = new URL(baseUrl)
  return cookieHeader
    .split(';')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=')
      return { name: pair.slice(0, eq), value: pair.slice(eq + 1), domain: url.hostname, path: '/' }
    })
}

interface Sessions {
  /** Signs an address in by magic link and returns its session cookie header. */
  signIn(email: string): Promise<string>
  /** Turns a module switch on, as the founder, once its account row exists (after its first
   * sign-in). */
  turnOn(name: string): Promise<void>
  close(): Promise<void>
}

// Close to admin-gate.spec.ts's own session helper (docs/session-conventions.md, "Context
// economy": that file owns the pattern; this is the smallest working copy, kept local so this
// spec has no cross-file coupling beyond the four exported constants it already imports).
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
  const pipelineUrl = pipelineDatabase.success ? pipelineDatabase.data.DATABASE_URL_PIPELINE : ''
  const pipeline = pipelineUrl ? createDb(pipelineUrl) : undefined
  const clientAddress = () => `10.${randomBytes(3).join('.')}`
  const signIn = async (email: string): Promise<string> => {
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
  }
  return {
    signIn,
    async turnOn(name) {
      if (!pipeline) return
      await signIn(GATE_FOUNDER) // ensures the founder's account row exists
      const result = await pipeline.db.execute<{ id: string }>(
        sql`select id from better_auth.user where email = ${GATE_FOUNDER}`,
      )
      const founder = result.rows[0]
      if (!founder) throw new Error('founder account not found after sign-in')
      await withPipeline(
        (tx) => setSwitch(tx, { actorUserId: founder.id, name, kind: 'module', state: 'on' }),
        pipeline.db,
      )
    },
    async close() {
      await turnstile.close()
      await handle.pool.end()
      await pipeline?.pool.end()
    },
  }
}

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
