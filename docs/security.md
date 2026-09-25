# Security

Threat model in one line: a small SaaS holding user accounts, payment relationships through Stripe, eBay seller tokens, and a valuable data set, exposed through a public web app and webhooks, built and operated largely by agents.

## Identity and access

- Better Auth with magic-link email and Google sign-in; email verification required before any paid action; sessions are database-backed with a 30-day expiry, cookie cache of five minutes, and revocation on sign-out or account deletion. Built-in rate limiting on auth endpoints; the captcha plugin (Cloudflare Turnstile) on sign-up and magic-link requests.
- Roles through the admin plugin: `user` and `admin` (founder and staff). Roles are set server-side by an admin action with an audit row, never by the client; admin pages and server actions check the role on the server.
- The browser never talks to the database. Every read and write goes through oRPC procedures (or server actions calling them) that call module functions, which run Drizzle queries inside `withUser(userId)` from `@nabvy/db`: a transaction that sets `app.user_id` for the connection. Row-level security policies on every table with a `userId` compare `userId` to `current_setting('app.user_id', true)`, and the application's database role is not exempt from RLS, so a query that forgets the wrapper returns nothing rather than everything. Trigger.dev tasks use a separate role for pipeline tables.
- **Cross-module reads behind a user-facing view** (coordinator 10, 2026-09-25, from price-drop-watch's question; checked by a security and a Postgres reviewer). An `app.*` view may read another module's internal `v_` views only through a SECURITY DEFINER function, as `listing_suppression.is_suppressed()` does. The function's owner bypasses RLS, so its body, not RLS, is the guard:
  - `language sql`, `stable` (never immutable or leakproof), `security definer`, `set search_path = ''`, every name schema-qualified (extensions too), no dynamic SQL, no error text carrying row values; the module's SQL test calls it as `nabvy_app`.
  - `revoke all on function ... from public`, then `grant execute` to `nabvy_app` only. Never to `nabvy_pipeline`, and no usage on schema `app` for it: the pipeline, and any cross-user or admin read, uses the internal views with its own grants.
  - It returns a boolean or an explicit `returns table (...)`, never a seller or raw column, reads other modules only through their `v_` views, and the `app` view keeps its column names.
  - A boolean predicate on one opaque ID (`is_suppressed`, `listing_known`) needs no user scope. A row-returning function filters inside its body on `nabvy_core.current_user_id()` against the module's own user-owned table (price history: the caller watches that listing), so a call outside `withUser` returns nothing. That guards a forgotten `withUser`; it cannot limit the `nabvy_app` role itself, whose RLS rests on the same setting.
  - The outer view stays `security_invoker` over the module's own RLS tables, at per-user cardinality. Schema `app` is created idempotently with `revoke all on schema app from public`; backlog 0.9e extends `nabvy_core.view_violations()` to `app` views and every SECURITY DEFINER function before a second module publishes an `app` view.
- Supabase's service key is used server-side only for Storage (signed URLs, lifecycle rules); it is never in a client bundle. PostgREST is disabled for the `public` schema.
- Account deletion: a user can delete their account from the account page; hunts, alerts, scans, inventory and tokens are deleted within 24 hours; anonymised outcome and price observations are kept (no user link).

## Secrets

- All secrets in platform vaults (Supabase, Trigger.dev, Vercel, Apify) and local `.env` files that are git-ignored. `gitleaks` runs in CI and as a pre-commit hook.
- Separate keysets per environment (development, staging, production); rotate any key that ever appears in a log or a pull request.
- eBay refresh tokens encrypted at rest with `TOKEN_ENCRYPTION_KEY` (AES-256-GCM); decrypted only inside `inventory-resale` at call time.

## Web application

- Every oRPC procedure and server action validates its input with the contracts schemas and checks the session before calling a module function; no raw SQL from user input; queries through Drizzle only. Public API keys (Business tier) are hashed at rest, scoped per user, rate limited, and revocable.
- Content Security Policy that allows only self, Supabase, Stripe, PostHog and Sentry origins; `frame-ancestors 'none'`; HSTS.
- CSRF protection via same-site cookies and origin checks on server actions; Stripe webhooks verify signatures and Telegram webhooks the secret-token header (constant-time), each deduplicated on the event or `update_id`; eBay OAuth uses a state parameter bound to the session.
- Uploads (scan photos) accepted only as JPEG, PNG or WebP under 10 MB, stored under a per-user path with signed, expiring URLs.
- Rate limits per user and per IP on sign-up, scan, hunt creation and feedback endpoints (numbers in `docs/engineering.md`); Cloudflare Turnstile on sign-up to protect the free tier's paid provider calls.
- Admin bootstrap only through `ADMIN_EMAILS`; every role change and admin action writes `audit_log`.

## Data

- Listing data holds no seller names or profile links; seller IDs are hashed with a per-environment salt at the adapter boundary.
- Snapshots and scan photos expire after 30 days (storage lifecycle rule). Alerts and delivery logs are kept 12 months; metrics indefinitely.
- Backups: Supabase daily backups on Pro; point-in-time recovery enabled before public launch; a weekly export of `products`, `value_bands` and `price_observations` to storage as the independent copy of the moat.
- Least privilege: each Trigger.dev task uses a database role limited to its module's tables where practical; the web app uses RLS.

## Third-party and supply chain

- Dependencies limited to permissive licences (`CLAUDE.md`); `pnpm audit` in CI; Renovate or Dependabot for updates; lockfile committed.
- Provider adapters treat all provider output as untrusted data: schema-validated, size-limited, never executed, never used as instructions to a model without the pack's system prompt stating that listing text is data.
- Model calls carry no user identifiers beyond what the task needs; prompts are logged to Langfuse with PII scrubbed.

## Abuse and cost exploits

Threat model and test plan: `docs/design/abuse-threat-model.md` (task 4.3t).

- Identity limits (IP, device, email domain, card) raise an attacker's cost per account; the money bound is the chain behind them: admission rate, circuit breakers, free-burst pool, the £2 lifetime cap, the synchronous spend gate and its daily, weekly and monthly caps, the gateway's monthly cap, Apify's platform limit.
- Every paid call (Apify run, model call, scan, pasted-link lookup, API-key request) passes the spend gate before submit; the gate and the run's reservation are one locked step, and a reservation is sized from the run's own cap.
- Free-tier guards act from day one: never in shadow, and free admission holds when `account-integrity` is off or in shadow.
- Trial keys (canonical email, card fingerprint, device) survive account deletion as keyed hashes, so deleting and rejoining never resets the free tier.
- Only the free tier is limited: paid sign-ups and upgrades are never queued or held by the throttle, breakers, pool or farm ladder (owner, 2026-09-24). The free pool has a monthly ceiling set as a share of the provider's monthly cap, so free traffic cannot stop paid watchers.
- Watching is prepaid: credits are reserved per check before submit; each user has a monthly spending limit.
- First-seen is written once per listing; a replay, a late collection or an admin retry never re-alerts or repeats a model call.
- Every free account costs at most £2 a day, counting every paid action, checked in the gate; paid accounts are bounded by their credits and the global caps (`docs/decisions.md`, "Free-tier limits, paid users and the daily cap"; free tier only, owner 18:18). Caps are policy rows edited in the admin panel.
- Policy rows have ceilings in config that the admin console cannot pass; admin actions need a second factor, fresh within 15 minutes, on a device-bound session; the admin panel is hardened and adversarially audited before the free tier opens (`docs/design/admin-hardening.md`).
- Telegram links: private chats only; wrong-code attempts limited per chat.

## Operations

- Kill switches per provider and a global "pause pipeline" switch, both admin-only.
- Alerts to the founder on: error rate spikes, provider spend over cap, model spend over daily budget, failed Stripe webhooks, RLS policy changes in migrations.
- Incident notes are recorded in `incidents` and summarised in the module README of whatever failed.

## Checks before launch

- Penetration test of the web app and webhooks (an external scan at minimum).
- Every table with `userId` has an RLS policy test, run once with `withUser` and once without to prove the deny-by-default.
- Secrets scan clean; no service-role key in any client bundle (verified by grepping the built output).
- Stripe webhook replay test; eBay OAuth state test; upload type, size and pixel-count test.
- The day-one checklist in `docs/design/abuse-threat-model.md` is all true before the free tier opens, and its fixtures pass.
