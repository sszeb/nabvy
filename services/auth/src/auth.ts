import { createHash } from 'node:crypto'
import { rateLimits } from '@nabvy/config'
import { accountRestrictedNotice } from '@nabvy/contracts/modules/auth'
import { account, rateLimit, session, user, verification } from '@nabvy/db/schema/better-auth'
import { type BetterAuthPlugin, betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError } from 'better-auth/api'
import { admin, captcha, magicLink } from 'better-auth/plugins'
import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements } from 'better-auth/plugins/admin/access'
import { sql } from 'drizzle-orm'
import { promoteFounder, registerAuthDatabase } from './audited'
import { isFounderEmail, normaliseEmail } from './domain/founders'
import { restrictionOf } from './domain/standing'
import { type MagicLinkSender, magicLinkText } from './email/magic-link'

/** A Drizzle Postgres database, as the Drizzle adapter takes it (node-postgres in production). */
export type AuthDatabase = Parameters<typeof drizzleAdapter>[0]

export interface AuthOptions {
  /** Drizzle on DATABASE_URL_AUTH, connected as nabvy_auth (README.md, "Database role"). */
  db: AuthDatabase
  /** BETTER_AUTH_URL: the app's public origin. https everywhere except localhost. */
  baseURL: string
  /** BETTER_AUTH_SECRET: signs cookies and tokens. */
  secret: string
  /** ADMIN_EMAILS: founder addresses that receive the admin role on sign-in. */
  adminEmails: readonly string[]
  magicLinkSender: MagicLinkSender
  /** Cloudflare Turnstile on sign-in and sign-up. Required: sign-up spends the free tier. */
  turnstile: { secretKey: string; siteVerifyURL?: string }
  /** Google sign-in, when its OAuth client exists (docs/questions.md). */
  google?: { clientId: string; clientSecret: string }
  /** Silences Better Auth's logger (tests). */
  quiet?: boolean
}

// Sessions: database-backed, 30-day expiry, five-minute cookie cache (docs/security.md). The
// session helpers bypass the cookie cache, so a revoked session or a new restriction takes effect
// on the next request.
const SESSION_EXPIRES_IN = 60 * 60 * 24 * 30
const SESSION_UPDATE_AGE = 60 * 60 * 24
const COOKIE_CACHE_MAX_AGE = 60 * 5
export const MAGIC_LINK_EXPIRES_IN = 60 * 5

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The app's origin must be https, except a local development server. */
export function assertSecureBaseURL(baseURL: string): URL {
  const url = new URL(baseURL)
  if (url.protocol !== 'https:' && !LOCAL_HOSTS.has(url.hostname)) {
    throw new Error('BETTER_AUTH_URL must be https outside local development')
  }
  return url
}

/**
 * Keeps Better Auth's `banReason` out of every API response (session, sign-in, admin lists):
 * the reason behind a restriction stays internal (docs/decisions.md, "Fair use, suspension and
 * bans"). Later plugins' field definitions override earlier ones, so this runs after `admin`.
 * The column is still read and written.
 */
const privateBanReason = {
  id: 'nabvy-private-ban-reason',
  schema: {
    user: {
      fields: {
        banReason: { type: 'string', required: false, input: false, returned: false },
      },
    },
  },
} satisfies BetterAuthPlugin

/**
 * What an admin may do through `/api/auth/admin/*`: list and read users and sessions, nothing
 * that changes anything. Better Auth's endpoints cannot write `audit_log` in the transaction that
 * makes the change, so every admin action (role changes, restrictions, session revokes) goes
 * through this module's audited functions instead (admin.ts; docs/security.md). Impersonation,
 * user creation or removal, and password or email changes have no audited function and stay
 * refused.
 */
const ac = createAccessControl(defaultStatements)
const roles = {
  user: ac.newRole({ user: [], session: [] }),
  admin: ac.newRole({ user: ['list', 'get'], session: ['list'] }),
}

type SessionHookContext = {
  context: {
    internalAdapter: {
      findUserById(id: string): Promise<Record<string, unknown> | null>
    }
  }
}

/**
 * Runs before any session is created, whatever the sign-in method:
 * - a restricted account gets its notice (step and policy only), never a session;
 * - an unverified email address gets no session (email verification is required);
 * - an address in ADMIN_EMAILS that lacks the admin role is promoted by `promote`, which records
 *   the role change in audit_log (founder bootstrap).
 * Fails closed when there is no request context.
 */
export function guardSessionCreation(
  adminEmails: readonly string[],
  promote: (userId: string) => Promise<void>,
  now: () => Date = () => new Date(),
) {
  return async (data: { userId: string }, ctx: SessionHookContext | null | undefined) => {
    if (!ctx) return false
    const owner = await ctx.context.internalAdapter.findUserById(data.userId)
    if (!owner) return false
    const restriction = restrictionOf(owner, now())
    if (restriction) {
      throw APIError.from('FORBIDDEN', {
        code: 'ACCOUNT_RESTRICTED',
        message: accountRestrictedNotice(restriction.step, restriction.policy),
      })
    }
    if (owner.emailVerified !== true) {
      throw APIError.from('FORBIDDEN', {
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Verify your email address to sign in.',
      })
    }
    if (isFounderEmail(String(owner.email), adminEmails) && owner.role !== 'admin') {
      await promote(String(owner.id))
    }
    return undefined
  }
}

