# Backlog

Work in order. One task per session unless a human says otherwise. Every task ends with: types in `packages/contracts`, a fixture-based test, `pnpm typecheck && pnpm lint && pnpm test` clean, and a note in the module README. A task that needs a secret you do not have stops and records the need in `docs/questions.md`.

Check-in points are marked **[CHECK-IN]**: stop and wait for a human before continuing.

## Phase 0 — Foundation

- **0.1 Scaffold the monorepo.** pnpm workspaces + Turborepo; Biome; Vitest; TypeScript strict; folders and package names from `docs/engineering.md`; `@nabvy/config` with Zod-validated env; root scripts from `CLAUDE.md`; `.env.example` with every variable in `docs/secrets.md`; `.nvmrc`. Done: `pnpm install && pnpm typecheck && pnpm lint && pnpm test` pass on an empty project; config fails fast on a missing variable.
- **0.2 Contracts package.** Every schema in `docs/contracts.md` as Zod with inferred types, exported from `packages/contracts`. Done: schemas parse the sample objects in `fixtures/contracts/`; a round-trip test per entity.
- **0.3 Database schema.** `@nabvy/db`: Drizzle schema and migrations for every table in `docs/contracts.md` with owners, `v_` views, PostGIS, pgvector, pg_trgm, `uuidv7()`, monthly partitioning of `price_observations`; Better Auth tables generated with `@better-auth/cli generate` and committed; roles `nabvy_app` and `nabvy_pipeline` without `bypassrls`; the `withUser` helper and the RLS policies from `docs/engineering.md`; PostgREST disabled for `public`; seeds: the founder user (`ADMIN_EMAILS`), the UK `cells` set at H3 resolution 4, an empty `cell_provider_locations`. Done: migration applies cleanly to a fresh Supabase branch; an RLS test proves a query outside `withUser` returns nothing and inside it returns only the user's rows; the pipeline role can read `hunts` and insert `alerts` but cannot read `user_profiles`.
- **0.4 Pack loader.** `packages/packs` with the `CategoryPack` format and `gpu-pc` from `docs/packs/gpu-pc.md` (regexes, dictionary seed, parameters, risk rule references, template). Done: pack validates against the format; dictionary resolves the alias fixtures.
- **0.5 CI pipeline.** GitHub Actions per `docs/operations.md`: typecheck, lint, test, fixtures, gitleaks, audit, migration dry-run, Vercel preview. Done: a pull request shows all checks green.
- **0.5a Waitlist and marketing site skeleton.** nabvy.com with the landing page, `/waitlist` (email, postcode, products) into the `waitlist` table, `/freshness` placeholder, UTM capture, SPF/DKIM/DMARC for both sending subdomains. Done: a waitlist entry lands in the database with its UTM; the domain passes an email authentication check.
- **0.6 Fixtures harness.** `fixtures/` layout from `docs/fixtures.md` and a test runner that reports pass rate per stage. Done: runner executes on the placeholder fixture and prints a report.
- **0.7 Module boundary check.** A Node script beside `scripts/split-module-cards.mjs` compares each `services/<m>/package.json` `@nabvy/*` dependency with the module card's "Depends on" line (soft dependencies only through `@nabvy/contracts`), and runs as a non-blocking step in the existing CI job for services that have a card. Until it runs, the reviewer checks this by hand. Done: it flags a planted bad dependency in a fixture.

**[CHECK-IN]**

