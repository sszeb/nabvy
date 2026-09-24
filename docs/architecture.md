# Architecture

Nabvy is a TypeScript modular monolith on managed services. Sixteen modules own their own data and talk through thin events. Category knowledge lives in data packs. Collection is broad and cheap: one watch per marketplace, category and area cell, so cost tracks cells and cadence rather than users.

## Principles

1. **Watch broad, filter locally.** One watch per marketplace, category and 40 km cell. Keyword, price and radius matching happen in the database.
2. **Process in batches.** Tasks take 100–500 listings at a time; non-urgent model work uses batch pricing.
3. **Category knowledge lives in packs.** A pack holds the fact template, gate rules, product dictionary, valuation adjustments, risk rules and explanation template. Adding a category is data work.
4. **APIs first, Apify for the rest, no scrapers of our own.** Every source sits behind one adapter contract with fail-over. All judgement lives in the pipeline.
5. **Precision over recall.**
6. **Models read, maths values.**
7. **Cheap first, AI last.**
8. **One language end to end.**
9. **Managed over self-hosted, with an exit for each.** Supabase, Trigger.dev and Next.js all self-host; any model provider swaps in through the AI SDK.
10. **Timestamps at every hop; every listing is an asset.** Freshness is measured, and every observation feeds a UK price history.
11. **Documented for handover.** Every module ships a README and a decision note.

## Stack

| Layer | Choice | Exit route |
| --- | --- | --- |
| Language and repo | TypeScript, pnpm + Turborepo monorepo, Biome, Vitest | — |
| Data plane | Supabase Postgres 17 with PostGIS, pgvector, pg_trgm, Queues, Cron; Supabase Storage for snapshots and photos; Drizzle ORM and migrations | Self-hosted Supabase or plain Postgres |
| Data access | Nabvy's own Facebook actor on Apify (via `apify-client`), eBay official APIs, CeX web API, a community Apify actor for Gumtree | Swap actors behind the adapter |
| Pipeline runtime | Trigger.dev durable tasks | Self-host, or Supabase Queues + Edge Functions |
| Models | Vercel AI SDK + Zod; Claude Haiku 4.5 default, Claude Sonnet 5 escalation, vision model for photos; Langfuse for cost per listing | Any provider through the SDK |
| Enrichment | postcodes.io; CeX prices; eBay comparables | — |
| Web app | Next.js + Tailwind + shadcn/ui as an installable PWA on Vercel; Better Auth (magic link, Google, admin, captcha, Stripe plugins) with Drizzle on Supabase Postgres; one oRPC procedure layer (typed client for the app, OpenAPI for the public API) in front of module functions; all data access server-side with per-request user scoping and row-level security as a second layer | Any Node host |
| Notifications | Telegram (grammY), web push (web-push, Serwist), email (Resend, React Email) | — |
| Payments | Stripe Checkout and Customer Portal | — |
| Observability | Sentry SDK, Langfuse, PostHog | GlitchTip |

## Modules

| Module | Plane | Responsibility | Runs on |
| --- | --- | --- | --- |
| Hunt Manager | Acquisition | Stores what each user hunts: product, postcode, radius, budget, minimum margin, tier, quiet hours | Supabase |
| Crawl Planner | Acquisition | Turns hunts into crawl units (marketplace, category, cell); sets cadence by the cadence rule; one scheduled tick per cadence class runs all due units; hourly nationwide sweep | Trigger.dev schedules |
| Source Adapters | Acquisition | One adapter per source and provider; call, meter cost, report health, emit; never judge | Trigger.dev |
| Listing Registry | Acquisition | One identity per listing across cells and sources; new/changed detection; cross-post links by photo fingerprint; image embedding per listing; lifecycle from scheduled rechecks | Trigger.dev + Postgres |
| Recognition | Intelligence | Barcode on device; vision identification on a miss; price-tag reading; user confirmation when confidence is low | Web app camera + model APIs |
| Extraction & Enrichment | Intelligence | Cheap gate; tiered extraction into the pack's fact template; bundle splitting; product-key resolution; postcode to coordinates | Trigger.dev + model APIs |
| Risk Screener | Intelligence | Scores fake, mining, untested, stock-photo, deposit and seller signals from pack rules; flags with reasons | Trigger.dev |
| Price Book | Intelligence | Fair-value bands per product key from eBay sold and ended listings, CeX cash price, own history and lifecycle sale signals; refreshed nightly, hourly for hot products | Trigger.dev + Postgres |
| Valuation Engine | Intelligence | Fair value, part-out maths, margin after fees and travel, deal score, days-to-sell, confidence, explanation with comparables | Trigger.dev |
| Opportunity Router | Delivery | Matches valued and screened listings to hunts; tier cadence, dedupe, quiet hours, rate limits | Trigger.dev + PostGIS |
| Notification Dispatcher | Delivery | Deal cards by Telegram, Discord, web push, email; delivery and open tracking | Trigger.dev |
| Web App | Delivery | Auth (Better Auth), hunts, deal feed, deal card, scan mode UI, feedback, account, billing, admin | Vercel |
| Inventory & Resale | Delivery | Items bought with cost; eBay listing drafts via Sell APIs; listing packs for other marketplaces; sales recorded | Trigger.dev + eBay Sell APIs |
| Billing & Entitlements | Business | Plans, trials, boosts; "what may this user have now" | Stripe + Supabase |
| Ops & Freshness Monitor | Business | Freshness per source and tier, error rates, provider spend, model spend, alert precision; kill switches and caps | Supabase + Sentry |
| Review Console | Business | Quarantined extractions, valuation spot checks, user corrections; approved fixes become fixtures | Web app admin |

