# Decisions and constraints

These are standing rules. Change them only with a human decision recorded here.

## Product

- **Audience and first category:** Nabvy is for anyone in the UK who buys second-hand to resell or to get a good deal; it is not limited to tech flippers. The first category pack is GPUs and gaming PCs, chosen for clean product keys and strong price data; the first design partners are tech flippers. Other categories arrive as category packs (data, not code), in this order of intent: consoles and controllers, phones, laptops and PC parts, collectables, then cars. DVDs are out: CeX pays a penny for them and demand is falling.
- **Two entry points:** alerts on new online listings, and scan mode for items in front of the user.
- **Five version-1 features:** checked deal alerts with part-out maths; speed at parity with an honest freshness stamp; risk screening on every alert; hunts by postcode and radius with sensible defaults; one-tap action (open listing, prepared message, checklist, then "bought for" and "sold for" capture).
- **Not in version 1:** listing to any marketplace other than eBay; price-drop tracking; CRM; AI negotiation; auto-messaging sellers; native apps; DVDs.
- **Brand:** Nabvy. Domains: nabvy.com (marketing site, canonical), nabvy.co.uk (redirect), nabvy.app (the PWA); dibvy.com, dibvy.co.uk, dibvy.app redirect to Nabvy. DNS on Cloudflare; email hello@nabvy.com on Google Workspace.

## Data access

