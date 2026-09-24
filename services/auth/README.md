# @nabvy/auth

One atomic module (`docs/decisions.md`, "Atomic modules"), backlog tasks 4.0 and 4.0b (audited admin
actions). It edits only this folder, `packages/contracts/src/modules/auth.ts` and the
`better-auth` migrations in `packages/db`.

## Job

Signs people in and says who they are: the Better Auth server, the `/api/auth/*` route handlers
for the web app, and the session helpers every oRPC procedure calls, including the account
standing check that refuses suspended and banned accounts.

## Inputs

- HTTP requests to `/api/auth/*`, through the route handlers apps/web mounts.
- Request headers passed to the session helpers by oRPC procedures.
- Admin actions (role changes, restrictions on `better_auth.user`: `banned`, `ban_expires`,
  `restriction_policy`, session revokes), taken only through this module's audited functions
  (`setRole`, `restrictAccount`, `liftRestriction`, `revokeSessions`) by admin procedures and the
  account-integrity module. Only `nabvy_auth` can write the table, so nothing writes the fields
  directly.
- Configuration (`docs/secrets.md`): `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ADMIN_EMAILS`,
  `DATABASE_URL_AUTH`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`,
  `RESEND_WEBHOOK_SECRET`, and optionally `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.

## Outputs

| Export | For |
| --- | --- |
| `createAuthRouteHandlers()` | apps/web: `{ GET, POST }` for `app/api/auth/[...all]/route.ts` |
| `getSession(headers)` | the signed-in session and user, or `null` |
| `requireActiveUser(headers)` | every procedure: signed in, verified, neither suspended nor banned |
| `setRole({ actorUserId, userId, role, reason? }, auth?)` | admin procedures: change a role; one `auth.role-changed` audit row |
| `restrictAccount({ actorUserId, userId, policy, until?, reason }, auth?)`, `liftRestriction({ actorUserId, userId, reason? }, auth?)` | the account-integrity module and admin procedures: suspend (with `until`) or ban, record the policy, keep the reason internal, revoke sessions; lift after a review. One `auth.account-restricted` or `auth.restriction-lifted` audit row |
| `revokeSessions({ actorUserId, userId, reason? }, auth?)` | admin procedures: sign an account out everywhere; one `auth.sessions-revoked` audit row |
| `requireAdmin(headers)` | admin procedures: `requireActiveUser` plus the `admin` role |
| `requireUser(headers)` | only what a restricted account may still do: see the notice, sign out, delete the account |
| `isAccountActive(db, userId)`, `assertAccountActive(db, userId)` | jobs and module functions acting for a user without a request |
| `createAuth(options)`, `getAuth()`, `createAuthFromEnv()` | the Better Auth instance (explicit options, or from the environment) |
| `createRecordingMagicLinkSender()` | test double: records magic links instead of emailing them |
| `AuthFailure`, `UnauthenticatedError` (401), `ForbiddenError` (403), `AccountRestrictedError` (403) | errors the helpers throw; `toJSON()` is the `AuthError` contract |
| `UnknownAccountError` | an admin action named no account; nothing changed or recorded |
| `accountRestrictedNotice(step, policy)`, `ACCOUNT_REVIEW_OFFER`, `POLICY_NAMES` | the notice and review offer a restricted user sees (from `@nabvy/contracts/modules/auth`) |

Helpers take the request `Headers` and, optionally, an instance (tests pass their own). Admin
functions throw `AuditLogRefused` (from `@nabvy/audit-log`) when the audit row cannot be written;
the change has then rolled back.

## Mounting in apps/web

The web app shell is in a separate pull request, so this module creates no apps/web files. When
it lands:

```ts
// apps/web/src/app/api/auth/[...all]/route.ts
import { createAuthRouteHandlers } from '@nabvy/auth'

export const runtime = 'nodejs' // node-postgres needs Node, not the edge runtime
export const { GET, POST } = createAuthRouteHandlers()
```

