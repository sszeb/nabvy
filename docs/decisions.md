# Decisions and constraints

These are the standing rules currently in force. Change them only with a human decision recorded here. Full reasoning, quotes, superseded readings and the chronological record are in `docs/decisions-history.md`.

## Precedence: the Facebook actor brief

Where the build pack conflicts with the Facebook actor brief (`sebtimize/fb-scrap-engine`; reading list and rules in `docs/fb-actor-sources.md`), the brief wins, except where a later owner decision below overrides it. Only the files `docs/fb-actor-sources.md` lists are read. Anything pointing at a product decision goes to `docs/questions.md` rather than being decided here.

| Topic | Current rule |
| --- | --- |
| Seller data | Keep everything (see "Actor data kept in full"); only end users never see seller identity |
| Seller-derived flags | Stay internal; never on a public table or `v_` view |
| Labels and scores | "Suspected ...:" plus evidence, documented calibrated rules, a correction route, never an unexplained score; scam labels: shadow mode, legal review before launch |
| Price-drop watch | Build first: history within one listing ID only; relists merged silently |
| Price wording | Never "worth"/"fair"; asking-price position, n≥10 only (conservative, `docs/questions.md`) |
| Sale signals | A vanished listing ≠ a sale; opt-in user-reported sold prices only |
| Part-out maths | Later, once standalone part prices exist |
| Cadence and tiers | Nothing faster than hourly guaranteed, no "instant" tier, pending the open question; newest-first checks plus a daily sweep |
| Region/currency | Beta: UK and GBP only; Ireland skipped |
| Location precision | No finer than town/area/distance; never raw coordinates |
| Per-user work | Never per-user Facebook fetches/AI except scan-mode recognition; pasted links join the shared queue |
| Search planning | Per verified centre × term, never per user; newest-first plus daily sweep only; app sends batches, actor never filters |
| Photos | Reviewed only when text is silent; deleted after review; never served from our storage |
| Resale of listing data | Allowed — legal-advice gate lifted |
| Legal gates | Lifted; points stay listed, unactioned, in `docs/legal-review.md` |
| Apify token | Edge Function secret `APIFY_TOKEN` on `fbapfy`, read only by `apify-gateway`; actor `YfdUav3sZ2BgEf8rh` only |
| Noise/wanted adverts | Free filter hides wanted/swap/stuffing/laptops/mention-only, with a count and "show hidden" |
| Detail selection | Every new ID gets details regardless of price/title; batches up to ~200 |
| Content hash | Evidence hash from an allowlist (title, description, attributes, detail sections, condition, category); price/availability/location excluded |
| Copies and relists | Each copy-advert cluster/relist counts once in price bands, one alert; relist alerts dropped silently |
| Matching wants | Spec search matches parts inside listings, including description text; silence is never "no" |
| New listings/coverage | The app detects new IDs itself; a degraded search reruns, never reads as "nothing new"; photo-only positives go to the digest |

## Actor data kept in full

Keep all data the actor returns: nothing removed, redacted or stripped at ingest, including seller names, IDs, pictures and full text. Needed for scam detection and internal analysis; developers see all of it always. The one rule: **end users of the app are never shown seller identity**, enforced by an explicit field allowlist on every `v_` view plus a CI test on user output. Replaces every minimisation/stripping rule elsewhere, `CLAUDE.md` included. Retention period not yet set.

Storage: each actor row stored whole as `jsonb`, plus real columns for fields Nabvy filters/sorts on. New backlog items from the brief, Nabvy's own to design (full list: `docs/backlog.md`): the parts record, spec search/alerts, the noise filter, copy-advert spam flag, suspected-behaviour labels, asking-price position, price-drop watch, demand signals, seller objection/erasure, and CI tests against seller fields or under-threshold aggregates in user output.

## The actor is a tool; Nabvy owns the rest

The Facebook actor only runs searches and fetches listing details. Everything else — copy-advert detection, the parts record, noise filtering, suspected-behaviour labels, asking-price position, price-drop watch, scam signals, alerts — is Nabvy's own design and build.

