'use client'

import { adminClient, magicLinkClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

/** The browser Better Auth client (services/auth/README.md, "Mounting in apps/web"). Sign-in
 * runs against `/api/auth/*` on the same origin, so no `baseURL` is needed. */
export const authClient = createAuthClient({
  plugins: [magicLinkClient(), adminClient()],
})
