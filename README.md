# Nabvy

Nabvy is a UK deal-finding engine for anyone who buys and sells second-hand: flippers, small traders, collectors and bargain hunters. It watches new listings on eBay UK, Gumtree and Facebook Marketplace, works out what each item is really worth in the UK, screens it for risk, and alerts users only when it is worth buying, with the maths shown and an honest freshness stamp. A second entry point, scan mode, does the same for an item in front of the user: point the phone camera at it in a charity shop or at a car boot, get a valuation and a verdict, and list it on eBay in one tap.

Version 1 launches with one category pack, GPUs and gaming PCs, because it has clean product keys and strong price data. Consoles, phones, laptops, furniture and other categories follow as data-driven packs; cars later. The engine itself is category-agnostic.

## The five rules every contributor (human or agent) follows

1. **APIs first, Apify for the rest, no scrapers of our own.** We call an API whenever one is available to us (eBay's official API, CeX's web API). Where none exists (Facebook Marketplace, Gumtree, Vinted) we use third-party Apify actors as our data provider. We never write or run scrapers, proxies or anti-bot code.
2. **Models read, maths values.** Language and vision models extract facts from listings and photos. Every price shown to a user comes from statistics over real comparables. No number in an alert is invented by a model.
3. **Precision over recall.** A missed deal costs one opportunity; a bad alert costs trust. Defaults are conservative and every value carries a confidence.
4. **Cheap first, AI last.** Rules and filters run before any model call. The smallest model that passes is the default; bigger models run only when the item's value justifies it.
5. **Honest freshness.** Every hop stamps the time. Users see when an item was listed and when we found it. We never sell a speed faster than the marketplace's measured indexing delay.

## Product summary

| | |
| --- | --- |
| Audience | Anyone in the UK buying second-hand to resell or to get a good deal. The first design partners are tech flippers who buy 3–10 cards, PCs and parts a month; the same engine serves collectors, small traders and charity-shop hunters as packs are added |
| Sources | Facebook Marketplace (our Apify actor, first), eBay UK (official API), CeX (web API, cash price as the resale floor), Gumtree (Apify actor) |
| Alerts | Deal cards with asking price, fair-value range with 90-day trend, CeX floor, margin after fees and travel, days-to-sell range, risk flags, comparables, freshness stamp, one-tap actions |
| Scan mode | Barcode or photo → identification → on-demand comparables → valuation, verdict, list on eBay or save to inventory; similar-item search for items without a barcode |
| Pricing | Watch and check. Watching (live alerts on areas) is a flat subscription: Free (eBay only), Standard £9/month (one area, 5-minute cadence), Pro £29/month (three areas, 1-minute), Business £99/month (ten areas, export, feeds). Checking (scans, live lookups, similar-item searches, boosts) is metered usage in pounds: Free includes £0.50 a month with full enrichment, paid plans include £10, £35 and £120, then pay-as-you-go top-ups |
| North star | Verified profitable flips attributed to alerts per month. Guardrails: alert precision ≥50% rising to 70%, freshness within 2 minutes of the source's floor, cost per delivered alert under £0.05, week-4 retention ≥40% |
| Not in version 1 | Listing to any marketplace other than eBay, price-drop tracking, CRM, AI negotiation, auto-messaging sellers, native apps, DVDs |

## Stack

TypeScript everywhere. Supabase (Postgres 17, eu-west-1) for the database, queues, cron and storage, accessed through Drizzle. Better Auth for identity, roles and Stripe subscriptions. Trigger.dev for pipeline tasks. Next.js PWA on Vercel for the web app. Vercel AI SDK + Zod for model calls with structured output (Claude Haiku 4.5 default, Claude Sonnet 5 for escalation, vision for photos). Stripe for billing. Telegram, web push and email for delivery. Details in `docs/architecture.md`.

## Repository layout (target)

```
nabvy/
  apps/web/            Next.js PWA: routes, oRPC router, admin area, review console, legal content
  packages/contracts/  Zod schemas for everything that crosses a boundary: events, fact templates, packs, API, model output
  packages/db/         Drizzle schema (source of truth for tables), migrations, withUser, roles, Better Auth schema, seeds
  packages/config/     Zod-validated environment and configuration (prices, caps, limits, model table)
  packages/packs/      Category packs as data (gpu-pc first)
  services/            One package per module (see docs/modules.md)
  trigger/             Trigger.dev task definitions (thin wrappers around services)
  fixtures/            Real listings with hand-labelled facts and values
  docs/                This documentation
```

## How to build

1. Read `CLAUDE.md`, then `docs/decisions.md`, `docs/engineering.md`, `docs/contracts.md` and `docs/progress.md`. `docs/rules.md` holds how to work, working economy, repository conventions and commands.
2. Work through `docs/backlog.md` in order. Each task has a definition of done; record the outcome in `docs/progress.md`.
3. Secrets come from a human; see `docs/secrets.md`. Never commit them.
4. When a spec is unclear, write the question in `docs/questions.md` and take the conservative option; do not invent policy.

## Documentation map

| File | Purpose |
| --- | --- |
| `CLAUDE.md` | Non-negotiable rules for agents working in this repository |
| `docs/rules.md` | How to work, working economy, repository conventions and commands |
| `docs/decisions.md` | Standing decisions and constraints in force (history: `docs/decisions-history.md`) |
| `docs/architecture.md` | System architecture: principles, stack, modules, data flow, controls |
| `docs/contracts.md` | Entities, events, fact templates, tables per module, provider adapter interface |
| `docs/modules.md` | One specification per module: responsibility, inputs, outputs, tables, tests, secrets |
| `docs/providers.md` | eBay API, CeX web API and Apify actor usage; adapter rules; cost caps |
| `docs/valuation.md` | Valuation, risk and days-to-sell rules |
| `docs/scan-mode.md` | Scan mode: recognition, on-demand lookup, similar-item search, actions |
| `docs/packs/gpu-pc.md` | The first category pack |
| `docs/billing.md` | Stripe catalogue, usage balance, entitlements, trials, tax, no-refunds policy, referrals |
| `docs/affiliates.md` | Creator and affiliate programme: terms, Dub Partners wiring, economics |
| `docs/web-app.md` | Screens, deal card, onboarding, channel linking, analytics events |
| `docs/dashboards.md` | User and admin dashboards, database stance (Postgres only, graph trigger), agent access |
| `docs/analytics.md` | First-party product events, PostHog (funnels, replay, flags, experiments, surveys), Langfuse (tracing, prompts, evaluations, scores) |
| `docs/marketing.md` | Lifecycle messaging on PostHog Workflows, consent and deliverability, acquisition (SEO price pages, landing pages, waitlist, communities), measurement |
| `docs/security.md` | Identity, secrets, application and data security, pre-launch checks |
| `docs/compliance.md` | UK GDPR, legal documents, platform terms, the Facebook legal gate, consumer law |
| `docs/operations.md` | Environments, CI/CD, monitoring, runbooks, testing, launch checklist |
| `docs/engineering.md` | Toolchain, packages, database access, identifiers, events and tasks, cost metering, storage, limits, local development, branching |
| `docs/backlog.md` | Ordered build plan with definitions of done |
| `docs/progress.md` | Status of every task, updated by the agent |
| `docs/fixtures.md` | Fixture format and the initial set to collect |
| `docs/secrets.md` | Environment variables and where each comes from |
| `docs/readiness.md` | Coverage, human actions, risks, review verdict |
| `docs/questions.md` | Open questions raised during the build (resolved: `docs/questions-archive.md`) |