/**
 * Magic-link emails per address (docs/engineering.md: 5 an hour), counted in Better Auth's
 * Postgres rate-limit table under a key that holds a hash of the address, never the address.
 * `last_request` is the start of the current window. One `insert … on conflict do update`
 * statement takes the row lock, so requests arriving together are counted one after another and
 * exactly `max` get through; a refused request still counts, which only keeps the window shut.
 * Returns whether this request is within the limit.
 */
export async function consumeMagicLinkQuota(
  db: AuthDatabase,
  email: string,
  now: number = Date.now(),
): Promise<boolean> {
  const { max, windowSeconds } = rateLimits.magicLinkPerEmail
  const key = `nabvy:magic-link-email:${createHash('sha256').update(normaliseEmail(email)).digest('hex')}`
  const windowStart = now - windowSeconds * 1000
  const result = await db.execute(sql`
    insert into better_auth.rate_limit (key, count, last_request)
    values (${key}, 1, ${now})
    on conflict (key) do update set
      count = case when better_auth.rate_limit.last_request <= ${windowStart}
                   then 1 else better_auth.rate_limit.count + 1 end,
      last_request = case when better_auth.rate_limit.last_request <= ${windowStart}
                          then ${now} else better_auth.rate_limit.last_request end
    returning count`)
  const rows = (result as { rows: { count: number | string }[] }).rows
  return Number(rows[0]?.count) <= max
}

/** The Better Auth server instance (docs/decisions.md, "Authentication and authorisation"). */
export function createAuth(options: AuthOptions) {
  const base = assertSecureBaseURL(options.baseURL)
  const signUp = { window: rateLimits.signUpPerIp.windowSeconds, max: rateLimits.signUpPerIp.max }
  const auth = betterAuth({
    baseURL: options.baseURL,
    secret: options.secret,
    basePath: '/api/auth',
    database: drizzleAdapter(options.db, {
      provider: 'pg',
      schema: { user, session, account, verification, rateLimit },
    }),
    advanced: {
      // User IDs are UUIDs generated by the database (docs/contracts.md, "Identity").
      database: { generateId: 'uuid' },
      // Secure cookies whenever the app is served over https, which is everywhere but localhost.
      useSecureCookies: base.protocol === 'https:',
      // Vercel sets x-forwarded-for to the client address; the rate limiter keys on it.
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
    },
    telemetry: { enabled: false },
    ...(options.quiet ? { logger: { disabled: true } } : {}),
    // Postgres-backed counters shared by every instance, on in every environment
    // (docs/engineering.md, "Rate limits and abuse").
    rateLimit: {
      enabled: true,
      storage: 'database',
      customRules: { '/sign-in/magic-link': signUp, '/sign-in/social': signUp },
    },
    user: {
      additionalFields: {
        // The policy a restriction was taken under; set by this module, never by input.
        restrictionPolicy: { type: 'string', required: false, input: false },
      },
    },
    session: {
      expiresIn: SESSION_EXPIRES_IN,
      updateAge: SESSION_UPDATE_AGE,
      cookieCache: { enabled: true, maxAge: COOKIE_CACHE_MAX_AGE },
    },
    // No passwords: magic link and Google only.
    emailAndPassword: { enabled: false },
    ...(options.google
      ? {
          socialProviders: {
            google: {
              clientId: options.google.clientId,
              clientSecret: options.google.clientSecret,
            },
          },
        }
      : {}),
    // Founder bootstrap happens in the session guard, for new and existing accounts alike, so the
    // role change is recorded in audit_log: a new account has no ID to record before it exists.
    plugins: [
      // Before `admin`, whose own ban check would otherwise answer first with a fixed message.
      {
        id: 'nabvy-session-guard',
        init: () => ({
          options: {
            databaseHooks: {
              session: {
                create: {
                  before: guardSessionCreation(options.adminEmails, (userId) =>
                    promoteFounder(options.db, userId),
                  ) as never,
                },
              },
            },
          },
        }),
      } satisfies BetterAuthPlugin,
      magicLink({
        expiresIn: MAGIC_LINK_EXPIRES_IN,
        storeToken: 'hashed',
        sendMagicLink: async ({ email, url }, ctx) => {
          if (!ctx) throw new Error('magic link requested outside a request')
          if (!(await consumeMagicLinkQuota(options.db, email))) {
            throw APIError.from('TOO_MANY_REQUESTS', {
              code: 'TOO_MANY_MAGIC_LINKS',
              message: 'Too many sign-in links for this address. Try again later.',
            })
          }
          await options.magicLinkSender.send({
            email,
            url,
            text: magicLinkText(url, MAGIC_LINK_EXPIRES_IN),
          })
        },
      }),
      admin({
        ac,
        roles,
        defaultRole: 'user',
        adminRoles: ['admin'],
        // Only if Better Auth's own check fires before ours: a notice with no reason.
        bannedUserMessage: accountRestrictedNotice('banned', 'terms'),
      }),
      privateBanReason,
      captcha({
        provider: 'cloudflare-turnstile',
        secretKey: options.turnstile.secretKey,
        ...(options.turnstile.siteVerifyURL
          ? { siteVerifyURLOverride: options.turnstile.siteVerifyURL }
          : {}),
        // A magic-link request or a first Google sign-in is also the sign-up (docs/security.md).
        endpoints: ['/sign-in/magic-link', '/sign-in/social'],
      }),
    ],
  })
  registerAuthDatabase(auth, options.db)
  return auth
}

export type Auth = ReturnType<typeof createAuth>
