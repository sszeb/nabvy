# Decisions and constraints

These are standing rules. Change them only with a human decision recorded here.

## Precedence: the Facebook actor brief

**Owner's decision, 2026-09-24.** Where this build pack conflicts with the Facebook actor brief in `sebtimize/fb-scrap-engine` (`docs/HANDOFF.md`, sections "Rules" and "The app: what we want it to do, and what the data allows", and the designs they link; reading list and rules in `docs/fb-actor-sources.md`), the brief wins because it is more up to date. The brief's `docs/APP_INTEGRATION_GUIDE.md` and `docs/design/COPY_ADVERT_SPAM.md` do not exist yet; Nabvy writes its own integration plan and copy-advert design either way ("The actor is a tool" below). The build-pack documents affected below are rewritten to match before task 0.2 (contracts) starts. Until then, read the build pack through this table.

| Topic | Build pack says | Brief says (wins) |
| --- | --- | --- |
| Seller data | Never store seller names or profile links; hash public seller IDs before storage (`CLAUDE.md`). Raw provider responses kept 30 days as snapshots (`CLAUDE.md`, `docs/modules.md`) | Keep seller data for internal use only, in a restricted private schema the Data API cannot reach. Never show seller identity (names, IDs, pictures, account links) or anything derived that identifies a seller. The internal seller key would be an HMAC of the ID with a secret held outside the database, built only after the DPIA (`SELLER_DATA.md` §3.2). Raw snapshots hold the actor's seller fields, so they count as part of that restricted store. Minimisation still applies: no measured use needs names or pictures (`SELLER_DATA.md` §5). *Superseded for storage by "Actor data kept in full" below: everything is kept; only what users see is restricted.* |
| Seller-derived flags | Risk flags `new_seller`, `reused_photos` and `stock_photo` are computed from seller hashes (`docs/packs/gpu-pc.md`, `docs/modules.md`) | Public tables never hold a seller key or any flag derived from seller keys; fraud signals are listing-level only (`SELLER_DATA.md` §3.7, §5) |
| Labels and scores | Risk flags are signals, never accusations; wording avoids calling a seller a scammer (`docs/compliance.md`). A numeric risk score (0..1) reduces the deal score (`docs/contracts.md`, `docs/valuation.md`) | "Suspected scam", "suspected trade seller", "suspected flipper" and similar are allowed, each worded as a suspicion, shown with its evidence, from a documented rule with calibrated thresholds, with a report and correction route, never revealing seller identity. Scam labels run in shadow mode first; wording gets legal review before launch. Other warning signs are neutral facts. "No scam scores"; never show an unexplained score (`HANDOFF.md`) |
| Price-drop watch | Not in version 1 (`docs/decisions.md`, Product) | Build first: price history within one listing ID only. Relists are merged silently; never show history across listing IDs, "relisted" or "seen before" |
| Price wording | Fair-value range; `ask_based` valuations from asks (`docs/valuation.md`) | Never present asking prices as sale prices or as what something is "worth" or "fair". Show asking-price position (same spec and condition). The brief is inconsistent on thresholds: `HANDOFF.md` and the `SELLER_DATA.md` CI rule say n≥10 only; `PARTS_INTELLIGENCE.md` also allows "thin" at 5–9. Until the owner decides, the conservative reading applies: shown only at n≥10 (see `docs/questions.md`) |
| Sale signals | Vanished listings are sale signals; lifecycle feeds sell-through and days-to-sell (`docs/architecture.md`, `docs/valuation.md`) | A listing that disappears may not have sold. Opt-in sold prices reported by users are the only route to sale prices (`PARTS_INTELLIGENCE.md` §3, §4) |
| Part-out maths | Part-out maths is a version-1 feature (`docs/decisions.md`, Product) | A part-out or flip calculator comes later, once standalone part prices exist; an asks-based sum is not a part-out margin (`HANDOFF.md`, `PARTS_INTELLIGENCE.md` §2, §3) |
| Cadence and tiers | Tiers are sold by cadence: Standard 5-minute, Pro and Business 1-minute (`docs/decisions.md`, Pricing) | T2 sets the cadence; no faster checks or "instant" tier are sold until T2 reports (`HANDOFF.md`, `PARTS_INTELLIGENCE.md` §3) |
| Region and currency | UK; GBP only (`docs/operations.md`) | UK and Ireland. Irish asks form their own EUR groups, never converted into GBP ones |
| Location precision | Coordinates stored to 100 m; a deals map with pins (`docs/compliance.md`, `docs/dashboards.md`) | Show locations no finer than town or distance (`SELLER_DATA.md` §5) |
| Per-user work | Scan mode's on-demand fetch includes Facebook asks via Apify per scan (`docs/scan-mode.md`) | Never run Facebook fetches or AI per user. Pasted links join the shared, deduplicated details queue |
| Search planning | One watch per marketplace, category and 40 km cell, H3 resolution 4 (`docs/architecture.md`, `docs/engineering.md`) | Per region: a verified centre `cityId` × a few terms, never per user (seed: `city-pages.seed.json`, 771 city IDs, 5 verified centres). Newest-first checks, default-order catch-up, daily sweeps; the app chooses which IDs get details and sends them as `listingIds` batches; the actor never filters or judges |
| Photos | Photo fingerprint and embedding per listing; Storage for listing photos (`docs/engineering.md`, `docs/architecture.md`) | Photo review only when the text is silent; photos fetched through Apify; bytes deleted after review; never serve photos from our own storage |
| Resale of listing data | Business tier: export, channel feeds and a public deals API (`docs/decisions.md`, Pricing; backlog 5.3, 5.4a) | Avoid any resale of listings, descriptions or photos; sale or sharing with third parties waits for legal advice (`PARTS_INTELLIGENCE.md` §3, §6) |
| Legal gates | Facebook alerts reach paying users only after a UK legal review (`docs/compliance.md`) | Do not charge before legal advice (Meta's terms, database right, copyright, UK GDPR). An LIA and a DPIA come before further collection, not only before launch; get the legal view before collecting seller data at scale (`PARTS_INTELLIGENCE.md` §6, `SELLER_DATA.md` §5) |
| Apify token | `APIFY_TOKEN` in the pipeline's platform vault (`docs/secrets.md`) | A Supabase Edge Function secret; never in code or chat. Only actor `YfdUav3sZ2BgEf8rh`, never `JR2fdK8Nj6OLCwKkP`. It is the Edge Function secret `APIFY_TOKEN` on `fbapfy`, read only by the `apify-gateway` Edge Function (`supabase/README.md`) |

## Actor data kept in full

**Owner's decision, 2026-09-24.** Keep all the data the actor returns: nothing is removed, redacted or stripped at ingest, including seller names, IDs and pictures and the full listing text. It is needed for scam detection and other internal analysis, and developers see the full data at all times. The one rule is that **end users of the app are never shown seller identity**. The simplest way to meet it:

- users only read through the app's API and its `v_` views;
- those views select an explicit allowlist of fields, and seller fields are never on it;
- a CI test on user-facing output enforces this when the web app arrives.

This replaces minimisation and stripping wherever the build pack or the brief call for them (`CLAUDE.md` "No personal data beyond need"; `SELLER_DATA.md` §5; `PARTS_INTELLIGENCE.md` on stripping descriptions). It does not change what users may see (Precedence table above). How long raw data is kept has not been set; it is kept until the owner decides otherwise.

**Storage shape (plan for task 0.3):** each actor row is stored whole as `jsonb`, so no field is lost even when the actor adds new ones. The fields Nabvy filters and sorts on also get real columns (listing ID, price, currency, title, listed time, town, coordinates, availability, category, description status).

Not a conflict in price: the brief's money section (Plus at about £4.99 a month) is labelled "inputs, not decisions", so the price points below stand until the owner decides otherwise. What each tier promises in cadence is a conflict (row "Cadence and tiers").

New work from the brief, to be placed in the backlog with Nabvy's own integration plan ("The actor is a tool" below): a parts record per listing (listing kind; every part quoted from the listing with its inclusion status; rules first from `part-patterns.json`, AI only for gaps, once per listing, shared by every user); spec search and alerts, where silence is never a "no" ("GPU not stated — ask the seller"); a free noise filter (wanted, swap and "I buy" adverts, keyword stuffing, laptops, mention-only hits); the copy-advert spam flag; suspected-behaviour labels; asking-price position; the price-drop watch; demand signals (first-party wants plus wanted adverts, cells under 5 suppressed); seller objection and erasure with a suppression list keyed by a hash of the listing ID (before launch); CI tests that fail if user-facing output carries seller fields, contact details, suppressed listings or aggregates under the display threshold (`SELLER_DATA.md` §3, §5).

## The actor is a tool; Nabvy owns the rest

**Owner's decision, 2026-09-24.** The Facebook actor is a plain fetch tool: it runs searches and fetches listing details, and nothing more. Everything else is Nabvy's to design and build: copy-advert spam detection, the parts record, noise filtering, suspected-behaviour labels, asking-price position, the price-drop watch, scam signals, alerts and the rest. Nabvy writes its own integration plan and copy-advert spam design (in progress, `docs/progress.md`). The actor repo's `docs/APP_INTEGRATION_GUIDE.md` and `docs/design/COPY_ADVERT_SPAM.md` are on the owner's reading list but not written yet (checked at `f177a44`); they are checked for until they land, and anything useful in them is folded into Nabvy's own plans.

**Only the listed actor files are read** (owner, 2026-09-24). The owner asked for the actor's documents to be used "as knowledge to help you in developing the app as a whole", and then limited that to the files in the owner's reading list, `docs/fb-actor-sources.md`; the actor repository is a separate project and the rest of it is not scanned. In scope:
- `HANDOFF.md`, sections "Rules" and "The app: what we want it to do, and what the data allows" only;
- the designs `PARTS_INTELLIGENCE.md`, `CONTAINER_LISTINGS.md` and `SELLER_DATA.md`;
- the data files `city-pages.seed.json` and `part-patterns.json`;
- `app/route-health.js` and `test/route-health.test.js`;
- `.actor/input_schema.json`;
- the optional references `SCALE_PLAN.md`, `MONETISATION_INPUTS.md`, `EVIDENCE_LEDGER.md` and `README.md`.

What these files teach informs the whole app, not only the calls to the actor. The Precedence table above still decides conflicts; knowledge that points at a product decision (pricing, tiers, categories, user-facing wording) goes to `docs/questions.md` rather than being decided.

## Atomic modules

**Owner's decision, 2026-09-24.** Each function of the app is a stand-alone atomic module, starting with copy-advert spam detection; the other functions (the parts record, the noise filter, suspected-behaviour labels, asking-price position, the price-drop watch and the rest) are treated the same way. Working definition, until the owner amends it:

- **One job.** A module does one function, lives in `services/<module>/` with the shape in `CLAUDE.md`, and has its own `README.md`, fixtures and tests.
- **Own data.** It owns its tables; no other module writes them. Others read its output only through its `v_` views or its exported functions.
- **Contracts only.** Its types live in `packages/contracts` under its own name. It talks to other modules only through those contracts and thin events; it never imports another module's internals and never calls another module over HTTP.
- **Stands alone.** It can be built, tested, switched off and replaced on its own. When it is off, the modules that read its output carry on without it.
- **Pipeline rules.** Handlers take batches, are idempotent (key `source + sourceListingId + contentHash`) and stamp their T-timestamps.

The build pack's larger modules (`docs/modules.md`) are split to match; the module catalogue that does this is in progress (`docs/progress.md`).

**How modules are built** (owner, 2026-09-24): foundation first, then parallel waves.
1. **Foundation, one session.** One session lays what every module builds on. It started on 2026-09-24 before the catalogue was approved, on the owner's instruction to run wave 0 in parallel ("start as many sessions as needed"). It builds only shared machinery that does not depend on the module list:
   - per-module contract files and database-schema namespaces in `packages/contracts` and `packages/db`;
   - an event registry with one file per module;
   - a scaffold script for the module shape;
   - the rule that a module session touches only its own folder, contract file and migration file.
2. **Waves.** Every module whose inputs and owner decisions are ready starts at the same time, each in its own session, on its own branch `task/<id>-<module>`, with one pull request per module. Each module is built and tested against fixtures. Migrations are tested only on a local throwaway Postgres (`pnpm db:dry-run`); the coordinator session applies them to Supabase after the pull request is merged. A module waiting on an owner decision or a legal gate waits for a later wave.
3. **One coordinator session.** It writes each module session's brief, checks each pull request for consistency with the contracts, keeps `docs/progress.md` itself so branches do not conflict over it, and applies merged migrations to Supabase.
4. **One reviewer session reviews, approves and merges every pull request** (owner, 2026-09-24, for the production MVP). It merges only when its review passes and CI is green on the exact commit it reviewed. GitHub does not let an account approve its own pull request, and every session acts as the owner's account, so the approval is recorded as a review comment whose verdict reads "Approved". It never pushes to a pull request's branch; the authoring session fixes what the review finds. A pull request that needs an owner decision (pricing, tiers, categories, wording shown to users) waits for the owner.

For module work this replaces `CLAUDE.md`'s "one task at a time".

## MVP scope and pipeline runtime

**Owner's decisions, 2026-09-24.**
- **Scope.** The production MVP for this push is a **public beta with full functionality and one source: Facebook Marketplace through Nabvy's actor**. eBay, CeX, Gumtree and the other sources come later. Features that the build pack fed from other sources work from Facebook data alone. For example, price information is the asking-price position from Facebook asks (the Precedence row "Price wording"), with no eBay sold prices or CeX prices. The legal gates in the Precedence table still apply: no charging before legal advice, and an LIA and a DPIA before further collection (row "Legal gates").
- **Frontend.** A modern, professional design, in the spirit of the Apify console, eBay and ChatGPT:
  - an app shell with a left sidebar;
  - clean listing cards with the price up front;
  - a calm, spacious layout with a prominent search box;
  - light and dark themes.

  Built on the build pack's stack (Next.js, Tailwind, shadcn/ui); the owner lets the build choose the look.
- **Charging from launch** (owner's explicit override, 2026-09-24). Billing is built and live at the public beta launch. This overrides the brief's "do not charge before legal advice" (Precedence row "Legal gates") on the owner's instruction. The rest of that row still stands: an LIA and a DPIA come before further collection. Plans and prices are those under "Pricing and cadence" below. What each tier promises in cadence stays open until T2 reports (Precedence row "Cadence and tiers"), so plans are not sold on speed meanwhile.
- **Listing photos.** Not shown in the web app until legal advice says they may be (owner, 2026-09-24). Cards show a neutral placeholder and an "Open on Facebook" link; a feature flag, off by default, lets photos be switched on later without a redesign.
- **Scan mode uses vision AI per scan** (owner's explicit override, 2026-09-24). Photo recognition runs a model call per scan, capped per user by `SCAN_SPEND_CAP_MINOR`. This overrides the brief's "never run AI per user" (Precedence row "Per-user work") for scan recognition only. Facebook fetches are still never run per user: pasted links join the shared, deduplicated details queue.
- **No refunds** (owner, 2026-09-24). A strict no-refunds policy replaces the 14-day money-back. Nothing is refunded at the customer's request:
  - subscriptions, including a trial that has converted, annual plans and extra areas;
  - usage top-ups, boosts and exports.

  How it is built:
  - **Consent at checkout.** Before any first payment, including a trial that will convert, Checkout requires the customer's express request to start now, their acknowledgement that they lose the 14-day right to cancel, and their acceptance that payments are non-refundable. The consent and its time are stored with the billing event. Without that consent, UK law (Consumer Contracts Regulations 2013) leaves a 14-day cancellation right in place, so the policy depends on it.
  - **Cancellation.** Customers can cancel at any time in the billing portal. It takes effect at the end of the paid period, and access continues until then.
  - **Plan changes.** Downgrades are scheduled for the period end, so no credit arises. Upgrades take effect at once and charge the difference.
  - **Disclosure.** The pricing page, Checkout and the terms state "Payments are non-refundable" before purchase.
  - **Reminders.** A reminder goes out before a trial converts and before an annual renewal.
  - **No refund button** anywhere for users or admins. The one exception is a refund the law requires, for example under the Consumer Rights Act 2015 for a service not provided with reasonable care. That is issued only by the owner through an audited admin action with a stated legal reason.
  - **Chargebacks** are answered in Stripe with the stored consent, and they reverse any affiliate commission.
  - **Failed actions.** A metered action that fails returns its usage credits (a ledger reversal, not a refund of money).

  The wording shown to customers needs legal review before launch (`docs/questions.md`).
- **Pipeline runtime.** **Trigger.dev** runs the pipeline modules, as the build pack planned. Apify is still called only through the Supabase `apify-gateway` Edge Function: pipeline tasks queue gateway jobs in the database and read the collected rows back. This answers the runtime question in `docs/questions.md`.

## Product

- **Audience and first category:** Nabvy is for anyone in the UK who buys second-hand to resell or to get a good deal; it is not limited to tech flippers. The first category pack is GPUs and gaming PCs, chosen for clean product keys and strong price data; the first design partners are tech flippers. Other categories arrive as category packs (data, not code), in this order of intent: consoles and controllers, phones, laptops and PC parts, collectables, then cars. DVDs are out: CeX pays a penny for them and demand is falling.
- **Two entry points:** alerts on new online listings, and scan mode for items in front of the user.
- **Five version-1 features:** checked deal alerts with part-out maths; speed at parity with an honest freshness stamp; risk screening on every alert; hunts by postcode and radius with sensible defaults; one-tap action (open listing, prepared message, checklist, then "bought for" and "sold for" capture). *(Part-out maths is superseded by the Precedence row "Part-out maths"; for this push, the scope is "MVP scope and pipeline runtime" above.)*
- **Not in version 1:** listing to any marketplace other than eBay; price-drop tracking; CRM; AI negotiation; auto-messaging sellers; native apps; DVDs. *(Price-drop tracking is superseded: the Precedence row "Price-drop watch" makes it build-first.)*
- **Brand:** Nabvy. Domains: nabvy.com (marketing site, canonical), nabvy.co.uk (redirect), nabvy.app (the PWA); dibvy.com, dibvy.co.uk, dibvy.app redirect to Nabvy. DNS on Cloudflare; email hello@nabvy.com on Google Workspace.

## Data access

- **APIs first, Apify for the rest, no scrapers of our own.** eBay through its official APIs (Browse for live listings and image search; Marketplace Insights for sold prices when approved; Sell APIs for listing drafts with the user's OAuth consent). CeX through its web API at low volume, cached and capped, with a licensing request to CeX and CeXDB in progress. Facebook Marketplace, Gumtree and later Vinted through third-party Apify actors behind the provider adapter contract, two actors per marketplace with fail-over and spend caps; managed APIs such as ScrapeCreators only as a fallback. *(Superseded for Facebook: one actor only, `YfdUav3sZ2BgEf8rh`, no fallback, CLAUDE.md and the Precedence row "Apify token". For this push Facebook is the only source.)*
- **Facebook go-live gate:** Facebook alerts are not exposed to paying users until a UK legal review of using provider-collected data (database right, UK GDPR) is complete. A per-provider kill switch exists from day one.
- **eBay Partner Network:** eBay alert clicks carry the EPN campaign ID; affiliate links are disclosed in the app.

## Platform

- **Database:** Supabase (existing project `fbapfy`, eu-west-1, Postgres 17), used as managed Postgres plus Storage, Queues and pg_cron. One database for every shape of data (relational, time series by partition, PostGIS, pgvector, pg_trgm, shallow graphs by recursive CTE). No graph database now; revisit only if fraud-ring or similar-item queries need more than three hops or exceed 500 ms p95 (then Apache AGE or Kuzu, Postgres staying the source of truth). Dashboards read from views and materialised views only. Switch only if the database line passes about $400 a month and a rival is materially cheaper for the same load.
- **Pipeline runtime:** Trigger.dev, with Supabase Queues plus Edge Functions as the fallback. *(Confirmed by the owner on 2026-09-24: "MVP scope and pipeline runtime" above.)*
- **Authentication and authorisation:** Better Auth (MIT) with its Drizzle adapter on the Supabase Postgres database: magic-link email, Google sign-in, admin plugin for roles, captcha plugin with Cloudflare Turnstile, Stripe plugin for subscriptions. Supabase Auth, PostgREST and supabase-js are not used for application data; the browser never talks to the database. All data access runs server-side through Drizzle inside a transaction that sets the current user, and row-level security policies read that setting as a second layer.
- **How parts talk to each other:** three boundaries, three mechanisms. *Module to module* is in-process: modules are packages in one deployable that call each other's exported functions and publish thin events through Trigger.dev and Supabase Queues; there is no HTTP between modules. *Browser to server* is one typed procedure layer built with oRPC (MIT): every procedure validates input with the contracts schemas, checks the session, and calls a module function inside `withUser`; server actions are allowed only for plain form submits and must call the same procedures. *Outside world* is HTTP: webhooks in (Stripe, Telegram, Dub) as route handlers, and a versioned public REST API generated from the same oRPC router with OpenAPI for Business-tier customers, bots and AI tools. Microservices are ruled out until a module needs to scale or deploy independently, which the contracts make possible without a rewrite.
- **Language:** TypeScript end to end. Python only if valuation later needs libraries TypeScript lacks.
- **Models:** Vercel AI SDK with Zod structured outputs. Claude Haiku 4.5 by default; Claude Sonnet 5 for listings above a value threshold or below a confidence threshold (thresholds set from measured data, see `docs/valuation.md`); a vision-capable model for photos in scan mode. Batch pricing for backfills; prompt caching for pack instructions.
- **Snapshots:** raw provider responses in Supabase Storage for 30 days. *(Superseded: raw actor data is kept in full and its retention is not yet set, "Actor data kept in full" above.)*

## Pricing and cadence

- **Pricing model ("watch and check"):** two kinds of value, priced two ways. *Watching* (live alerts on areas at a cadence) is a flat subscription entitlement because its cost is shared across everyone in a cell. *Checking* (scans, live on-demand lookups across all sources, similar-item searches, boosts, exports) is metered usage in pounds, like Apify's prepaid usage: every plan includes a monthly usage allowance, then pay-as-you-go top-ups, with a lower unit price on higher plans. Every feature is available on every tier, including Free; tiers differ only in areas, cadence and usage allowance.
- **Tiers:** Free (£0.50 usage a month with full data enrichment, live eBay alerts funded by affiliate commission, Nabvy Daily as the delivery of other sources, no live paid-source areas); Standard £9/month or £90/year (one 40 km area at 5-minute cadence, £10 usage included, top-ups at list price); Pro £29/month or £290/year (three areas, 1-minute cadence, £35 usage included, top-ups 10% below list); Business £99/month or £990/year (ten areas, 1-minute cadence, export and channel feeds, £120 usage included, top-ups 20% below list). Extra area £4/month on any paid plan. Top-up packs £5, £10, £25; unused included usage expires monthly, purchased usage does not. *(What each tier promises in cadence waits for T2, Precedence row "Cadence and tiers"; for this push Facebook is the only source, so eBay items do not apply.)*
- **Trial:** when a Free user reaches the cap the app offers a 7-day Standard trial with a card and £3 of bonus usage valid for the trial; one trial per account; converts to Standard unless cancelled. An Apify-style entry plan (£1 a month billed £6 for six months with a bonus usage balance) is a later experiment, not a launch feature.
- **Usage list prices (pence, set at roughly two to three times measured cost; reviewed after week one):** scan with cached data 2; scan or lookup with a live check across all sources 15; similar-item search 10; 24-hour product boost 149; 7-day boost 499; export 50. Prices are shown before every metered action.
- **Cadence rule:** a cell runs at the fastest cadence whose monthly provider cost stays under 60% of that cell's subscription revenue, checked daily; 5 minutes is the default; an hourly nationwide sweep is the floor. Everyone in a cell gets the cell's cadence, and the app says so. Speed is a property of the cell, never an artificial delay.
- **Revenue rules:** annual plans at ten months' price; design partners on lifetime Pro; £5 usage credit to both sides per paying referral; no refunds (owner, 2026-09-24; "No refunds" under "MVP scope and pipeline runtime"). Prices include UK VAT (Stripe Tax).
- **Free-tier limits:** 3 active hunts, £0.50 usage a month, eBay alerts live, other sources as a daily digest.
- **Marketing machinery from day one:** lifecycle messaging on PostHog Workflows triggered by first-party events (abandoned checkout and onboarding, activation, cap reached, trial, failed payment, win-back, weekly review); Nabvy Daily, a daily brief with local hot deals, the user's product price moves and a UK market recap (plus regional CeX comparisons where we hold data), sent by email and channel post with a public indexable web version; transactional email on Resend with templates in the repository; SEO price pages generated from the Price Book; waitlist before launch; marketing consent by unticked box or soft opt-in with one-click unsubscribe and a preference centre. No separate marketing suite. Details in `docs/marketing.md`.
- **Affiliate and creator programme from day one of the public beta,** run on Dub Partners (open source): 30% of net subscription revenue for 12 months, 10% on usage top-ups, tiers to 35% and 40% by active referred subscribers, 90-day last-click cookie, codes attribute without a click, £5 usage credit to the referred user, 30-day hold with refund clawback, monthly payouts with a £20 minimum, mandatory ad disclosure. Details in `docs/affiliates.md`.

## Build order

- **Build order:** Facebook Marketplace first, using the existing Nabvy Apify actor as the provider (it is ready); then eBay through the official API; then scan mode; then Gumtree; then the web app, billing and public beta. Facebook alerts stay private (the founder and design partners only) until the legal gate clears. *(Superseded for this push by "MVP scope and pipeline runtime" above: a full-featured public beta on Facebook only.)*

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
