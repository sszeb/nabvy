# CLAUDE.md — rules for agents working in this repository

You are building Nabvy, a UK deal-finding engine. `packages/db` (Drizzle) is the source of truth for persisted shapes, `packages/contracts` (Zod) for everything crossing a boundary; never type the same thing twice, derive. Read `docs/security.md` before touching auth, tokens, uploads, webhooks or migrations. A fired Routine or build run reads only its own role file and brief, never this whole build pack.

**Precedence.** Where this build pack conflicts with the Facebook actor brief (`docs/fb-actor-sources.md`), the brief wins (owner, 2026-09-24); conflicts: "Precedence" in `docs/decisions.md`, read before any task.

## Non-negotiables

- **Facebook actor rules** (owner, 2026-09-24). Call only the private Apify actor `YfdUav3sZ2BgEf8rh`; never touch `JR2fdK8Nj6OLCwKkP` or the public Store edition `UO1yEB9ct9SH6nHZ0` (added 2026-09-24 from the actor app guide). Never contact Facebook directly: all Facebook traffic goes through Apify runs. The Apify token is the Supabase Edge Function secret `APIFY_TOKEN`, read only by the `apify-gateway` Edge Function, and never appears in code, commits, logs or chat. Apify is called only through that gateway (`supabase/README.md`). In Supabase, leave the deprecated `marketplace_monitor` schema alone.
- **No scrapers.** Never write code that fetches HTML or undocumented endpoints from Facebook, Gumtree or Vinted. Those sources are reached only through the Apify client and the provider adapter contract. eBay is reached only through its official APIs. CeX is reached through its web API behind the adapter, with the caps in `docs/providers.md`.
- **No browser automation** against any marketplace, and never store or use a user's marketplace cookies or passwords. eBay seller access uses OAuth tokens only.
- **No personal data beyond need.** Never store seller names or profile links. Public seller IDs are hashed before storage. Raw provider responses live in snapshot storage for 30 days, then expire. *(Superseded for actor data by the owner's decision of 2026-09-24: keep everything the actor returns, unredacted and unstripped, including seller data; developers see all of it; only end users of the app are never shown seller identity. See "Actor data kept in full" in `docs/decisions.md`.)*
- **No invented numbers.** Prices, margins and days-to-sell come from `services/valuation` over real comparables. Model output is facts and text only, validated against a Zod schema before use.
- **No database access from the browser.** All reads and writes go through oRPC procedures in `apps/web/src/rpc/` (or a plain server action that calls the same procedure) which validate input with the contracts schemas, check the session, and call module functions inside `withUser(userId)` from `@nabvy/db`. Never import Drizzle or a database client into client components; never use supabase-js for application data; never put business logic in a procedure or action, only in module functions.
- **No HTTP between modules.** Modules import each other's exported functions and publish events. A module that needs another module's data reads its `v_` view or calls its function; it never fetches a URL.
- **No secrets in the repo.** Read them from environment variables listed in `docs/secrets.md`. If one is missing, stop and record it in `docs/questions.md`.
- **No new dependencies** without a one-line justification in the pull request and a check that the licence is MIT, Apache 2.0, BSD, ISC or PostgreSQL. No source-available licences for core code.

## Everything else

`docs/rules.md` holds, unchanged in meaning: how to work, working economy (contexts, model/effort by job, workflows, hand-offs), repository conventions, commands and what to do when something is unclear. Before a backlog task, read `README.md`, `docs/decisions.md`, `docs/engineering.md` and `docs/progress.md` (subagents and workflow agents read only the files their brief names).
