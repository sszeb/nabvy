import 'server-only'

import { AuthFailure, requireAdmin as requireAdminSession, type SignedIn } from '@nabvy/auth'
import { headers } from 'next/headers'
import { forbidden, unauthorized } from 'next/navigation'

/**
 * The admin gate (task 4.3af; docs/design/admin-hardening.md H1, A1, A12). The admin layout,
 * every admin page, and every admin procedure or server action call it first, before reading
 * anything. The role comes from the session that `@nabvy/auth` reads from the database on this
 * request, past the five-minute cookie cache, never from a client-side session: a demotion or a
 * revoke applies to the very next request. Nobody signed in gets 401 (`unauthorized()`); a
 * signed-in account without the admin role, or a restricted one, gets 403 (`forbidden()`).
 */
export async function requireAdmin(): Promise<SignedIn> {
  try {
    return await requireAdminSession(await headers())
  } catch (error) {
    if (error instanceof AuthFailure) {
      if (error.status === 401) unauthorized()
      forbidden()
    }
    throw error
  }
}
