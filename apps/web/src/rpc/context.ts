import 'server-only'

import { AuthFailure, requireActiveUser, requireAdmin as requireAdminSession } from '@nabvy/auth'
import { os } from '@orpc/server'

/**
 * Every procedure's initial context: the request headers, so a middleware can resolve the
 * session on this request (task L1; docs/security.md, "Identity and access"). Never the session
 * itself: a cached session would survive a demotion or a revoke past the next request.
 */
export type RpcContext = { headers: Headers }

/** The base builder every procedure starts from (`apps/web/src/rpc`, CLAUDE.md "No database access
 * from the browser"). */
export const base = os.$context<RpcContext>()

/**
 * Attaches the signed-in, active user to the context, or throws `AuthFailure` (401/403). Every
 * user-facing procedure builds on this, never on a userId taken from the client's own input.
 */
export const userProcedure = base.use(async ({ context, next }) => {
  const { user } = await requireActiveUser(context.headers)
  return next({ context: { ...context, user } })
})

/** Attaches the signed-in admin to the context, or throws `AuthFailure` (401/403). */
export const adminProcedure = base.use(async ({ context, next }) => {
  const { user } = await requireAdminSession(context.headers)
  return next({ context: { ...context, user } })
})

export { AuthFailure }
