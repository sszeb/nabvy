# CLAUDE.md — rules for agents working in this repository

You are building Nabvy, a UK deal-finding engine. Before any task read `README.md`, `docs/decisions.md`, `docs/engineering.md` and `docs/progress.md`; read `docs/security.md` before any task that touches auth, tokens, uploads, webhooks or migrations. `packages/db` (Drizzle) is the source of truth for persisted shapes and `packages/contracts` (Zod) for everything that crosses a boundary: events, fact templates, packs, API input and output, model output. Never type the same thing twice; derive.

**Precedence.** Where this build pack conflicts with the Facebook actor brief listed in `docs/fb-actor-sources.md`, the brief wins (owner's decision, 2026-09-24). The known conflicts are listed under "Precedence" in `docs/decisions.md`; read that section before any task.

## Non-negotiables

- **Facebook actor rules** (owner, 2026-09-24). Call only the private Apify actor `YfdUav3sZ2BgEf8rh`; never touch `JR2fdK8Nj6OLCwKkP`. Never contact Facebook directly: all Facebook traffic goes through Apify runs. The Apify token is a Supabase Edge Function secret and never appears in code, commits, logs or chat. In Supabase, leave the deprecated `marketplace_monitor` schema alone.
- **No scrapers.** Never write code that fetches HTML or undocumented endpoints from Facebook, Gumtree or Vinted. Those sources are reached only through the Apify client and the provider adapter contract. eBay is reached only through its official APIs. CeX is reached through its web API behind the adapter, with the caps in `docs/providers.md`.
- **No browser automation** against any marketplace, and never store or use a user's marketplace cookies or passwords. eBay seller access uses OAuth tokens only.
- **No personal data beyond need.** Never store seller names or profile links. Public seller IDs are hashed before storage. Raw provider responses live in snapshot storage for 30 days, then expire. *(Seller data: superseded by the brief, which keeps it internal-only in a restricted private schema and never shows seller identity to users; see "Precedence" in `docs/decisions.md`.)*
- **No invented numbers.** Prices, margins and days-to-sell come from `services/valuation` over real comparables. Model output is facts and text only, validated against a Zod schema before use.
- **No database access from the browser.** All reads and writes go through oRPC procedures in `apps/web/src/rpc/` (or a plain server action that calls the same procedure) which validate input with the contracts schemas, check the session, and call module functions inside `withUser(userId)` from `@nabvy/db`. Never import Drizzle or a database client into client components; never use supabase-js for application data; never put business logic in a procedure or action, only in module functions.
- **No HTTP between modules.** Modules import each other's exported functions and publish events. A module that needs another module's data reads its `v_` view or calls its function; it never fetches a URL.
- **No secrets in the repo.** Read them from environment variables listed in `docs/secrets.md`. If one is missing, stop and record it in `docs/questions.md`.
- **No new dependencies** without a one-line justification in the pull request and a check that the licence is MIT, Apache 2.0, BSD, ISC or PostgreSQL. No source-available licences for core code.

## How to work

- **One task at a time** from `docs/backlog.md`, in order, unless a human says otherwise. Do not start the next task in the same session without a check-in.
- **Definition of done** is stated per task. It always includes: types in contracts or schema in db, a fixture-based test, lint and typecheck clean, a short note in the module's `README.md` on anything decided, and an updated row in `docs/progress.md`. Work on a branch `task/<id>-<slug>` and open one pull request per task; a human merges.
- **Fixture-first.** Every extraction, valuation or risk change must run against `fixtures/` and keep the pass rate at or above the previous run. Add a fixture when you find a case the tests miss.
- **Batches, not items.** Pipeline tasks process arrays of listings (100–500). Never write a task that handles one listing per run.
- **Idempotent handlers.** Every event handler must be safe to run twice. The idempotency key is `source + sourceListingId + contentHash`.
- **Thin events.** Events carry identifiers and timestamps, never whole records. The receiver loads what it needs.
- **Stamp every hop.** Set the T-timestamps defined in `docs/contracts.md` at each stage.
- **Ask, don't guess.** Product decisions (pricing, tiers, categories, wording shown to users) are not yours to change. Write the question in `docs/questions.md`, pick the conservative option, and continue.

## Repository conventions

- TypeScript strict mode. pnpm workspaces + Turborepo. Biome for lint and format. Vitest for tests.
- Each module lives in `services/<module>/` with the same shape: `README.md`, `src/index.ts` (exports), `src/handlers/` (event handlers), `src/domain/` (pure logic, no I/O), `src/repo/` (database access), `test/` (fixture tests).
- Database access uses Drizzle with the schema in `packages/db`; Better Auth tables are generated by its CLI and never edited by hand. Configuration comes only from `@nabvy/config`; nothing reads `process.env` directly.
- Each module owns its tables (listed in `docs/contracts.md`). Other modules read through views only.
- Trigger.dev tasks in `trigger/` are thin: parse input, call a service function, return. No business logic in task files.
- Commits: `<module>: <what changed>`; one module per commit where possible.

## Commands (once scaffolded)

```
pnpm install
pnpm typecheck
pnpm lint
pnpm test            # runs fixture tests
pnpm db:generate     # generate a Drizzle migration from schema changes
pnpm db:migrate      # apply migrations
pnpm auth:generate   # regenerate Better Auth schema after plugin changes
pnpm dev:web         # Next.js app
pnpm trigger:dev     # Trigger.dev local runner
```

## When something is unclear

Write it in `docs/questions.md` with: the task, the ambiguity, the option you took and why it is the conservative one. Then continue. A human reviews the file at each check-in.