- **0.8 Config per module.** Give `@nabvy/config` a `./modules/*` export (rule 14) and a module file per module; move `USD_GBP_RATE` out of the `apify` group into its own group; then move cost-meter's settle delay and price table from `services/cost-meter/src/config.ts` into `packages/config/src/modules/cost-meter.ts`. Raised by the cost-meter build and review (PR #16).
- **0.9 Event transport.** No layer publishes or delivers module events yet (no task wrapper, no Trigger.dev publisher), so modules such as `incidents` return the event envelope instead of emitting it. Build the thin-event publisher and the handler wrapper (idempotency key `source + sourceListingId + contentHash`, T-timestamps per `docs/contracts.md`, failed events to `incidents`), then replace the stubs. Top model; needed before any pipeline module runs end to end. Raised by incidents (PR #19).
- **0.9a Wire incidents into the transport.** After #19 and #20 merge: make incidents' `RecordDeadLetterInput` an alias of the core `DeadLetter` contract, and pass `incidents.record` as the `DeadLetterSink` when the first task is wired (replaces incidents' stub). Sonnet.
- **0.9b Test timeouts under load.** Cost-meter's PGlite `beforeAll` times out at 10 s under the full parallel `pnpm test` on a 4-core container (also on `main`). Raise `hookTimeout` for the PGlite suites or share one instance. Sonnet.

## Phase 1 — Walking skeleton on Facebook (our actor)

- **1.0 Document the Facebook actor.** Run the deployed actor once by hand; record its real input schema and output fields in `services/source-adapters/README.md`; map every field to the target shape in `docs/providers.md`; fill `cell_provider_locations` for the founder's cell and its neighbours; list any missing required field in `docs/questions.md`. Done: the mapping table exists and one recorded raw response is saved under `fixtures/listings/facebook/`.
- **1.1 Apify Facebook adapter.** `apify-facebook-nabvy` implementing `ProviderAdapter.watch` and `detail` with the input mapping in `docs/providers.md`; response snapshots to storage; cost and latency metering; seller hashing. Done: normalisation test from three recorded raw responses; a live smoke test on one cell writes stubs to `listings`.
- **1.2 Crawl planner (minimal).** One hardcoded hunt row → one crawl unit (computers, the founder's cell) → scheduled tick at 300 s → `crawl.due`. Done: the unit runs on schedule and `crawl_runs` fills.
- **1.3 Listing registry.** Upsert, `contentHash`, new/changed detection, high-water mark update, recheck scheduling at 6/24/72 h. Done: second run of the same page produces zero `listing.new`; a changed price produces `listing.changed`.
- **1.4 Cheap gate and detail fetch.** Gate from the pack; `detail.requested` in batches of 20–50; `details.fetched` writes `listing_details`, photo fingerprint and embedding. Done: gate precision ≥ 90% on fixtures; details stored for candidates only.
- **1.5 Extraction, rules tier + Haiku tier.** `generateObject` with `GpuPcFacts`; per-field confidence; cache by `contentHash`; quarantine on invalid output; product-key resolution by dictionary then pg_trgm; Langfuse tracing through OpenTelemetry with `listingId`, `packId`, tier and cost, trace ID stored on `item_facts`; pack prompts fetched from Langfuse prompt management by label. Done: pass rate on fixtures reported; 20 real listings extracted and spot-checked by a human; traces visible with cost per listing.
- **1.5a Evaluation harness.** Fixtures mirrored as a Langfuse dataset; deterministic scorers (field match, hidden-GPU detection, no invented numbers); an evaluation run per prompt or model change linked from the pull request. Done: a deliberately weakened prompt fails the run.
- **1.6 Price Book v0 and valuation v0.** Observations from asks only; value band with `ask_based` state; CeX cash price via `cex-web` for the top 50 product keys; valuation per `docs/valuation.md` with margin, deal score, confidence, explanation; `unvalued` when data is thin. Done: fixture valuations match hand values within tolerance; explanation contains only input numbers.
- **1.7 Risk screener v0.** Rules `wanted_post`, `empty_box`, `parts_only`, `mining`, `untested`, `deposit_request`, `price_far_below_floor`. Done: rule tests pass; scores stored.
- **1.8 Router and Telegram dispatcher.** Match against the hunt; dedupe; deal-card message with freshness stamp and open link; `alerts` and `delivery_log` written; the founder's chat linked through `FOUNDER_TELEGRAM_CHAT_ID` until channel linking exists. Done: a real alert reaches the founder's Telegram within one cadence of a new listing; `freshnessSeconds` recorded.
- **1.9 Ops monitor v0.** `track()` and `product_events`; daily rollup of freshness, provider spend, model spend, error rates; per-provider kill switch honoured by the adapter. Done: rollup row appears; flipping the switch stops calls; alert events recorded.

**[CHECK-IN]** Run the skeleton for a week. Record: cost per new listing found, median freshness, arrival rate per cell, share of PC listings with hidden GPUs, extraction correction rate. Decide the primary and fallback Facebook actors and the model thresholds; write them into `docs/decisions.md`.

## Phase 2 — eBay and real sold prices

- **2.1 eBay Browse adapter.** Application token; `item_summary/search` newest-first per product key with GB filters; `getItem` for detail; EPN affiliate header; GTIN cache. Done: eBay listings flow through the same pipeline; `listedAtPrecision` exact.
- **2.2 Ended-listing signal.** Recheck eBay items via `getItem`; write `ended` observations. Done: observations accrue; band uses them at half weight.
- **2.3 Marketplace Insights adapter (flagged).** Behind `EBAY_INSIGHTS_ENABLED`. Done: adapter tests against recorded responses; no-op when disabled.
- **2.4 Price Book v1.** Recency weighting, trend, staleness, sell-through, days-to-sell, nightly and hourly refresh. Done: synthetic series tests; bands for the top 50 keys published.
- **2.5 Free-tier eBay alerts.** Router rule: eBay alerts live for free users; other sources digest. Done: digest job produces one message per day.

**[CHECK-IN]**

## Phase 3 — Scan mode

- **3.1 Camera and barcode in the PWA.** Barcode Detection API with ZXing fallback; photo capture; upload to storage with 30-day expiry. Done: EAN read on 20 test items.
- **3.2 Recognition.** EAN → product; vision model with the recognition contract; confirmation UI below 0.8. Done: ≥ 80% correct on 100 test items.
- **3.3 On-demand fetch.** Parallel adapter calls with per-scan cap; write observations; compute band; cache. Done: first-time scan under 10 s median; repeat scan under 2 s.
- **3.4 Scan card.** Blocks in `docs/scan-mode.md`; similar-item section from `search_by_image` and `listing_embeddings`. Done: card renders from fixtures; verdict agreement ≥ 70%.
- **3.5 Inventory and eBay drafts.** eBay OAuth; encrypted refresh tokens; Inventory API draft; listing pack; outcome capture. Done: draft validates in the eBay Sandbox; outcome writes a `sold` observation.

**[CHECK-IN]**

## Phase 4 — Product surface and billing

- **4.0 Auth service.** Better Auth instance with Drizzle adapter, magic link, Google, admin and captcha plugins; `/api/auth/*` route handler; session helpers for server actions. Done: sign-up by magic link and Google in staging; admin role check test.
- **4.0a Auth follow-ups.** Make the per-email magic-link counter atomic with `insert … on conflict`; add a line to `services/auth/README.md` that the x-forwarded-for rate-limit key assumes a trusted proxy (Vercel). Done: a concurrency test shows no lost increments.
- **4.0b Auth: audit admin actions.** Now that `audit-log` exists, make the refusal of unaudited admin actions call its `record()` in the same transaction. Done when every admin action writes an audit row and a test proves the action rolls back if the audit write fails.
- **4.1 Web app core.** oRPC router and typed client; onboarding with default hunt, hunts CRUD, deal feed, deal card, feedback (`real_deal`, `not_a_deal`, `bought`), all through procedures inside `withUser`. Done: Playwright flow passes; an OpenAPI document is generated from the router.
- **4.1b User dashboard.** Home dashboard per `docs/dashboards.md`: today block, deals-near-you map (MapLibre, OpenFreeMap), hunts performance, watchlist sparklines, inventory profit, scans, usage; `mv_user_dashboard` refresh. Done: dashboard renders from views only; Lighthouse performance above 90 on mobile.
- **4.1d Coverage wording.** Replace "UK and Ireland" with UK-only wording on the landing badge and footer (`docs/decisions.md`, "Beta coverage and Apify budget"). Done: no user-facing text mentions Ireland.
- **4.2 Web push and email.** Serwist service worker; VAPID; Resend digest template. Done: push received on iOS and Android test devices.
- **4.3 Billing.** Per `docs/billing.md`: Better Auth Stripe plugin with the three plans and the 7-day Standard trial, lifecycle hooks → entitlements, billing portal, usage ledger with monthly grants and `chargeUsage`, top-up Checkout and webhook, boosts and exports as usage items, referral credit, automatic tax. Done: tier change alters cadence within one tick; webhook replay test on the top-up handler; entitlement matrix test; trial offered at the cap and refused on a second attempt; a scan at zero balance is refused with the top-up prompt.
- **4.3a Account and channels.** Telegram one-time-code linking, push subscriptions, email preferences, data export, account deletion with 24-hour purge. Done: Playwright covers link, export and delete.
- **4.3b Security hardening.** CSP, rate limits on scan and hunt endpoints, captcha plugin verified on sign-up, RLS policy tests for every user table with and without `withUser`, encrypted token round-trip, upload validation, no database or service credentials in client bundles. Done: `docs/security.md` pre-launch checks all pass in staging.
- **4.4 Crawl planner v1.** Cells activated by hunts; cadence rule with spend; hourly sweep. Done: cadence changes with subscribers and spend in tests.
- **4.5 Review console.** Quarantine queue, corrections, fixture export. Done: a correction updates the band and adds a fixture.
- **4.6 Public freshness page.** Median freshness per source from `metrics_daily`. Done: page renders live numbers.
- **4.7 Compliance surface.** Terms, privacy and cookie pages (human-written text), cookie consent gating PostHog, affiliate disclosure, retention jobs (pg_cron), sub-processor list. Done: consent blocks analytics until accepted; retention jobs verified on staging data.
- **4.5a SEO price pages.** `/prices/[productKey]` rendered nightly from `value_bands` for every product key with a band, with sitemap and structured data. Done: pages indexable, under 1 s server render, sign-up prompt tracked.
- **4.6a Analytics and feedback loop.** PostHog after consent (client and server), person properties, the funnels and surveys in `docs/analytics.md`, session replay with masking on three screens, feature flags read server-side (including the Facebook gate flag), user feedback and corrections written back as Langfuse scores. Done: the sign-up-to-paid funnel renders in PostHog with test users; a `not_a_deal` verdict appears as a score on the originating trace.
- **4.6b Lifecycle messaging.** Per `docs/marketing.md`: consent capture and preference centre, `canMarket`, suppression sync with Resend and PostHog webhooks, the eleven programmes configured in PostHog Workflows with goal events and the daily cap, React Email templates with one-click unsubscribe, transactional templates on `mail.nabvy.com`. Done: abandoned-checkout and cap-reached programmes fire in staging from test events; a suppressed address is skipped; unsubscribe works in one click.
- **4.6c Nabvy Daily.** Per `docs/marketing.md`: `mv_market_daily`, the recap model call with the no-invented-numbers check, per-user rendering, Resend batch send, `/daily/[date]` public page with newsletter sign-up, channel-bot post, skip-when-empty. Done: a full brief renders for a test user with two hunts; a user with nothing new receives nothing; the public page for today is indexable and under 1 s.
- **4.7a Affiliate programme.** Per `docs/affiliates.md`: Dub click cookie read at sign-up, lead tracking, sale and chargeback tracking from the Stripe handlers (idempotent by invoice ID), the £5 referred-user credit, `/partners` page with terms and application link. Done: an end-to-end test in Dub's test mode shows click → lead → sale → commission; a chargeback reverses it.
- **4.8 Admin dashboard, monitoring and runbooks.** Four-tab admin dashboard per `docs/dashboards.md` with audited actions; Sentry alerts; founder Telegram alerts; runbooks linked from admin. Done: a forced provider pause triggers the alert and shows on the operations tab; an audited action writes `audit_log`.

**[CHECK-IN]** Private beta with design partners.

## Phase 5 — Breadth and launch

- **5.1 Gumtree adapter** (Apify Store actor). Done: same acceptance as 1.1.
- **5.2 Facebook fallback adapter** (Store actor) and fail-over. Done: forced primary failure routes to fallback.
- **5.3 Discord and Telegram channel bots** for "deals near [city]" with watermark. Done: a server owner can install and receive a feed.
- **5.4 Second pack** (consoles and controllers) as data only. Done: no pipeline code changes required.
- **5.3a MCP server (read-only).** `services/mcp` exposing deals, hunts, trends and metrics tools with the same authorisation as the calling user, for the founder's analysis agents first. Done: an agent lists yesterday's top deals through the server.
- **5.4a Public API (Business tier).** Versioned OpenAPI endpoints from the oRPC router for deals, hunts and scans; API keys hashed and scoped; rate limits; docs page. Done: a Business test account pulls its deal feed with an API key.
- **5.5 Legal gate checklist** for Facebook alerts to paying users, per `docs/decisions.md`. Done: checklist signed off by a human. *(The gate was lifted by the owner on 2026-09-24: `docs/decisions.md`, "Legal gates lifted".)*

- **5.6 Load check and launch checklist.** Staging load run per `docs/operations.md`; every launch-checklist item ticked with evidence in `docs/questions.md` or the admin area. Done: p95 pipeline delay under 30 s; checklist complete.

**[CHECK-IN]** Paid beta.
