# Progress

Updated by the agent at the end of every task. A new session reads this first.

| Task | Title | Status | Date | PR / notes |
| --- | --- | --- | --- | --- |
| 0.1 | Scaffold the monorepo | done | 2026-09-24 | Merged in PR #1 (`7a896f4`). pnpm 10 + Turborepo, Biome (`noProcessEnv` outside `packages/config`), Vitest, TypeScript 5.9 strict (pinned to 5 per `docs/engineering.md`; 7.x exists), Node 22. `@nabvy/config` validates env by group and fails fast (`packages/config/README.md`). Empty `contracts`, `db`, `packs` packages; root scripts for later tasks say which task adds them. Precedence of the actor brief recorded in `docs/decisions.md`. Independent review (3 reviewers, each finding re-checked by a skeptic): 22 confirmed findings fixed, 16 rejected with reasons |
| 0.2 | Contracts package | done | 2026-09-24 | Merged in PR #5 (`7e19ed7`) with 0.3 as the shared foundation for atomic modules: shared primitives, per-module contract files and event registry, and `pnpm new:module` (`packages/contracts/README.md`). Module-specific contracts arrive with each module |
| 0.3 | Database schema | done | 2026-09-24 | Merged in PR #5 (`7e19ed7`): one Postgres schema per module, per-module migration folders with a dependency-ordered runner and ledger, `nabvy_app` and `nabvy_pipeline` roles, `withUser` and RLS helpers, `uuidv7()`, Better Auth tables and the founder seed (`packages/db/README.md`). Follow-up hardening merged in PR #8. Applied to `fbapfy` on 2026-09-24 by the coordinator: `core` (foundation and hardening) and `better-auth` migrations in the ledger, pg_trgm, vector and PostGIS installed, roles without login until passwords are set. H3 cell seeds dropped (Precedence row "Search planning"). Follow-ups in PR #8 (`db2f539`) and PR #13 (`837dbac`, pins the module-to-schema name rule across TypeScript, the scaffold, `module.json` and SQL; no migrations) |
| 0.4 | Pack loader | done | 2026-09-24 | Merged in PR #6 (`2c5e8a4`): the CategoryPack format, the gpu-pc pack and the actor's `part-patterns.json` (on the owner's list), reviewed for seller-derived flags and user-facing scores (`packages/packs/README.md`) |
| 0.5 | CI pipeline | in progress | 2026-09-24 | `.github/workflows/ci.yml` on every pull request and push to `main`: typecheck, lint, test; `pnpm audit --audit-level=high`; gitleaks 8.30.1 (checksum-verified) over the full history with `.gitleaks.toml` (adds Apify and Supabase secret-key rules); migration dry-run of `supabase/migrations` on a Postgres 17 service with the gateway behaviour tests (`pnpm db:dry-run`). Merged in PR #2 (`d4cd720`). Pending, each with its enabling task: fixture pass rate (0.6, PR #3), Vercel preview (0.5a), dry-run against a real Supabase branch (needs a `SUPABASE_ACCESS_TOKEN` repository secret), deploys on merge (0.3, 1.2, 0.5a), a `deno check` step for the Edge Function, a committed test for the custom gitleaks rules, Dependabot or Renovate, and SHA-pinned actions |
| 0.5a | Waitlist and marketing site skeleton | blocked | 2026-09-24 | Needs 0.3 and the owner's accounts: Cloudflare DNS, Vercel, Resend. The page designs come with 4.1a |
| 0.6 | Fixtures harness | done | 2026-09-24 | Merged in PR #3 (`688c66d`): per-module stage discovery, pass-rate report and a CI check that fails on a drop (`fixtures/README.md`) |
| 0.8 | Config per module | done: PR #26 merged 15:04 (`session_01BRzRb2vTpUcTLr8gLRnXcz`, Sonnet) | 2026-09-24 | Raised by cost-meter (PR #16). `@nabvy/config` gains a `./modules/*` export and the per-module pattern (Zod-validated, rule 14); `packages/config/src/modules/cost-meter.ts` is the first file, moved from `services/cost-meter/src/config.ts`. `USD_GBP_RATE` moved out of the `apify` group into its own `exchangeRate` group (`docs/questions.md`). Other modules' config files are still to come. |
| 0.9 | Event transport | done | 2026-09-24 | Merged in PR #20 (`fb8a68e`), no migration. New package `@nabvy/transport`: a `Publisher` interface with a Trigger.dev implementation (structural client, no SDK or credentials) and an in-memory one, `emit()`, and `defineHandler()`, which validates against the producer's registry, stamps the declared T-stamp, publishes emitted events only on success, retries through the runtime and dead-letters on the last attempt through a `DeadLetterSink` that `incidents.record` satisfies. Contracts `DeliveryAttempt`, `DeadLetter`, `HandledEvent`, `TransportErrorCode`; `eventRetry` in config. Fixture test runs a 120-listing batch twice as a no-op. Replacing the incidents stub waits for PR #19 (`packages/transport/README.md`) |
| 0.9b | Test hook timeouts (PGlite) | done: PR #24 merged 14:53 (`0778656`; `session_01NKCRQGK581AYjbjhh4hiEt`, Haiku trial, one review round) | 2026-09-24 | PR #24 open: raises vitest `hookTimeout` to 60 s for cost-meter, audit-log and auth; unblocks #23's CI. Judge Haiku on this review before using it more. |
| 0.10 | Analytics and observability clients | done: PR #28 merged 15:40 (`38bf054`), no migration; `session_016cJhsKgaKAhdbaffB5v8A5`, Sonnet | 2026-09-24 | No migration. New package `@nabvy/telemetry` (`packages/telemetry/README.md`): server capture (`posthog-node`) that checks consent and validates against the allow-list before every event, and a client provider (`posthog-js`/`posthog-js/react`) that loads only after both a project key and consent are present, through the app's own `/ingest` rewrite; `registerTracing()` (`@opentelemetry/sdk-node` + `@langfuse/otel`'s `LangfuseSpanProcessor`) with a mask function (strips seller fields and contact patterns) and `LANGFUSE_SAMPLE_RATE`-based sampling (model calls always kept); `traceStage()`; a Langfuse prompt client (`@langfuse/client`). The property allow-list is `ProductEventsEvent` (`packages/contracts/src/modules/product-events.ts`), a new per-module contract file for the not-yet-built `product-events` module (catalogue card `docs/design/modules/product-events.md`), derived from `docs/analytics.md:17-30`; fixture tests confirm events with an email, postcode or free-text property are rejected. `@nabvy/config` gains `LANGFUSE_SAMPLE_RATE` (default 1) and a non-throwing `safeLoadEnv`, so every wrapper here does nothing without its keys. Open points 1 and 5 of `docs/design/analytics-growth.md`, and the missing personal API key for local flag evaluation, recorded in `docs/questions.md`; the legal-review line on per-user pricing was already present |
| 1.0 | Document the Facebook actor | blocked | 2026-09-24 | Started ahead of 0.2–0.6 at the owner's request, while Nabvy's own integration plan is written. Done: run by hand through the gateway (run `VkryjpwS6U2GBDh3k`, $0.0177); real input schema, output fields and the mapping to the `docs/providers.md` target in `services/source-adapters/README.md`; the reference in `docs/fb-actor-reference.md`, rebuilt from the owner's listed files only (`docs/fb-actor-scope-report.md` records what was dropped); the redacted run saved under `fixtures/listings/facebook/runs/`, verified against the database and checked by a fixture test; differences listed in `docs/questions.md`; the gateway collects losslessly (version 9 live, matching `main`: every dataset page, no `clean`, raw text to Postgres, whole run object; a free `collect` job re-read the recorded run and matched all 21 rows, `supabase/README.md`). Blocked on: the owner's home area and the region model (verified city-page centres replace `cell_provider_locations`, Precedence row "Search planning"), and 0.3 |
| 1.1 | Apify Facebook adapter | in progress | 2026-09-24 | Groundwork only, while Nabvy's own integration plan is written: the route-health helper ported from the actor with its tests, plus a pinned test for the description-missing caveat; the actor-input validation and run presets were withdrawn on review (derived from an actor file outside the owner's list) and return re-derived from the listed files after the reference rebuild (`services/source-adapters/README.md`). The adapter itself waits for that plan and task 0.2 |
| 1.1a | Actor scope clean-up and gateway input hardening | done | 2026-09-24 | Merged in PR #11 (`8956505`). Its gateway migration `20260924030000_apify_gateway_input_hardening.sql` was applied by the coordinator at 12:32 UTC (live version `20260924123259`, see `supabase/README.md`) |
| 1.2 | Crawl planner (minimal) | not started | | |
| 1.3 | Listing registry | not started | | |
| 1.4 | Cheap gate and detail fetch | not started | | |
| 1.5 | Extraction, rules tier + Haiku tier | not started | | |
| 1.5a | Evaluation harness | not started | | |
| 1.6 | Price Book v0 and valuation v0 | not started | | |
| 1.7 | Risk screener v0 | not started | | |
| 1.8 | Router and Telegram dispatcher | not started | | |
| 1.9 | Ops monitor v0 | not started | | |
| 2.1 | eBay Browse adapter | not started | | |
| 2.2 | Ended-listing signal | not started | | |
| 2.3 | Marketplace Insights adapter (flagged) | not started | | |
| 2.4 | Price Book v1 | not started | | |
| 2.5 | Free-tier eBay alerts | not started | | |
| 3.1 | Camera and barcode in the PWA | not started | | |
| 3.2 | Recognition | not started | | |
| 3.3 | On-demand fetch | not started | | |
| 3.4 | Scan card | not started | | |
| 3.5 | Inventory and eBay drafts | not started | | |
| 4.0 | Auth service | done | 2026-09-24 | Merged in PR #9 (`8f27dd7`); its three better-auth migrations applied by the coordinator at 12:30 UTC. Before anyone signs in, `nabvy_auth` needs login, a password and `DATABASE_URL_AUTH` (owner, out of band): Better Auth server, session helpers, the account standing check with the vague notice, and a `nabvy_auth` role |
| 4.0a | Auth follow-ups from review | done: merged in PR #14 (`0a5a119`), no migration | 2026-09-24 | Make the per-email magic-link counter atomic (`insert … on conflict`); note in `services/auth/README.md` that the x-forwarded-for rate-limit key assumes a trusted proxy (Vercel) |
| 4.0b | Auth: audit admin actions | done: PR #27 merged 15:29 (`452f46c`); migration applied 15:33 (ledger checked); `session_01QpzxV9s4Wihw96LgQmmoBf`, top | 2026-09-24 | Admin actions (`setRole`, `restrictAccount`, `liftRestriction`, `revokeSessions`, founder promotion) write one `audit_log` row in their own transaction and roll back without it; Better Auth's mutating admin endpoints refused. One migration for the coordinator: `better-auth/20260924143843_better_auth_audit_access.sql` (insert on `audit_log.entries` for `nabvy_auth`) |
| 4.1a | Web design system and app shell | done | 2026-09-24 | Merged in PR #7 (`cdd99fc`); branded error pages and the restricted notice follow in PR #10: Next.js, Tailwind and shadcn/ui; the look set by the owner ("MVP scope and pipeline runtime" in `docs/decisions.md`); screens on typed fixture data; photos off behind a flag |
| 4.1c | Branded error pages and restricted notice | done | 2026-09-24 | Merged in PR #10 (`015d689`), after PR #7 |
| 4.1d | Remove "Ireland" from the landing badge and footer | not started | 2026-09-24 | Found by the reviewer on PR #7: `main` says "UK and Ireland", but coverage is UK only (`docs/decisions.md`, "Beta coverage and Apify budget") |
| 4.1 | Web app core | not started | | |
| 4.1b | User dashboard | not started | | |
| 4.2 | Web push and email | not started | | |
| 4.3 | Billing | blocked | 2026-09-24 | Charging from launch and strict no refunds decided by the owner (`docs/decisions.md`). Blocked on the Stripe test key and network access in the environment, then 0.3, 4.0 and 4.1a |
| 4.3a | Account and channels | not started | | |
| 0.11 | Replace the switch stubs | started 16:14; parts (1) and (2) of the backlog entry; one cost-meter migration after merge | 2026-09-24 | `session_01Lb6LJFC25YwtRsFqvxXgff`, Sonnet |
| 4.3b | Security hardening | not started | | |
| 4.4 | Crawl planner v1 | not started | | |
| 4.5 | Review console | not started | | |
| 4.6 | Public freshness page | not started | | |
| 4.7 | Compliance surface | in progress | 2026-09-24 | Drafts of the terms, the no-refunds and cancellation policy and the acceptable use policy, modelled on Apify's and Supabase's approach and adapted to UK consumer law, marked `TODO-LEGAL` for the owner's lawyer. Retention jobs wait on the retention period (`docs/questions.md`) |
| 4.5a | SEO price pages | not started | | |
| 4.6a | Analytics and feedback loop | not started | | |
| 4.6b | Lifecycle messaging | not started | | |
| 4.6c | Nabvy Daily | not started | | |
| 4.7a | Affiliate programme | not started | | |
| 4.8 | Admin dashboard, monitoring and runbooks | not started | | |
| 5.1 | Gumtree adapter | blocked | 2026-09-24 | Out of scope for this push (Facebook only), and the gateway allows one actor only |
| 5.2 | Facebook fallback adapter | superseded | 2026-09-24 | Ruled out: one actor only (`CLAUDE.md`) |
| 5.3 | Discord and Telegram channel bots | not started | 2026-09-24 | The resale gate was lifted by the owner (`docs/decisions.md`, "Legal gates lifted") |
| 5.3a | MCP server (read-only) | not started | | |
| 5.4 | Second pack (consoles) | not started | | |
| 5.4a | Public API (Business tier) | not started | 2026-09-24 | The resale gate was lifted by the owner (`docs/decisions.md`, "Legal gates lifted") |
| 5.5 | Legal gate checklist | not started | 2026-09-24 | The gates were lifted by the owner; legal points are listed in `docs/legal-review.md` and reviewed only on the owner's request |
| 5.6 | Load check and launch checklist | not started | | |