```ts
// in the oRPC context or a procedure middleware
import { AuthFailure, requireActiveUser } from '@nabvy/auth'
import { ORPCError } from '@orpc/server'

const { user } = await requireActiveUser(request.headers).catch((error) => {
  if (error instanceof AuthFailure) {
    throw new ORPCError(error.status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', {
      message: error.message,
      data: error.toJSON(),
    })
  }
  throw error
})
// then: withUser(user.id, (tx) => moduleFunction(tx, input))
```

- The handlers resolve the instance on the first request, so `next build` needs no secrets.
- The browser client is `createAuthClient` from `better-auth/react` with `magicLinkClient()` and
  `adminClient()`. The sign-in form sends the Turnstile token in the `x-captcha-response` header
  on `POST /api/auth/sign-in/magic-link`; without it the request is refused (400).
- Sign-in runs in the browser against `/api/auth/*`, so Better Auth's `nextCookies()` plugin is
  not needed. Add it last in the plugin list if a server action ever calls a sign-in endpoint.
- A restricted account that follows a magic link gets `403` with code `ACCOUNT_RESTRICTED` and the
  notice as the message. The sign-in page shows that message as it is, with `ACCOUNT_REVIEW_OFFER`
  and a review route.
- Too many sign-in requests get `429`: 5 an hour per IP (Better Auth's limiter) or 5 magic-link
  emails an hour per address.

## Owned tables

Postgres schema `better_auth` (reserved name `auth` belongs to Supabase), generated by the Better
Auth CLI (`pnpm auth:generate`, `packages/db/README.md`): `user`, `session`, `account`,
`verification`, `rate_limit` (Better Auth's rate-limit counters). `subscription` is also there for the Stripe plugin, which the billing module
switches on; this module does not use it. Only this module's Better Auth instance writes them.

## Views

None. Nothing outside this module reads the auth tables. Other modules and jobs call
`isAccountActive` or `assertAccountActive`, which use two `security definer` functions:
`better_auth.account_active(user_id)` (one boolean) and `better_auth.account_restriction(user_id)`
(the step and the policy, for the notice). Neither returns a reason or an expiry.

## Events

None yet.

## When switched off

Nobody can sign in, and every procedure that calls a session helper refuses the request.
Pipeline work that does not act for a user carries on. Jobs that act for a user and call
`assertAccountActive` still work: the check is a database function, not this module's code.

## Tests

`pnpm --filter @nabvy/auth test`. The end-to-end tests run on PGlite, an in-process Postgres,
with the real core and `better-auth` migrations applied, and Better Auth connected as
`nabvy_auth`, so they prove the role's grants are enough. PGlite has no PostGIS, pgvector or
pg_trgm, so those `create extension` lines are skipped. Requests go through the mounted route
handlers; magic links go to the recording sender; captcha checks go to a local Turnstile double.
Nothing leaves the machine.

- `test/auth.test.ts`:
  - sign-up by magic link: verified user, `user` role, hashed token, one use, captcha missing or
    failed;
  - the admin role check; Better Auth's admin endpoints that change anything refused, listing
    users still allowed;
  - founder bootstrap from `ADMIN_EMAILS`: new account, account seeded by `seed_founders`,
    existing account added later, look-alike address;
  - sign-out revoking the session so the old cookies fail;
  - `requireActiveUser` refusing banned and suspended users with the notice only (step and
    policy), admitting lapsed suspensions; the ban reason never leaving the API;
  - `restrictAccount` revoking sessions, a restricted sign-in answered with the notice,
    `liftRestriction`;
  - standing checks as `nabvy_app` and `nabvy_pipeline`;
  - rate limits: 5 magic-link emails an hour per address, 5 sign-in requests an hour per IP in the
    Postgres counter, and captcha on Google sign-in.
- `test/admin.test.ts` (task 4.0b): `setRole`, `restrictAccount`, `liftRestriction`,
  `revokeSessions` and founder bootstrap each write exactly one audit row with the actor, target,
  before and after; with audit writes failing (a trigger on `audit_log.entries`), each action rolls
  back and a founder gets neither the role nor a session; an unknown account and an actor that is
  not an account change nothing.
- `test/verification.test.ts`: no session for an unverified address; the session guard (restricted,
  unverified, founder promotion, no context).
- `test/cookies.test.ts`: `__Secure-`, `HttpOnly`, `Secure` and `SameSite=Lax` cookies over https;
  https required outside localhost.
- `test/units.test.ts`: `isRestricted` over `test/fixtures/standing.json`, the notice, founder
  matching, the magic-link text and senders, environment loading and the route handler factory.
- `packages/db/tests/better-auth-role.test.sql` (in `pnpm db:dry-run`): the role's grants and
  attributes, `account_active` and `account_restriction` on real Postgres, the policy check, and
  no other `better_auth` function executable by the app or pipeline roles (proved on a probe).

## Decisions

- **Database role: a dedicated `nabvy_auth`.** Better Auth reads sessions, accounts and
  verification rows before any user is known, so the tables cannot sit behind `withUser`. Two
  options were open (`docs/questions.md`). Granting `nabvy_app` the tables without RLS would let
  every web request's role read every session token and Google token. A dedicated role can use
  the tables Better Auth needs (`user`, `session`, `account`, `verification`, `rate_limit`) and
  nothing else: no other schema, not `subscription` (the
  billing module grants it with the Stripe plugin), not `seed_founders`. It is `NOLOGIN`
  `NOBYPASSRLS` in the migration like the other roles. It connects through Supabase's transaction
  pooler (`DATABASE_URL_AUTH`); Better Auth keeps no session state and node-postgres uses unnamed
  statements, so transaction mode works.
- **Account standing.** A restriction is Better Auth's own `banned` plus `ban_expires`: an expiry
  means a suspension until then, none means a permanent ban, and a lapsed suspension no longer
  restricts. `restriction_policy` (a generated additional field, one of `terms`,
  `acceptable-use`, `fair-use`) records the policy it was taken under; a restriction without one
  names the Terms of Service. `requireActiveUser` reads them fresh from the database on every
  call. The functions `account_active` and `account_restriction` let jobs check standing without
  reading the table; an unknown user is not active.
- **The notice** names the step and the policy and nothing more (`docs/decisions.md`, "Fair use,
  suspension and bans"): "Your account has been suspended under our Fair Use Policy." or "…banned
  under our Terms of Service.", with "You can ask for a review within 30 days."
  (`ACCOUNT_REVIEW_OFFER`). No reason, rule, signal, score or date. `AccountRestrictedError` takes
  only the two enumerations, and the contract checks that the message is exactly the notice. A
  session guard plugin placed before `admin` refuses restricted sign-ins with the same notice
  (`ACCOUNT_RESTRICTED`), so Better Auth's fixed banned-user message is only a fallback.
- **The ban reason stays internal.** A small plugin re-declares `banReason` with
  `returned: false`, so no Better Auth response (session, sign-in, admin lists) carries it; the
  column is still written. The account-integrity module keeps reasons and evidence in its own
  tables.
- **Session helpers skip the cookie cache.** Sessions last 30 days with a five-minute cookie
  cache (`docs/security.md`). The helpers read the session from the database, so sign-out, an
  admin revoke or a new restriction applies to the next procedure call. The cookie cache still
  serves the browser's own session reads.
- **Email verification required.** There are no passwords. A magic link proves the address. A
  session hook refuses any session for an unverified user, such as a Google account whose email
  Google has not verified. The hook also refuses when a session is created outside a request.
- **Founder bootstrap.** An address in `ADMIN_EMAILS` gets the `admin` role when its account is
  created, and on any later sign-in if it lacks the role (for example, an address added to the
  list later). `pnpm db:seed` (`better_auth.seed_founders`) still pre-creates founders; they are
  verified on their first magic-link sign-in. The promotion is an audited role change
  (`auth.role-changed`, the founder as actor), made by the session guard on the first sign-in,
  also for a new account: the account has no ID to record before it exists, so the user-create
  hook no longer sets the role. If the audit row cannot be written, the founder gets neither the
  role nor a session. `seed_founders` runs as the migration role and writes no audit row
  (`docs/questions.md`).
- **Captcha on sign-in and sign-up.** Turnstile is required in `createAuth`, so no instance runs
  without it, and applies to `/sign-in/magic-link` and `/sign-in/social`: a magic-link request or
  a first Google sign-in is also the sign-up.
- **Admin actions are audited in the transaction that makes them** (task 4.0b, `docs/security.md`).
  `setRole`, `restrictAccount`, `liftRestriction` and `revokeSessions` each run one transaction on
  the auth connection: lock the account row, change it with Drizzle, and call audit-log's
  `record()` with the same transaction, so an audit failure (`AuditLogRefused`) rolls the change
  back. The audit row's `before` and `after` hold `role`, `banned`, `banExpires` and
  `restrictionPolicy`; the ban reason is the row's `reason`, never a state, and stays internal.
  Better Auth's endpoints cannot write the row in their own transaction, so through
  `/api/auth/admin/*` an admin may now only list and read users and list sessions; ban, unban,
  session revokes, role changes, impersonation, user creation or removal, and password or email
  changes are refused there. The caller checks the actor first (`requireAdmin`); the functions do
  not. Admin reads (list, get) are not audited (`docs/questions.md`).
- **`nabvy_auth` inserts audit rows** (`20260924143843_better_auth_audit_access.sql`): usage on
  `audit_log` and insert on `audit_log.entries`, nothing else, under a policy that the actor is an
  existing account. `better-auth` now depends on `audit-log` in `module.json`.
- **Cookies.** `BETTER_AUTH_URL` must be https except on localhost (`createAuth` refuses
  otherwise), and cookies are then `__Secure-`, `HttpOnly`, `Secure` and `SameSite=Lax`.
- **Magic links** expire in 5 minutes, work once, and are stored hashed. Production sends them
  through Resend's API from `sign-in@mail.nabvy.com`. The email wording is provisional
  (`docs/questions.md`).
- **Google sign-in is optional.** It is switched on once both `GOOGLE_OAUTH_*` variables are set;
  one without the other stops start-up.
- **Rate limits** (`docs/engineering.md`; values in `rateLimits` from `@nabvy/config`): Better
  Auth's limiter is on in every environment with its Postgres store (`better_auth.rate_limit`),
  so every instance shares the counters. Sign-in and sign-up requests (magic link, Google) are
  limited to 5 an hour per IP, keyed on `x-forwarded-for`. Magic-link emails are limited to 5 an
  hour per address, counted in the same table under a SHA-256 of the address (never the address
  itself). Better Auth's own defaults cover the other endpoints.
  - **The per-IP key trusts `x-forwarded-for`.** That is safe only behind a proxy that overwrites
    the header with the real client address, as Vercel's edge does. A deployment without such a
    proxy must change `advanced.ipAddress` in `src/auth.ts`, or a client could send any value
    and get a fresh bucket each time.
  - **The per-address counter is one atomic statement** (`consumeMagicLinkQuota`: an `insert …
    on conflict do update … returning count`), so simultaneous requests are counted one after
    another and exactly 5 get through. `test/quota.test.ts` checks it with 20 connections at once
    on real Postgres when `DATABASE_URL` points at a local database; PGlite, which the other
    tests use, has a single connection. A refused request still counts, which only keeps the
    window shut until it ends.
- **Better Auth timestamps** are `timestamp` without time zone (generated schema) and hold UTC
  wall-clock time. The server runs in UTC, and `account_active` pins `timezone = 'UTC'`.
