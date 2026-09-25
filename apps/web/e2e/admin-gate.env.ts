/**
 * The auth configuration the admin-gate test (admin-gate.spec.ts) and the server under test share
 * (playwright.config.ts passes it to `next start`). Placeholders only, never credentials: the
 * secret signs cookies for one local run, and Turnstile and Resend are never called. The
 * signed-in cases need a migrated Postgres in DATABASE_URL (CI's migration dry-run job provides
 * one); the anonymous case needs no database, since no cookie means no session read.
 */
import { safeLoadEnv } from '@nabvy/config'

export const GATE_BASE_URL = 'http://127.0.0.1:3100'
export const GATE_FOUNDER = 'founder@example.com'
export const GATE_SECRET = 'e2e-only-secret-that-is-at-least-32-characters-long'
const database = safeLoadEnv(['database'])
export const GATE_DATABASE_URL = database.success ? database.data.DATABASE_URL : undefined

export const gateServerEnv = {
  BETTER_AUTH_SECRET: GATE_SECRET,
  BETTER_AUTH_URL: GATE_BASE_URL,
  ADMIN_EMAILS: GATE_FOUNDER,
  DATABASE_URL_AUTH: GATE_DATABASE_URL ?? 'postgres://nobody@127.0.0.1:1/unused',
  TURNSTILE_SITE_KEY: 'e2e-only',
  TURNSTILE_SECRET_KEY: 'e2e-only',
  RESEND_API_KEY: 'e2e-only',
  RESEND_WEBHOOK_SECRET: 'e2e-only',
}