Four deployables: web app (Vercel), tasks (Trigger.dev), data plane (Supabase), and provider calls (Apify and APIs, called from tasks). Modules are packages that call each other in-process and publish thin events; there is no HTTP between them. The only HTTP surfaces are the oRPC procedures the app calls, the OpenAPI public API generated from the same router, and inbound webhooks. Any module can move to its own deployable without changing contracts.

## Alert data flow

1. **Plan.** Hunts become crawl units. Cadence from the cadence rule; hourly sweep for the Price Book.
2. **Watch.** The unit's primary adapter returns stubs (ID, title, price, thumbnail, location, delivery, listed-at). One call per watch; cost, latency and health recorded; fail-over on error; response snapshot stored 30 days.
3. **Registry diff.** New and price-changed listings continue; seen listings drop; cross-posts link.
4. **Cheap gate.** Pack rules only, no AI. Every listing in the computers category is a candidate because the hidden-GPU feature needs descriptions.
5. **Detail.** Candidates fetched in batches of 20–50 through the adapter's detail call.
6. **Extract.** Rules, then Haiku with per-field confidence, then Sonnet or vision only for high value and low confidence. Bundles split into parts. Output validated; failures quarantined; results cached by content fingerprint.
7. **Enrich.** Postcode to coordinates; product-key resolution (dictionary, then similarity); photo fingerprint and embedding.
8. **Screen.** Pack risk rules produce a score and flags with reasons; flags are shown, never used to hide silently.
9. **Value.** Per `docs/valuation.md`: recency-weighted sold prices, ask-led trend, CeX floor, adjustments, part-out, costs, confidence; thin data yields "unvalued".
10. **Persist.** Valuation written; price observation appended to history.
11. **Match.** Hunts by product, radius, budget, margin; tier cadence, dedupe, quiet hours, rate limits.
12. **Notify.** Deal card with freshness stamp, flags, comparables and actions; delivery and opens recorded.

**Loops:** scheduled lifecycle recheck at 6, 24 and 72 hours (vanished listings are sale signals); nightly Price Book refresh; user feedback and outcomes into the Review Console and Price Book; freshness metrics into the Ops monitor and the public benchmark.

## Scan data flow

1. **Recognise.** Barcode read on device; otherwise photo to the vision model for product, variant, structured description, search phrases and confidence; user confirms when low.
2. **Cache check.** Known product returns its value band at once.
3. **On-demand fetch.** Unknown product: in parallel, eBay live listings and sold signal, CeX price, Facebook and Gumtree asking prices via Apify, eBay image search for similar items; results cached and embedded for everyone.
4. **Value and screen.** As stages 8–9, plus days-to-sell and local fair-price range; for items with no model, a similar-item card (same and similar listings live now, what similar items did over 30 and 90 days).
5. **Act.** List on eBay through the Sell APIs; save to inventory with cost paid; listing pack for other marketplaces; record the sale later.

## Timestamps

| Stamp | Meaning |
| --- | --- |
| T0 listed | Seller posted it (exact on eBay, rounded elsewhere) |
| T1 fetched | First seen by an adapter |
| T2 candidate | Passed the cheap gate |
| T3 extracted | Facts and risk ready |
| T4 valued | Valuation ready |
| T5 matched | Hunts matched |
| T6 delivered | Alert sent |
| T7 opened | User opened it |

Freshness shown to the user is T6 − T0. Pipeline delay T6 − T1 must stay in seconds. T1 − T0 is the source's indexing floor plus cadence, which pricing must respect.

## Cross-cutting controls

- **Cost:** provider fees are the bill; prefer per-request pricing; cadence rule; shared crawl units; two-pass fetch; rules before AI; extraction cache; batch pricing; daily spend caps per provider and model; unit metrics from day one (cost per 1,000 listings, per new listing found, per delivered alert).
- **Reliability:** idempotency key `source + sourceListingId + contentHash`; retries with backoff then dead-letter queue visible in the Review Console; circuit breaker per provider with fail-over; replayable snapshots; daily parser-drift check against fixtures.
- **Compliance:** listing facts, not people; hashed seller IDs; 30-day snapshots; eBay data used within its licence; Facebook go-live gate; self-serve cancellation; tier speeds stated with the measured floor.
- **Security:** server-only data access with per-request user scoping and row-level security on every user-facing table; secrets only in platform vaults; least-privilege database roles per module; no acting inside users' marketplace accounts.

## Scale stages

| Users | What breaks first | Response |
| --- | --- | --- |
| 1–100 | Nothing technical; thin comparables for rare models | 3–10 cells; hand review; corrections into the Price Book |
| 100–1,000 | Provider spend; alert noise | Cadence rule enforced; digest mode; circuit breakers |
| 1,000–10,000 | Table growth; dashboard queries; notification fan-out | Monthly partitions; Small/Medium compute plus read replica; batched notifications; cheaper snapshot storage |
| 10,000–100,000 | Nationwide provider spend; support load | Provider contracts; Large/XL compute; automated kill switches; analytics store for aggregates |
