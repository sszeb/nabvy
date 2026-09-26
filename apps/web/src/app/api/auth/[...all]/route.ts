import type { MagicLinkSender } from '@nabvy/auth'
import {
  type Auth,
  createAuth,
  createAuthRouteHandlers,
  createResendMagicLinkSender,
} from '@nabvy/auth'
import { loadEnv, safeLoadEnv } from '@nabvy/config'
import { createDb } from '@nabvy/db'

export const runtime = 'nodejs' // node-postgres needs Node, not the edge runtime

/**
 * The local single-user run's own composition root (task L1; `docs/decisions.md`, "Local
 * single-user run first"): sign-in by magic link, printed to the server terminal when no email
 * provider is configured (`RESEND_API_KEY`/`RESEND_WEBHOOK_SECRET` unset), instead of
 * `@nabvy/auth`'s own `createAuthFromEnv()`, which always sends through Resend
 * (services/auth/src/instance.ts). Everything else — the database, the admin gate, Turnstile —
 * is unchanged: nothing here is bypassed. `createAuthRouteHandlers`'s `resolve` hook keeps this
 * in apps/web, never in services/auth (a module session edits only its own folder).
 */
function terminalMagicLinkSender(): MagicLinkSender {
  return {
    async send({ email, url }) {
      console.log(`\nNabvy sign-in link for ${email}:\n${url}\n`)
    },
  }
}

let cached: Auth | undefined

function resolve(): Auth {
  if (!cached) cached = buildAuth()
  return cached
}

function buildAuth(): Auth {
  const base = loadEnv(['auth', 'authDatabase', 'captcha'])
  const email = safeLoadEnv(['email'])
  const google = safeLoadEnv(['googleOAuth'])
  return createAuth({
    db: createDb(base.DATABASE_URL_AUTH).db,
    baseURL: base.BETTER_AUTH_URL,
    secret: base.BETTER_AUTH_SECRET,
    adminEmails: base.ADMIN_EMAILS,
    magicLinkSender: email.success
      ? createResendMagicLinkSender({ apiKey: email.data.RESEND_API_KEY })
      : terminalMagicLinkSender(),
    turnstile: { secretKey: base.TURNSTILE_SECRET_KEY },
    ...(google.success
      ? {
          google: {
            clientId: google.data.GOOGLE_OAUTH_CLIENT_ID,
            clientSecret: google.data.GOOGLE_OAUTH_CLIENT_SECRET,
          },
        }
      : {}),
  })
}

export const { GET, POST } = createAuthRouteHandlers(resolve)
