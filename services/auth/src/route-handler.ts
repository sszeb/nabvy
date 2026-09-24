import type { Auth } from './auth'
import { getAuth } from './instance'

type RouteHandler = (request: Request) => Promise<Response>

/**
 * Route handlers for the Next.js App Router catch-all `app/api/auth/[...all]/route.ts`
 * (README.md, "Mounting in apps/web"). The instance is resolved on the first request, not at
 * import, so `next build` needs no secrets.
 */
export function createAuthRouteHandlers(resolve: () => Pick<Auth, 'handler'> = getAuth): {
  GET: RouteHandler
  POST: RouteHandler
} {
  const handler: RouteHandler = (request) => resolve().handler(request)
  return { GET: handler, POST: handler }
}
