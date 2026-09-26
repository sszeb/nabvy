# Network allowlist (coordinator 15, 2026-09-25, 21:20 UTC)

From a verified audit of the repository (runtime code, SDK defaults, planned providers in `docs/secrets.md` and `docs/decisions.md`, the toolchain and CI), corrected by direct observation: the Trigger.dev dev worker called `otel.trigger.dev` during the owner's test run at 20:47, and openrouteservice is the owner's routing choice (`docs/decisions.md`, "Routing: openrouteservice first", 16:45). The owner opened the cloud environment to full internet access at about 20:40; this file is the list to return to if the policy is tightened again. Hosts only, never keys.

## A. Cloud environment (agent sessions: build, test, review, Trigger.dev smoke)

| Host | Why |
| --- | --- |
| `registry.npmjs.org` | pnpm install, audit, corepack, npx; already direct (proxy exemption) |
| `api.anthropic.com` | Claude Code itself; already direct (proxy exemption) |
| `api.trigger.dev` | Trigger.dev CLI login, dev worker, task registration |
| `otel.trigger.dev` | Trigger.dev dev worker logs and traces |

Optional: `api.postcodes.io` and `api.openrouteservice.org` only for live-provider smoke tests (`LIVE_PROVIDERS=true`; tests are mocked by default); `github.com` and `objects.githubusercontent.com` only if a tool downloads a GitHub release (clone, push and PR tools already work through the built-in GitHub integration). In Node, cloud containers need `NODE_USE_ENV_PROXY=1`.

## B. The owner's PC (local run, milestone L)

| Host | Why |
| --- | --- |
| `rlgufxmsrkhyeiabdeic.supabase.co` | Supabase REST, Storage and the `apify-gateway` Edge Function |
| `*.pooler.supabase.com` (region from the connection string, e.g. `aws-0-eu-west-1.pooler.supabase.com`) | Postgres through Supavisor, all three database URLs |
| `api.trigger.dev`, `otel.trigger.dev` | pipeline runner |
| `api.anthropic.com` | model calls (extraction, scan, explanations) |
| `api.stripe.com`, `checkout.stripe.com`, `billing.stripe.com` | billing in test mode (the last two in the browser) |
| `api.openrouteservice.org` | router-gateway, road time and distance |
| `api.postcodes.io` | location, postcode lookups |
| `cloud.langfuse.com`, `eu.i.posthog.com` | model tracing, product analytics |
| `api.telegram.org` | alerts, optional |
| `registry.npmjs.org`, `github.com` | setup and updates |

Apify is never called from the PC: the gateway Edge Function calls `api.apify.com` from inside Supabase.

## C. Public release later (milestone P and later phases)

Vercel (hosting); `api.resend.com` (email); `challenges.cloudflare.com` (Turnstile); `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com` (Google sign-in); `*.ingest.de.sentry.io` (confirm the region from the DSN); `eu.posthog.com` (browser UI host); `js.stripe.com`; `api.dub.co` and the Dub link domain; map tiles (`tiles.openfreemap.org` or a Nabvy-owned tile host, decided at integration); web push services (`fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.notify.windows.com`, `web.push.apple.com`); `discord.com` (phase 5); `api.ebay.com`, `api.sandbox.ebay.com` (phase 2); `wss2.cex.uk.webuy.io` (CeX, with the caps in `docs/providers.md`).

## D. Keep blocked in the cloud environment

`facebook.com`, `*.facebook.com`, `*.fbcdn.net` (Facebook only through the Apify actor); `api.apify.com` (only the gateway Edge Function calls it, from Supabase, so blocking it here costs nothing); `gumtree.com`, `*.gumtree.com`, `vinted.co.uk`, `*.vinted.*` (only through Apify, later); `www.ebay.co.uk`, `www.ebay.com` (eBay only through its official APIs); `rlgufxmsrkhyeiabdeic.supabase.co` and `*.pooler.supabase.com` (sessions never touch Supabase; the coordinator uses the Supabase connector). Not needed at all: `telemetry.nextjs.org` (disabled in `apps/web`), Google Fonts (no `next/font` use), `www.gov.uk` (trip cost dropped).
