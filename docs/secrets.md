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
| `FB_DAILY_CAP_MINOR`, `GUMTREE_DAILY_CAP_MINOR`, `SCAN_SPEND_CAP_MINOR` | crawl-planner, recognition | Config: defaults 1000, 500, 5 |
**`REVIEW_FIRE_TOKEN` and `FIX_FIRE_TOKEN`** (not in the table above: they are GitHub Actions repository secrets, not application config, so they never reach `packages/config` or `.env`, and the variable-inventory test in `packages/config` doesn't expect them). Each is a per-Routine API token — one for the reviewer Routine, one for the Fixer — generated once in the Routines app and stored as a GitHub repository secret, never in code, commits or chat. The plan is for a CI job on each PR event to `POST` to `https://api.anthropic.com/v1/claude_code/routines/<id>/fire` with the matching token, so a run on a green or failed head can wake the reviewer or Fixer Routine without a human or a long-lived session in the loop; that job is not in `.github/workflows/ci.yml` yet, so for now this paragraph only reserves the names and the intended use.

Accounts a human must create before Phase 1: Apify (with the Nabvy actor deployed), Anthropic, Trigger.dev, Telegram bot. Before Phase 2: eBay developer keyset. Before Phase 3: eBay Sell API consent flow (RuName) and Sandbox seller. Before Phase 4: Stripe (products created per `docs/billing.md`, Stripe Tax enabled, legal entity set), Resend with `mail.nabvy.com` and `news.nabvy.com` verified, PostHog Workflows enabled with an email sender on `news.nabvy.com`, VAPID keys, Sentry, PostHog, Cloudflare Turnstile, Google OAuth client. Before launch: ICO registration, legal documents, external security scan, Dub workspace with the Partners programme configured per `docs/affiliates.md` and `nabvy.link` connected.
