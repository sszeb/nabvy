# Secrets and configuration

Secrets come from a human and live in platform vaults (Supabase, Trigger.dev, Vercel, Apify) and in a local `.env` that is never committed. `.env.example` lists every variable with an empty value.

| Variable | Used by | Where it comes from |
| --- | --- | --- |
| `DATABASE_URL` | all services (Drizzle, pooled connection), migrations | Supabase project `fbapfy` → Connect → transaction pooler URL, using the `nabvy_app` role |
| `DATABASE_URL_PIPELINE` | trigger/ tasks | Same host, `nabvy_pipeline` role |
| `DATABASE_URL_AUTH` | auth (Better Auth's Drizzle adapter only) | Same transaction pooler URL, `nabvy_auth` role (`services/auth/README.md`) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | source-adapters, recognition (Storage only, server-side) | Supabase project settings |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | auth | Generated once; the app's public URL |
| `TRIGGER_SECRET_KEY`, `TRIGGER_PROJECT_ID` | trigger/ | Trigger.dev project |
| `APIFY_TOKEN` | source-adapters | Apify account → Integrations |
| `APIFY_FB_ACTOR_ID` | source-adapters | The Nabvy Facebook actor |
| `APIFY_FB_ACTOR_FALLBACK_ID` | source-adapters | Chosen Store actor after the first-week comparison |
| `APIFY_GUMTREE_ACTOR_ID` | source-adapters | Chosen Store actor |
| `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_RUNAME` | source-adapters, inventory-resale | eBay Developers Program → Application Keys (production keyset) |
| `EBAY_ENV` | source-adapters | `sandbox` or `production` |
| `EBAY_INSIGHTS_ENABLED` | source-adapters | `false` until Marketplace Insights is approved |
| `EBAY_EPN_CAMPAIGN_ID` | source-adapters | eBay Partner Network account |
| `CEX_API_BASE`, `CEX_DAILY_CAP_CALLS` | source-adapters | Config, not secret: `https://wss2.cex.uk.webuy.io/v3`, `300` |
| `ANTHROPIC_API_KEY` | extraction-enrichment, recognition, valuation (explanations) | Anthropic Console |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` | model calls | Langfuse project |
| `LANGFUSE_SAMPLE_RATE` | `@nabvy/telemetry` (tracing) | Config, not secret: share of non-model spans exported, `0`-`1`; default `1` |
| `TELEGRAM_BOT_TOKEN` | notification-dispatcher | BotFather |
| `DISCORD_BOT_TOKEN` | notification-dispatcher (phase 5) | Discord developer portal |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | notification-dispatcher, web app | Generated once with `web-push generate-vapid-keys` |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | notification-dispatcher, marketing | Resend; sending domains `mail.nabvy.com` (transactional) and `news.nabvy.com` (marketing) verified with SPF, DKIM, DMARC |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | billing-entitlements | Stripe dashboard (test keys for staging, live for production) |
| `STRIPE_PRICE_STANDARD_MONTHLY`, `STRIPE_PRICE_STANDARD_ANNUAL`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_ANNUAL`, `STRIPE_PRICE_BUSINESS_MONTHLY`, `STRIPE_PRICE_BUSINESS_ANNUAL`, `STRIPE_PRICE_EXTRA_AREA`, `STRIPE_PRICE_TOPUP_5`, `STRIPE_PRICE_TOPUP_10`, `STRIPE_PRICE_TOPUP_25` | billing-entitlements | Stripe Products, per `docs/billing.md` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | web app | Stripe dashboard |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | auth (captcha plugin) | Cloudflare Turnstile |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | auth (social provider) | Google Cloud console |
| `SELLER_HASH_SALT` | source-adapters | Generated once per environment; hashes public seller IDs |
| `POSTCODES_IO_BASE` | hunt-manager | Config: `https://api.postcodes.io` |
| `ADMIN_EMAILS` | auth | Config: comma-separated founder addresses that receive the admin role on first sign-in |
| `FOUNDER_TELEGRAM_CHAT_ID` | notification-dispatcher (Phase 1 only) | From the bot's first message with the founder |
| `MODEL_DEFAULT`, `MODEL_ESCALATION`, `MODEL_VISION` | model calls | Config: `claude-haiku-4-5-20251001`, `claude-sonnet-5`, `claude-sonnet-5` |
| `USD_GBP_RATE` | source-adapters (Apify cost) | Config, updated weekly |
| `LIVE_PROVIDERS` | tests | Config: `false` by default; `true` enables live adapter smoke tests |
| `NODE_ENV` | web app (admin fixtures refused under `production`, task 4.3af) | Config, set by Node and Next.js: `development` by default; `next build` and `next start` set `production` |
| `DUB_API_KEY`, `DUB_PROGRAM_ID` | billing-entitlements (lead, sale and chargeback tracking) | Dub workspace → API keys; the Partners programme ID |
| `NEXT_PUBLIC_DUB_DOMAIN` | web app (link domain, cookie read) | Dub custom domain, e.g. `nabvy.link` |
| `SENTRY_DSN` | all | Sentry project |
| `POSTHOG_KEY`, `POSTHOG_HOST` | web app and server (`eu.i.posthog.com`) | PostHog project, EU cloud |
| `TOKEN_ENCRYPTION_KEY` | inventory-resale | Generated once; encrypts eBay refresh tokens at rest |
| `PICKUPS_DATA_KEY` | pickup-routes | Generated once per environment (32 random bytes, hex or base64); encrypts pickup addresses, notes and points at rest (AES-256-GCM). The module does not ship until it exists |
| `FB_DAILY_CAP_MINOR`, `GUMTREE_DAILY_CAP_MINOR`, `SCAN_SPEND_CAP_MINOR` | crawl-planner, recognition | Config: defaults 1000, 500, 5 |
**GitHub Actions repository secrets and variables, not application config** (deliberately not in a `| \`NAME\` |` table row above: they are read only by `.github/workflows/dispatch.yml`, never reach `packages/config` or `.env`, and the variable-inventory test in `packages/config` asserts they're absent from its schema):

- `REVIEW_FIRE_TOKEN` (repository secret) — per-Routine API bearer token that fires the Reviewer Routine (`POST https://api.anthropic.com/v1/claude_code/routines/<id>/fire`).
- `FIX_FIRE_TOKEN` (repository secret) — per-Routine API bearer token that fires the Fixer Routine.
- `BUILDER_FIRE_TOKEN` (repository secret) — reserved: per-Routine API bearer token for a future Builder Routine; not yet wired into any workflow.
- `REVIEW_ROUTINE_ID` (repository variable) — the Reviewer Routine's ID.
- `FIX_ROUTINE_ID` (repository variable) — the Fixer Routine's ID.
- `BUILDER_ROUTINE_ID` (repository variable) — reserved: the future Builder Routine's ID; not yet wired into any workflow.
- `CHAIN_LIVE` (repository variable) — `'false'` pauses the dispatch reconciler globally; any other value (including unset) leaves it live.

Each fire token is generated once in the Routines app and stored as a GitHub repository secret, never in code, commits or chat. `dispatch.yml` only triggers off the default branch (`workflow_run`, `push` to `main`, and a 30-minute schedule), never `pull_request`, so these secrets are never exposed to a PR's own copy of the workflow or script.

Pending (owner decision 2026-09-25, docs/decisions.md "Routing: openrouteservice first"): the router-gateway pull request adds the routing provider's variables to this table (the API key of the owner's openrouteservice account at account.heigit.org on the free Standard plan, read only by router-gateway server-side, plus the provider name and base URL). The variable inventory test in packages/config keeps this table and the config schema in step, so the row lands with that PR.


Accounts a human must create before Phase 1: Apify (with the Nabvy actor deployed), Anthropic, Trigger.dev, Telegram bot. Before Phase 2: eBay developer keyset. Before Phase 3: eBay Sell API consent flow (RuName) and Sandbox seller. Before Phase 4: Stripe (products created per `docs/billing.md`, Stripe Tax enabled, legal entity set), Resend with `mail.nabvy.com` and `news.nabvy.com` verified, PostHog Workflows enabled with an email sender on `news.nabvy.com`, VAPID keys, Sentry, PostHog, Cloudflare Turnstile, Google OAuth client. Before launch: ICO registration, legal documents, external security scan, Dub workspace with the Partners programme configured per `docs/affiliates.md` and `nabvy.link` connected.
