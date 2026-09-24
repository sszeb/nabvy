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
| 0.8 | Config per module | not started | 2026-09-24 | Raised by cost-meter (PR #16); see backlog. |
| 0.9 | Event transport | in progress | 2026-09-24 | Raised by incidents (PR #19); session `session_01TnpKLGUod6XQ8gMXh4XS5S` (top), branch `task/0.9-event-transport`. |
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
| 4.0b | Auth: audit admin actions | not started | 2026-09-24 | Added after `audit-log`; see backlog. |
| 4.1a | Web design system and app shell | done | 2026-09-24 | Merged in PR #7 (`cdd99fc`); branded error pages and the restricted notice follow in PR #10: Next.js, Tailwind and shadcn/ui; the look set by the owner ("MVP scope and pipeline runtime" in `docs/decisions.md`); screens on typed fixture data; photos off behind a flag |
| 4.1c | Branded error pages and restricted notice | done | 2026-09-24 | Merged in PR #10 (`015d689`), after PR #7 |
| 4.1d | Remove "Ireland" from the landing badge and footer | not started | 2026-09-24 | Found by the reviewer on PR #7: `main` says "UK and Ireland", but coverage is UK only (`docs/decisions.md`, "Beta coverage and Apify budget") |
| 4.1 | Web app core | not started | | |
| 4.1b | User dashboard | not started | | |
| 4.2 | Web push and email | not started | | |
| 4.3 | Billing | blocked | 2026-09-24 | Charging from launch and strict no refunds decided by the owner (`docs/decisions.md`). Blocked on the Stripe test key and network access in the environment, then 0.3, 4.0 and 4.1a |
| 4.3a | Account and channels | not started | | |
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
| audit-log | 0 | PR #15 open, changes needed | `session_01SUaJRBg87fChhAHgCmYrGb` | top |
| cost-meter | 0 | done: PR #16 merged 13:00; both migrations applied 13:05 (ledger checked) | `session_01P7EwgNXQxqDq16uiLsSEVg` | top |
| incidents | 0 | PR #19 open | `session_01WENzUdPXvaK5xkdy2unUvu` | Sonnet |
| quote-redaction | 0 | PR #17 open, changes needed; mask wording waits on the owner | `session_013JDvtoKAXsUKX3tHsudwM2` | top |

## Work outside the backlog

| Item | Status | Date | Notes |
| --- | --- | --- | --- |
| Apify gateway | done | 2026-09-24 | Edge Function `apify-gateway` version 9 live, matching `main`; six `apify_gateway` migrations; lossless collection; $5.50 cap (`supabase/README.md`) |
| Integration plan, module catalogue, copy-advert spam design | in progress | 2026-09-24 | Drafted from the owner's listed actor files and Nabvy's own records; the catalogue goes to the owner for approval. Catalogue split into one card per module in `docs/design/modules/` (`scripts/split-module-cards.mjs`, with `index.json`) and condensed into one page for the owner's approval; wave 1 waits for that approval |
| Actor reference rebuild | done | 2026-09-24 | `docs/fb-actor-reference.md` rebuilt from the owner's listed files and the recorded run (about 890 citations, all in scope); `docs/fb-actor-scope-report.md` lists what was dropped and what still relied on it (re-sourcing is task 1.1a) |
| Reviewer and coordinator process | done | 2026-09-24 | A reviewer session reviews, approves and merges; the reviewer applies a merged pull request's migrations straight after merging it, and the coordinator keeps this file in a sweep every two hours (`docs/decisions.md`, "Atomic modules") |
