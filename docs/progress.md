# Progress

Updated by the agent at the end of every task. A new session reads this first.

| Task | Title | Status | Date | PR / notes |
| --- | --- | --- | --- | --- |
| 0.1 | Scaffold the monorepo | done | 2026-09-24 | Awaiting review on branch `claude/hopeful-wright-r5ygps`. pnpm 10 + Turborepo, Biome (`noProcessEnv` outside `packages/config`), Vitest, TypeScript 5.9 strict (pinned to 5 per `docs/engineering.md`; 7.x exists), Node 22. `@nabvy/config` validates env by group and fails fast (`packages/config/README.md`). Empty `contracts`, `db`, `packs` packages; root scripts for later tasks say which task adds them. Precedence of the actor brief recorded in `docs/decisions.md`. Independent review (3 reviewers, each finding re-checked by a skeptic): 22 confirmed findings fixed, 16 rejected with reasons |
| 0.2 | Contracts package | not started | | |
| 0.3 | Database schema | not started | | |
| 0.4 | Pack loader | not started | | |
| 0.5 | CI pipeline | in progress | 2026-09-24 | `.github/workflows/ci.yml` on every pull request and push to `main`: typecheck, lint, test; `pnpm audit --audit-level=high`; gitleaks 8.30.1 (checksum-verified) over the full history with `.gitleaks.toml` (adds Apify and Supabase secret-key rules); migration dry-run of `supabase/migrations` on a Postgres 17 service with the gateway behaviour tests (`pnpm db:dry-run`). Pending, each with its enabling task: fixture pass rate (0.6), Vercel preview (0.5a), dry-run against a real Supabase branch (needs a `SUPABASE_ACCESS_TOKEN` repository secret), deploys on merge (0.3, 1.2, 0.5a) |
| 0.5a | Waitlist and marketing site skeleton | not started | | |
| 0.6 | Fixtures harness | not started | | |
| 1.0 | Document the Facebook actor | in progress | 2026-09-24 | Started ahead of 0.2–0.6 at the owner's request, while the actor's integration guide is pending. Done: run by hand through the gateway (run `VkryjpwS6U2GBDh3k`, $0.0177); real input schema, output fields and the mapping to the `docs/providers.md` target in `services/source-adapters/README.md`; full reference in `docs/fb-actor-reference.md`; the redacted run saved under `fixtures/listings/facebook/runs/`, verified against the database and checked by a fixture test; differences listed in `docs/questions.md`. Open: `cell_provider_locations` needs the owner's home area and the 0.3 table (`docs/questions.md`) |
| 1.1 | Apify Facebook adapter | not started | | |
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
| 4.0 | Auth service | not started | | |
| 4.1 | Web app core | not started | | |
| 4.1b | User dashboard | not started | | |
| 4.2 | Web push and email | not started | | |
| 4.3 | Billing | not started | | |
| 4.3a | Account and channels | not started | | |
| 4.3b | Security hardening | not started | | |
| 4.4 | Crawl planner v1 | not started | | |
| 4.5 | Review console | not started | | |
| 4.6 | Public freshness page | not started | | |
| 4.7 | Compliance surface | not started | | |
| 4.5a | SEO price pages | not started | | |
| 4.6a | Analytics and feedback loop | not started | | |
| 4.6b | Lifecycle messaging | not started | | |
| 4.6c | Nabvy Daily | not started | | |
| 4.7a | Affiliate programme | not started | | |
| 4.8 | Admin dashboard, monitoring and runbooks | not started | | |
| 5.3a | MCP server (read-only) | not started | | |
| 5.4a | Public API (Business tier) | not started | | |
| 5.6 | Load check and launch checklist | not started | | |

Status values: not started, in progress, blocked (see `docs/questions.md`), done.
