import 'server-only'

import {
  AccountRestrictedError,
  AuthFailure,
  requireActiveUser as requireActiveUserSession,
  type SignedIn,
} from '@nabvy/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

/**
 * The signed-in gate for every `/app` page (task L1, following `@/lib/admin-gate`'s pattern for
 * `/admin`). Reads the session from the database on this request, never a client-side session,
 * so a sign-out or a restriction applies to the very next request. Redirects to sign-in when
 * nobody is signed in; a restricted account is sent to its notice.
 */
export async function requireUser(): Promise<SignedIn> {
  try {
    return await requireActiveUserSession(await headers())
  } catch (error) {
    if (error instanceof AccountRestrictedError) {
      redirect(`/errors/restricted?step=${error.step}&policy=${error.policy}`)
    }
    if (error instanceof AuthFailure) redirect('/sign-in')
    throw error
  }
}