Status values: not started, in progress, blocked (see `docs/questions.md`), done, superseded.

## Wave 1 (atomic modules)

Started on the owner's go-ahead (2026-09-24, 12:45 UTC). Each module starts when its hard dependencies are merged (`docs/design/modules/index.json`, "round", regenerated at 13:00 from the final audited catalogue: 89 modules, rounds 0 to 14); round 0 first. Next: `switches` once `audit-log` merges, then round 2.

| Module | Round | Status | Session | Model |
| --- | --- | --- | --- | --- |
| audit-log | 0 | done: PR #15 merged; both migrations applied 14:00 (ledger checked) | `session_01SUaJRBg87fChhAHgCmYrGb` | top |
| cost-meter | 0 | done: PR #16 merged 13:00; both migrations applied 13:05 (ledger checked) | `session_01P7EwgNXQxqDq16uiLsSEVg` | top |
| incidents | 0 | done: PR #19 merged 15:03 (`fa7d90f`); both migrations applied 15:10 (ledger checked) | `session_01WENzUdPXvaK5xkdy2unUvu` | Sonnet |
| quote-redaction | 0 | done: PR #17 merged 14:42 (`f4ded65`); both migrations applied 14:45 (ledger checked); mask wording approved by the owner | `session_013JDvtoKAXsUKX3tHsudwM2` | top |
| switches | 1 | done: PR #23 merged 15:03 (`c30e3af`); both migrations applied 15:10 (ledger checked) | `session_01CtxXRGTqrS7tCXgFaNfw2J` | top |
| product-catalogue | 2 | PR #32 open 15:43; after merge apply `product-catalogue/20260924151843_product_catalogue_tables.sql`, `20260924151851_product_catalogue_access.sql` and `20260924151942_product_catalogue_seed.sql` (depend on core, switches, audit-log) | `session_017SEV6VX5p4BgAjMVyVMEic` | Sonnet |
| apify-gateway | 2 | done: PR #29 merged 15:58 (`b060a99`); migration applied and Edge Function version 10 deployed 16:05 (ledger checked; cap $150 a month, build 1.0.82); inert until an admin switches on `apify` and `apify-gateway` | `session_01Mc3zCoHbPpwPfirnZxpqqF` | top |
| waitlist | 2 | PR #31 open 15:42; after merge apply `waitlist/20260924152710_waitlist_tables.sql` and `waitlist/20260924152712_waitlist_access.sql` (depend on core and switches); email sending stubbed until the owner's accounts exist | `session_01REmUhAiyrnyeJEGGNFzEHz` | Sonnet |
| account | 2 | in progress, started 15:35 from the amended card on `claude/coordinator-4` | `session_019z1ZHft2YbdK31o3y4i7i3` | Sonnet |
| listing-ingest | 3 | started 16:13; card `docs/design/modules/listing-ingest.md`; soft dependencies ebay-adapter and gumtree-adapter not built | `session_01HfncCwAz7dL7Kx9LnCeR2U` | top |
| spend-governor | 3 | started 16:13; card `docs/design/modules/spend-governor.md`; $150-a-month Apify budget | `session_01CC2oetv6aarq9Pyf3wKC7q` | top |
| route-health | 3 | started 16:13; card `docs/design/modules/route-health.md` | `session_01DgJ6WG8sK8FmVprvBHT7Ln` | Sonnet |

## Work outside the backlog

| Item | Status | Date | Notes |
| --- | --- | --- | --- |
| Apify gateway | done | 2026-09-24 | Edge Function `apify-gateway` version 9 live, matching `main`; six `apify_gateway` migrations; lossless collection; $5.50 cap (`supabase/README.md`) |
| Integration plan, module catalogue, copy-advert spam design | in progress | 2026-09-24 | Drafted from the owner's listed actor files and Nabvy's own records; the catalogue goes to the owner for approval. Catalogue split into one card per module in `docs/design/modules/` (`scripts/split-module-cards.mjs`, with `index.json`) and condensed into one page for the owner's approval; wave 1 waits for that approval |
| Actor reference rebuild | done | 2026-09-24 | `docs/fb-actor-reference.md` rebuilt from the owner's listed files and the recorded run (about 890 citations, all in scope); `docs/fb-actor-scope-report.md` lists what was dropped and what still relied on it (re-sourcing is task 1.1a) |
| Reviewer and coordinator process | done | 2026-09-24 | A reviewer session reviews, approves and merges; the reviewer applies a merged pull request's migrations straight after merging it, and the coordinator keeps this file in a sweep every two hours (`docs/decisions.md`, "Atomic modules") |