- **APIs first, Apify for the rest, no scrapers of our own.** eBay through its official APIs (Browse for live listings and image search; Marketplace Insights for sold prices when approved; Sell APIs for listing drafts with the user's OAuth consent). CeX through its web API at low volume, cached and capped, with a licensing request to CeX and CeXDB in progress. Facebook Marketplace, Gumtree and later Vinted through third-party Apify actors behind the provider adapter contract, two actors per marketplace with fail-over and spend caps; managed APIs such as ScrapeCreators only as a fallback.
- **Facebook go-live gate:** Facebook alerts are not exposed to paying users until a UK legal review of using provider-collected data (database right, UK GDPR) is complete. A per-provider kill switch exists from day one.
- **eBay Partner Network:** eBay alert clicks carry the EPN campaign ID; affiliate links are disclosed in the app.

## Platform

- **Database:** Supabase (existing project `fbapfy`, eu-west-1, Postgres 17), used as managed Postgres plus Storage, Queues and pg_cron. One database for every shape of data (relational, time series by partition, PostGIS, pgvector, pg_trgm, shallow graphs by recursive CTE). No graph database now; revisit only if fraud-ring or similar-item queries need more than three hops or exceed 500 ms p95 (then Apache AGE or Kuzu, Postgres staying the source of truth). Dashboards read from views and materialised views only. Switch only if the database line passes about $400 a month and a rival is materially cheaper for the same load.
- **Pipeline runtime:** Trigger.dev, with Supabase Queues plus Edge Functions as the fallback.
- **Authentication and authorisation:** Better Auth (MIT) with its Drizzle adapter on the Supabase Postgres database: magic-link email, Google sign-in, admin plugin for roles, captcha plugin with Cloudflare Turnstile, Stripe plugin for subscriptions. Supabase Auth, PostgREST and supabase-js are not used for application data; the browser never talks to the database. All data access runs server-side through Drizzle inside a transaction that sets the current user, and row-level security policies read that setting as a second layer.
- **How parts talk to each other:** three boundaries, three mechanisms. *Module to module* is in-process: modules are packages in one deployable that call each other's exported functions and publish thin events through Trigger.dev and Supabase Queues; there is no HTTP between modules. *Browser to server* is one typed procedure layer built with oRPC (MIT): every procedure validates input with the contracts schemas, checks the session, and calls a module function inside `withUser`; server actions are allowed only for plain form submits and must call the same procedures. *Outside world* is HTTP: webhooks in (Stripe, Telegram, Dub) as route handlers, and a versioned public REST API generated from the same oRPC router with OpenAPI for Business-tier customers, bots and AI tools. Microservices are ruled out until a module needs to scale or deploy independently, which the contracts make possible without a rewrite.
- **Language:** TypeScript end to end. Python only if valuation later needs libraries TypeScript lacks.
- **Models:** Vercel AI SDK with Zod structured outputs. Claude Haiku 4.5 by default; Claude Sonnet 5 for listings above a value threshold or below a confidence threshold (thresholds set from measured data, see `docs/valuation.md`); a vision-capable model for photos in scan mode. Batch pricing for backfills; prompt caching for pack instructions.
- **Snapshots:** raw provider responses in Supabase Storage for 30 days.

## Pricing and cadence

- **Pricing model ("watch and check"):** two kinds of value, priced two ways. *Watching* (live alerts on areas at a cadence) is a flat subscription entitlement because its cost is shared across everyone in a cell. *Checking* (scans, live on-demand lookups across all sources, similar-item searches, boosts, exports) is metered usage in pounds, like Apify's prepaid usage: every plan includes a monthly usage allowance, then pay-as-you-go top-ups, with a lower unit price on higher plans. Every feature is available on every tier, including Free; tiers differ only in areas, cadence and usage allowance.
- **Tiers:** Free (£0.50 usage a month with full data enrichment, live eBay alerts funded by affiliate commission, Nabvy Daily as the delivery of other sources, no live paid-source areas); Standard £9/month or £90/year (one 40 km area at 5-minute cadence, £10 usage included, top-ups at list price); Pro £29/month or £290/year (three areas, 1-minute cadence, £35 usage included, top-ups 10% below list); Business £99/month or £990/year (ten areas, 1-minute cadence, export and channel feeds, £120 usage included, top-ups 20% below list). Extra area £4/month on any paid plan. Top-up packs £5, £10, £25; unused included usage expires monthly, purchased usage does not.
- **Trial:** when a Free user reaches the cap the app offers a 7-day Standard trial with a card and £3 of bonus usage valid for the trial; one trial per account; converts to Standard unless cancelled. An Apify-style entry plan (£1 a month billed £6 for six months with a bonus usage balance) is a later experiment, not a launch feature.
- **Usage list prices (pence, set at roughly two to three times measured cost; reviewed after week one):** scan with cached data 2; scan or lookup with a live check across all sources 15; similar-item search 10; 24-hour product boost 149; 7-day boost 499; export 50. Prices are shown before every metered action.
- **Cadence rule:** a cell runs at the fastest cadence whose monthly provider cost stays under 60% of that cell's subscription revenue, checked daily; 5 minutes is the default; an hourly nationwide sweep is the floor. Everyone in a cell gets the cell's cadence, and the app says so. Speed is a property of the cell, never an artificial delay.
- **Revenue rules:** annual plans at ten months' price; design partners on lifetime Pro; £5 usage credit to both sides per paying referral; 14-day money-back on a first subscription payment; usage top-ups and boosts non-refundable once used. Prices include UK VAT (Stripe Tax).
- **Free-tier limits:** 3 active hunts, £0.50 usage a month, eBay alerts live, other sources as a daily digest.
- **Marketing machinery from day one:** lifecycle messaging on PostHog Workflows triggered by first-party events (abandoned checkout and onboarding, activation, cap reached, trial, failed payment, win-back, weekly review); Nabvy Daily, a daily brief with local hot deals, the user's product price moves and a UK market recap (plus regional CeX comparisons where we hold data), sent by email and channel post with a public indexable web version; transactional email on Resend with templates in the repository; SEO price pages generated from the Price Book; waitlist before launch; marketing consent by unticked box or soft opt-in with one-click unsubscribe and a preference centre. No separate marketing suite. Details in `docs/marketing.md`.
- **Affiliate and creator programme from day one of the public beta,** run on Dub Partners (open source): 30% of net subscription revenue for 12 months, 10% on usage top-ups, tiers to 35% and 40% by active referred subscribers, 90-day last-click cookie, codes attribute without a click, £5 usage credit to the referred user, 30-day hold with refund clawback, monthly payouts with a £20 minimum, mandatory ad disclosure. Details in `docs/affiliates.md`.

## Build order

- **Build order:** Facebook Marketplace first, using the existing Nabvy Apify actor as the provider (it is ready); then eBay through the official API; then scan mode; then Gumtree; then the web app, billing and public beta. Facebook alerts stay private (the founder and design partners only) until the legal gate clears.

## Success metrics

| Metric | Role | Target |
| --- | --- | --- |
| Verified profitable flips attributed to alerts, per month | North star | Grows month on month from the first paid week |
| Alert precision (share of alerts users mark as a real deal) | Guardrail | ≥50% in beta, rising to 70% |
| Median freshness per source (listed to delivered) | Guardrail | Within 2 minutes of the source's measured floor on the fast tier |
| Cost per delivered alert | Guardrail | Under £0.05 |
| Week-4 retention of paying users | Guardrail | ≥40% |

## Open questions a human must answer

- Model escalation thresholds, after the first week of measured extraction quality and cost.
- eBay Marketplace Insights, Partner Network and Sell API approvals.
- CeX or CeXDB licensing outcome.
- UK legal review outcome for provider-collected Facebook and Gumtree data.