## Atomic modules

Each app function is a stand-alone atomic module:
- **One job.** `services/<module>/` per `CLAUDE.md`'s shape, own `README.md`, fixtures, tests.
- **Own data.** Owns its tables; others read only via its `v_` views or exported functions.
- **Contracts only.** Types in `packages/contracts` under its own name; talks to other modules only through contracts and thin events, never HTTP.
- **Stands alone.** Buildable, testable, switchable off and replaceable; dependents degrade gracefully when it's off.
- **Pipeline rules.** Batched, idempotent (key `source + sourceListingId + contentHash`), T-timestamps stamped.

Build process: one foundation session builds shared machinery first (contract/schema namespaces, event registry, scaffold script, one-folder-per-session rule); then parallel waves, one session and PR per module on `task/<id>-<module>`, fixture-tested, migrations dry-run locally and applied by the coordinator soon after merge (`docs/security.md` first); one coordinator writes briefs, checks contract consistency, owns `docs/progress.md`; one reviewer reviews, approves (a review comment — GitHub blocks self-approval) and merges every PR, never pushes to the branch, defers anything needing an owner decision. Replaces `CLAUDE.md`'s "one task at a time" for module work.

## MVP scope and pipeline runtime

- **Scope.** Public beta, full functionality, Facebook Marketplace only (Nabvy's actor). eBay/CeX/Gumtree later; price = asking-price position only, no eBay/CeX prices.
- **Frontend.** Apify-console/eBay/ChatGPT-spirit design: left sidebar, price-forward cards, calm layout, prominent search, light/dark themes; Next.js/Tailwind/shadcn-ui.
- **Billing is live at public beta launch**, overriding "no charging before legal advice". Plans/prices: "Pricing, cadence and the paid ladder" below.
- **Listing photos** stay off in the web app until legal advice clears it (owner's own product call, not a lifted gate). Cards show a placeholder and an "Open on Facebook" link; a default-off flag can enable photos later.
- **Scan mode runs vision AI per scan**, capped by `SCAN_SPEND_CAP_MINOR` (the one exception to "never AI per user"). Facebook fetches still never run per user.
- **No refunds, ever** — subscriptions, trials, top-ups, boosts, exports. Cancel any time, effective at period end; downgrades at period end, upgrades immediate and pro-rated; "Payments are non-refundable" disclosed pre-purchase; Checkout requires "Start my plan now"; no refund button; chargebacks reverse affiliate commission; a failed metered action reverses usage credits only.
- **Fair use, suspension and bans.** Discretionary suspend/ban for a terms/AUP/fair-use breach, fraud/chargeback abuse, or risk to others; no refund, no reopening after a ban. Enforcement is automatic and internal-only — no reason, evidence, rule, signal or score shown to any user; the user sees only a short notice naming the policy plus a 30-day review route (reply: stands/changed/lifted); developers/admins see everything. Built via an account-status check on every request/job, audited `account-integrity` enforcement, admin override tools, throttling short of suspension, ban-evasion checks, and a CI test against enforcement detail in user output.
- **Beta coverage and Apify budget.** Nothing runs unless an active hunt needs it — per verified centre/term, shared, never per user; areas nobody hunts cost nothing. Exception: the team's own "rtx3090" test hunt in Chichester. Centres from `city-pages.seed.json`, confirmed on first use. Apify spend cap **$150/month**, shared by the spend governor favouring paying subscribers.
- **Search, map and pickup features:** eBay-style filters/sorting; an Airbnb-style map, markers at town/area centroid only, never a listing's real/jittered coordinates (CI-enforced); a distance limit plus "worth the trip" hints. **Pickup-location:** rules first, then at-most-once shared AI, resolves the true location from the field plus text; only town/area level reaches a `v_` view or user output (CI-enforced). **"Too good to be true":** from listing signals (price far below n≥10 comparables, conflicting location, postage-only wording on a collection listing, risky payment asks, copy-advert copies) and one-tap user reports; worded "Suspected too good to be true:" plus facts, no score, attaches to the listing not the seller; shadow mode on the rtx3090 hunt, then live. **Every listing is reused** in one shared pool feeding every product's price picture and every hunt; a listing far below comparables is a gem candidate, checked before surfacing; no extra spend for by-catch. **Pickup routes:** private, row-level-secured, never in a `v_` view.
- **Legal gates lifted.** Collection no longer waits for an LIA/DPIA; resale/sharing no longer waits for legal advice (Business export/feeds/API back in plan); alerts go to every user. Still bounded by the Apify spend cap. Points stay listed, unactioned, in `docs/legal-review.md`.
- **Policies and conduct match big tech** — terms, refunds, cancellation, trials, fair use/AUP, suspension/bans/notices/appeals, privacy/cookies take the position leading consumer tech shares (Netflix/Spotify/Disney+/YouTube; Google/Apple/Microsoft/Meta; OpenAI/Anthropic/Canva/Midjourney/Adobe; Apify/Supabase), in Nabvy's own words.
- **Legal review only on request.** Lawyer-relevant points (including the two above) are listed, unanalysed, in `docs/legal-review.md`; no legal research, review or check runs unless the owner asks.
- **Pipeline runtime.** Trigger.dev runs the pipeline; Apify is still called only through the `apify-gateway` Edge Function.

## Product

- **Audience and categories.** Anyone in the UK buying second-hand to resell or get a good deal. First pack: GPUs and gaming PCs. Later, in order: consoles/controllers, phones, laptops/PC parts, collectables, cars. DVDs permanently out.
- **Two entry points:** alerts on new listings; scan mode for an item in hand.
- **Version-1 features:** checked deal alerts (part-out maths deferred); freshness-stamped speed; risk screening on every alert; hunts by postcode/radius; one-tap actions.
- **Not in version 1:** listing anywhere but eBay; CRM; AI negotiation; auto-messaging sellers; native apps; DVDs (price-drop tracking is build-first, not excluded).
- **Brand:** Nabvy — nabvy.com canonical, nabvy.co.uk redirect, nabvy.app PWA; dibvy.* redirects to Nabvy. DNS Cloudflare; hello@nabvy.com on Google Workspace.

## Data access

APIs first, Apify for the rest, no scrapers of our own. eBay via official APIs; CeX via its web API, cached and capped, licensing in progress. For this push, Facebook only, actor `YfdUav3sZ2BgEf8rh` (no fallback). Go-live gate: lifted, per-provider kill switch still exists. eBay Partner Network: alert clicks carry the EPN campaign ID, disclosed in-app.

## Platform

- **Database:** Supabase `fbapfy` (eu-west-1, Postgres 17): managed Postgres + Storage + Queues + pg_cron for every data shape. No graph database unless fraud-ring/similar-item queries exceed three hops or 500 ms p95. Dashboards read views/materialised views only.
- **Pipeline runtime:** Trigger.dev, Supabase Queues + Edge Functions as fallback.
- **Auth:** Better Auth (MIT) + Drizzle adapter on the same Postgres DB — magic-link, Google sign-in, admin plugin, Turnstile, Stripe plugin. Supabase Auth/PostgREST/supabase-js never used for application data; the browser never talks to the database directly.
- **Module boundaries:** module-to-module in-process (exported functions + thin events, no HTTP); browser-to-server one oRPC (MIT) layer (`withUser`); outside-world is HTTP (webhooks in, a versioned REST+OpenAPI API for Business/bots/AI). Microservices ruled out until a module needs independent scaling.
- **Language:** TypeScript end to end; Python only if valuation needs a library TypeScript lacks.
- **Models:** Vercel AI SDK + Zod structured outputs; Haiku 4.5 default, Sonnet 5 above a value/below-confidence threshold, a vision model for scan-mode photos.
- **Snapshots:** raw actor data kept in full, retention not yet set — supersedes the general 30-day rule for actor data.

## Pricing, cadence and the paid ladder

Watching (live alerts) is a paid-tier entitlement bounded by plan and credits; checking (scans, lookups, similar-item search, boosts, exports) is metered usage in pounds with a monthly allowance then top-ups. Every feature is on every tier; tiers differ only in areas, cadence/floor and usage allowance. Every price/cap value is a versioned, admin-editable `pricing-console` row, never a constant in code; the floor rule refuses any price below cost plus margin. Full catalogue: `docs/billing.md`.

### Paid ladder

| Tier | Monthly | Base cadence | Floor | Bundled credits |
| --- | --- | --- | --- | --- |
| Free | £0 | Bursts (below) | none | none |
| Starter | £12 | 2 h | 1 h | 1,200 |
| Pro | £29 | 30 min | 5 min | 6,000 |
| Max | £99 | 15 min | 1 min | 24,000 |
| Business | from £299 | 15 min | 1 min, 24/7 | 80,000 |

A want's cadence is capped by its plan's base or bought floor; delivered speed still follows the 60%-of-revenue rule per area, so plans market "up to" their cadence. Annual = ten months' price; extra area £4/month; top-ups £5/£10/£25 (included usage expires monthly). Usage prices (pence): cached scan 2, live scan/lookup 15, similar-item search 10, 24h boost 149, 7-day boost 499, export 50, shown pre-action, VAT included. Design partners: lifetime Pro. Referral: £5 credit both sides, no refunds.

### Starting prices

Confirmed as the starting prices, not placeholders. Stripe Products and Prices were created in test mode from these values; annual prices, top-up rates and unit prices stay the coordinator's to set within the 60% rule.

### Watching is metered, prices are dynamic

Radius and speed are user-controlled and metered, estimated credit cost shown before saving; Nabvy only hints (e.g. "widen to see N more deals"), never changes a value itself. A deal-density heat layer (town centroids only) can feed radius hints. Dynamic pricing is set from `pricing-console`. **Trial:** 7-day Standard trial with £3 bonus usage on hitting the Free cap, one per account, converts unless cancelled.

Marketing and the affiliate/creator programme run from day one; detail in `docs/marketing.md` and `docs/affiliates.md`.

**Cadence control UI:** one slider per want, modelled on Claude Code's "Effort" control (1-minute checks at the top, 4 hours at the bottom); app look stays close to Claude/ChatGPT. Design: `docs/design/cadence-slider.md` (wording provisional until owner approval).

## Free tier, spend caps and abuse controls

### Free tier: bursts under a lifetime cap

One want at a time, changeable only at a window reset. Up to three 8-hour bursts (fast then slowing), 72 h apart; then daily digest + "Missed deals" only. Hard lifetime cap **£2 of attributed cost per account**; a burst stops mid-window at the cap. A free-burst pool (≥£20/day or 5% of prior month's net revenue) bounds total cost; sign-up limits per IP/device/email domain; a never-charged card check before windows two/three; a per-area anomaly stop; a kill switch. Every number is a versioned, admin-editable, audited row.

### Free-tier limits, paid users and the daily cap

Only the free tier is limited — paid sign-ups and free→paid upgrades are never queued, throttled or held. **£2/day per free account** across all paid actions; paid accounts have no such cap (only credits, monthly limit, global caps below); a draining daily pool slows remaining free accounts rather than stopping abruptly.

### Hard daily, weekly and monthly spend caps

Global spend caps stop paid calls automatically at daily/weekly/monthly ceilings, checked synchronously before every paid submit against reserved-plus-settled cost, reservations and capped concurrency keeping overrun under 10%. Admin-editable `spend-governor` rows, atop the gateway's own cap and Apify's platform limit.

### Sign-up throttle and surge stop

Admission-rate policy rows plus per-IP/device/email-domain limits; over-rate sign-ups queue in order, never refused outright; thresholds start low, raised only from measured traffic. Edge-first: Turnstile, Cloudflare rate-limiting, Bot Fight Mode. Circuit breakers (sign-ups/minute, paid submits/minute, young-account submits, cost/minute) trip `hold-new` for free bursts/new accounts, pause admission, alert the founder, reset only by an audited admin action. Sign-up farming and resource extraction each get detection signals and a response ladder; an adversarially checked threat model with a test plan is required before the free tier opens.

The admin panel is hardened and adversarially audited before exposure; the admin gate blocks the web deploy until that audit passes.

## Quote masks shown to users

`quote-redaction` shows: `[phone redacted]`, `[email redacted]`, `[handle redacted]`, `[link redacted]`, and a postcode cut to its outward half plus `[redacted]` (e.g. `PO19 [redacted]`).

## Card location line and the map view

One location line per card and listing page: town/county as the source gives it, distance in whole miles, rough travel time, then "data approximate" — e.g. `Coleford, Gloucestershire · 32 miles · 1h 25min away · data approximate`. Measured from the town/area centroid, never a listing's own point. Origin: shared device location (never stored) or saved account location, with an override chip. No map on/under a card; a list/split-map toggle (list default) shows markers at town centroids, clustered where dense.

## Trip cost dropped

Users see the map, distance in miles and a rough travel time only — no trip-cost calculator anywhere in `deal-hints` or `pickup-routes`.

## Routing: openrouteservice first

`router-gateway`/`travel-time` use openrouteservice's (HeiGIT) free hosted API behind a `RouterProvider` adapter, moving to a paid provider or self-hosting only once there's revenue turnover. Gateway-enforced quotas; over-cap falls back to straight-line × 1.3, labelled an estimate. Only origin cells (~1 km) and place centroids reach the provider for cached times; a user's own uncached route request is the only case sending a pickup point, logged with no coordinate. Key: `ROUTER_API_KEY`, server-side only.

## Build order and milestones

### Local single-user run first

Milestone **L** (running locally, for the owner alone, against production Supabase and the Apify gateway, Trigger.dev's dev runner locally) precedes milestone **P** (public: Vercel, Resend, Turnstile, Google sign-in, live Stripe, Dub, marketing). Nothing is bypassed locally — same switches, RLS, spend caps, admin gate; owner is admin via `ADMIN_EMAILS`; local sign-in is the terminal-printed magic link. Runbook: `docs/local-run.md`.

Stripe (billing/invoicing/tax/Connect/payments): `docs/design/stripe-integration.md`; Connect has no consumer yet.

## Session and model economy

### Model by job, revised

Opus 5.5 coordinating; Sonnet 5 medium tasks (docs, CRUD, UI, design readers/critics); Haiku 4.5 code build/fix, code reviews and the relay/watchdog Routines. Effort `medium` everywhere, an app setting, stated in every brief. Full rules: `docs/rules.md` "Working economy", which this decision underlies.

### Stateless coordinator

The coordinator is one Routine (`trig_01SpUT9nZPtAH1FBGiQaCiwu`), fresh session per fire, never handing off; state in `state.md` on orphan branch `claude/coordinator-state`; run rules in `docs/routines/coordinator.md`; never subscribes to PRs. The reviewer is likewise fresh-session-per-fire (a relay/watchdog Routine pair); reviews, approves, merges every PR, never touches Supabase; a merged migration-carrying PR wakes the coordinator via a one-shot trigger (`docs/security.md` first). Docs changes batch into one rolling PR.

### Context economy

Absorbed into the above and `docs/rules.md` "Working economy": the 150k-token hand-off line, reading slices not whole files, batching, events not polling.

## Success metrics

| Metric | Target |
| --- | --- |
| Verified profitable flips per month (north star) | Grows month on month from the first paid week |
| Alert precision (guardrail) | ≥50% in beta, rising to 70% |
| Median freshness per source (guardrail) | Within 2 minutes of the source's measured floor, fast tier |
| Cost per delivered alert (guardrail) | Under £0.05 |
| Week-4 retention of paying users (guardrail) | ≥40% |

## Open questions a human must answer

- Model escalation thresholds, after the first week of measured extraction quality and cost.
- eBay Marketplace Insights, Partner Network and Sell API approvals.
- CeX or CeXDB licensing outcome.
- UK legal review outcome for provider-collected Facebook and Gumtree data.
