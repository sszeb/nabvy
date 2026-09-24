import type { Auth } from './auth'
import { AccountRestrictedError, ForbiddenError, UnauthenticatedError } from './domain/errors'
import { restrictionOf } from './domain/standing'
import { getAuth } from './instance'

/** A signed-in session with its user, as Better Auth returns it (never the ban reason). */
export type SignedIn = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>

/**
 * Session helpers for oRPC procedures (docs/decisions.md, "How parts talk to each other"). Each
 * reads the session from the request headers, always from the database: the cookie cache is
 * bypassed, so a session revoked on sign-out, or a restriction set a moment ago, applies to the
 * very next request.
 *
 * Procedures use `requireActiveUser` (or `requireAdmin`). `requireUser` admits a restricted
 * account and is only for what such an account may still do: read the restriction notice, sign
 * out, or delete the account.
 */
export async function getSession(
  headers: Headers,
  auth: Auth = getAuth(),
): Promise<SignedIn | null> {
  return auth.api.getSession({ headers, query: { disableCookieCache: true } })
}

/** Signed in with a verified email address; throws `UnauthenticatedError` (401) otherwise. */
export async function requireUser(headers: Headers, auth: Auth = getAuth()): Promise<SignedIn> {
  const signedIn = await getSession(headers, auth)
  if (!signedIn?.user.emailVerified) throw new UnauthenticatedError()
  return signedIn
}

/**
 * Signed in, and the account is neither suspended nor banned (docs/decisions.md, "Fair use,
 * suspension and bans"). A restricted account gets `AccountRestrictedError` (403), whose message
 * names the step and the policy only, e.g. "Your account has been suspended under our Fair Use
 * Policy.", with the 30-day review offer.
 */
export async function requireActiveUser(
  headers: Headers,
  auth: Auth = getAuth(),
  now: Date = new Date(),
): Promise<SignedIn> {
  const signedIn = await requireUser(headers, auth)
  const restriction = restrictionOf(signedIn.user, now)
  if (restriction) throw new AccountRestrictedError(restriction.step, restriction.policy)
  return signedIn
}

/** An active account with the admin role; throws `ForbiddenError` (403) for anyone else. */
export async function requireAdmin(headers: Headers, auth: Auth = getAuth()): Promise<SignedIn> {
  const signedIn = await requireActiveUser(headers, auth)
  if (signedIn.user.role !== 'admin') throw new ForbiddenError()
  return signedIn
}
