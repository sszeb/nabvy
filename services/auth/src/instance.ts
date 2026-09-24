import { EnvError, type EnvSource, loadEnv } from '@nabvy/config'
import { createDb } from '@nabvy/db'
import { type Auth, createAuth } from './auth'
import { createResendMagicLinkSender } from './email/magic-link'

/**
 * Builds the production instance from the environment (docs/secrets.md): BETTER_AUTH_*,
 * ADMIN_EMAILS, DATABASE_URL_AUTH, the Turnstile keys and the Resend key are required; Google
 * sign-in is switched on once both GOOGLE_OAUTH_* variables are set. Missing or malformed
 * variables stop start-up with an `EnvError` that names them.
 */
export function createAuthFromEnv(source?: EnvSource): Auth {
  const env = loadEnv(['auth', 'authDatabase', 'captcha', 'email'], source)
  return createAuth({
    db: createDb(env.DATABASE_URL_AUTH).db,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    adminEmails: env.ADMIN_EMAILS,
    magicLinkSender: createResendMagicLinkSender({ apiKey: env.RESEND_API_KEY }),
    turnstile: { secretKey: env.TURNSTILE_SECRET_KEY },
    ...optionalGoogle(source),
  })
}

function optionalGoogle(source?: EnvSource): {
  google?: { clientId: string; clientSecret: string }
} {
  try {
    const env = loadEnv(['googleOAuth'], source)
    return {
      google: {
        clientId: env.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      },
    }
  } catch (error) {
    // Neither variable set: Google sign-in is off. One without the other is a mistake.
    if (error instanceof EnvError && error.missing.length === 2) return {}
    throw error
  }
}

let instance: Auth | undefined

/** The process-wide instance, created from the environment on first use. */
export function getAuth(): Auth {
  instance ??= createAuthFromEnv()
  return instance
}
