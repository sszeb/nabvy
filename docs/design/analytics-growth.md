# Analytics and growth: PostHog and Langfuse

*Design, 2026-09-24. This design covers how PostHog and Langfuse are installed and how they help Nabvy grow turnover and protect profit. Repo facts are cited by file:line and tool facts by URL. The tool research relied on search results because direct fetches were blocked. Check every tool fact again on the vendor's own page before relying on it.*

## 1. Summary for the owner

**PostHog shows how customers behave and where the money comes from.** It shows where people drop out between signing up and paying. It shows which check intervals, areas and bundles people choose, and which areas have many watchers. It can run controlled tests of offers, such as a bundle size, a trial or cheaper fast checks in busy areas. Every test watches profit margin and cancellations as its safety checks. PostHog Workflows sends the lifecycle messages: low balance, cap reached and come back. The core of this is already planned (`docs/analytics.md:33-42`, `docs/backlog.md:78-79`). This design adds the pricing and profit uses.

**Langfuse keeps the AI part of each check cheap and good.** It traces every model call. It stores prompt versions, so a prompt change is a label change rather than a release. It runs the fixtures as a test set, so a cheaper model tier is adopted only when quality holds. It also links user feedback ("real deal", "not a deal") to the exact call that produced the result (`docs/analytics.md:44-50`). Money figures still come from Nabvy's own `cost-meter`. Langfuse cost is used only as a cross-check.

**On your point about shared cost.** One Apify check of an area serves every want watching it. The repo already records the parts, but nothing adds them up yet:

- `search-planner` counts the wants on each area and term (`docs/design/modules/search-planner.md:10`);
- `check-scheduler` records each run per area (`docs/design/modules/check-scheduler.md:11`);
- `cost-meter` records what each run and model call cost (`docs/design/modules/cost-meter.md:6,9`).

In this design, `ops-metrics` joins these into a daily profit figure per area and check interval, and sends it to the pricing console and PostHog. Whether a want's price floor is set on its **standalone** cost or its **shared** cost is your decision (open point 1). Section 2 has a worked example, because the choice decides whether fast checks can be sold at all.

**Cost to start:** free tiers should cover the early months (section 7). You need to create two accounts in EU regions and add five secrets.

## 2. The profit model as a metrics tree

All amounts are integer GBP micros, as in `cost-meter` (`cost-meter.md:9`). This design sets no prices. Every price is measured cost times a margin, with a floor (`docs/decisions.md:251`, `docs/design/modules/pricing-console.md:7`).

```
Contribution profit (per user | per area | per check interval | per day)
├── Revenue
│   ├── Subscriptions (plan fees)              ← subscriptions, billing_events (Stripe)
│   ├── Usage credits spent                    ← usage-ledger charges
│   │   ├── watching (want × interval × areas)     estimate(want) before save
│   │   └── checking (scans, lookups, boosts, exports; decisions.md:217)
│   ├── Bundles bought (net of discount)       ← usage-ledger grants + billing_events
│   └── Pay-as-you-go top-ups                  ← usage-ledger; product_events topup_completed
└── Cost
    ├── Apify runs, per check per area         ← cost-meter.v_costs ⋈ check-scheduler.v_check_runs
    ├── Model calls per listing / per scan     ← cost-meter.v_costs (priced from the config table)
    ├── Delivery (push, email, Telegram)       ← cost-meter counted rows
    └── Infrastructure (fixed, monthly)        ← ops-metrics, reported separately
```

**Where each number lives**

| Number | System of record | Also shown in |
|---|---|---|
| Cost of each Apify run and model call | `cost-meter.v_costs` (`cost-meter.md:6,9`) | `metrics_daily`, PostHog area group |
| Which area a run checked, and when | `check-scheduler.v_check_runs` (`check-scheduler.md:11`) | none |
| Wants per area and term (`want_count`, `paid_want_count`) | `search-planner.plan_terms` (`search-planner.md:10`) | PostHog area group |
| Model quality per listing and scan; cost as a cross-check | Langfuse traces and scores (`analytics.md:44-48`) | none (alert on divergence) |
| Credits charged, granted and topped up | `usage-ledger` | PostHog (server events) |
| Plan and Stripe events | `subscriptions`, `billing_events` | PostHog (server events) |
| Behaviour (hunt created, alert opened, usage refused) | `product_events` (`analytics.md:5-30`) | PostHog |
| Margin per area and per interval | `ops-metrics.metrics_daily` (new, section 6) | pricing-console, PostHog |

**Per-area profit when one check serves many watchers.** This is a data definition for area `a`, day `d` and interval `i`. It sets no prices.

1. **Area check cost** `C(a,d)` is the sum of `settled_gbp_micros` in `v_costs` over the Apify runs whose `ref_id` is a run in `v_check_runs` for area `a` on day `d`. Add the `cost-meter` model-call rows for the listings those runs found. Those rows join through `ref_id` to the listing, then to the run and the area (task 1.5). One run covers all of an area's due terms (`check-scheduler.md:7`), so the unit of cost is the area, not the term.
2. **Wants served by a run** are the active wants on `a` whose interval that run met. A 5-minute run also serves the 15- and 60-minute wants. The time-weighted `want_count` and `paid_want_count` give the number of watchers.
3. **Shared cost per want:** each run's cost is split equally among the wants it served, then summed per want and across the want's areas.
4. **Standalone cost per want** is the measured cost per run times the number of runs the want's interval needs if it were alone on the area.
5. **Revenue per want** is the want's `usage-ledger` charges, turned into pounds at the effective price per credit the user actually paid, net of bundle discounts. Subscription revenue is split across wants in proportion to the included credits each one used.
6. **Contribution margin** for group (`a`, `i`) is the revenue of its wants minus their shared cost. Per user, it is revenue minus the shared cost of the user's wants and scans.
7. **Sharing ratio** is standalone cost divided by shared cost. It is measured, never assumed. A high ratio is the evidence for a cheaper fast-check offer in that area.

**Worked example: standalone against shared (illustration, not a price).** The one recorded run (a page-1 search plus 20 details) settled at $0.0177 (`cost-meter.md:15`, `docs/design/drafts/actor-integration.md:308`). The table assumes a 30-day month with checks around the clock. GBP figures would use `USD_GBP_RATE`.

| Interval | Runs a month | Lone want (standalone) | Each of 20 wants at that interval (shared) |
|---|---|---|---|
| 1 min | 43,200 | $764.64 | $38.23 |
| 5 min | 8,640 | $152.93 | $7.65 |
| 15 min | 2,880 | $50.98 | $2.55 |
| 60 min | 720 | $12.74 | $0.64 |

`estimate(want)` turns cost into credits, so the credit estimate scales with whichever column is used. On a standalone basis, one 1-minute want costs far more than the Pro plan (£29 a month with £35 of usage included, `decisions.md:218`). A standalone floor would therefore refuse prices you have already approved, or make fast checks impossible to sell. On a shared basis, the same want in a busy area fits comfortably, but it loses money if the area empties. Two points hold on either basis:

- The floor compares **price per credit with measured cost per credit**.
- Which basis `estimate(want)` uses is your decision (open point 1).

How fast Facebook can be checked still follows the actor brief and test T2 (`decisions.md:255`).

## 3. PostHog uses, each tied to a lever

1. **Funnels and activation (launch).** Track sign-up to paid, the scan flow, and cap reached to trial (`analytics.md:33-42`). Add want created → first alert → first top-up, broken down by interval and by number of areas.
   *Lever:* turnover. This finds where paying intent is lost.
2. **Revenue analytics (launch in its own form; the Stripe source later).** At launch, the server sends revenue events to PostHog, tied to `userId`: `topup_completed` with `pricePence`, and subscription changes. PostHog can also sync Stripe directly, with the first 1M rows a month from a payment-platform source free ([start here](https://posthog.com/docs/revenue-analytics/start-here), [Stripe source](https://posthog.com/docs/revenue-analytics/payment-platforms/stripe)). That sync brings in Stripe customer objects (open point 2).
   *Lever:* revenue by plan, bundle and cohort, shown next to behaviour.
3. **Data warehouse (later, only if needed).** PostHog can sync a Postgres or Supabase source. Sources created after 18 February 2026 require SSL ([Postgres](https://posthog.com/docs/cdp/sources/postgres), [Supabase](https://posthog.com/docs/cdp/sources/supabase)). A sync would let PostHog SQL join `cost_meter.v_costs` and usage to events. At launch, the join runs inside Nabvy in `ops-metrics` (section 2), and only the results go to PostHog (open point 3).
   *Lever:* margin per user and per area, with no new path into the database.
4. **Area as a group (launch).** Add a group type `area`, keyed by centre id. `ops-metrics` pushes these properties daily: `watchers`, `paid_watchers`, `runs`, `check_cost_micros`, `contribution_micros` and `sharing_ratio`. The existing plan group stays. PostHog allows at most 5 group types ([group analytics](https://posthog.com/docs/product-analytics/group-analytics)).
   *Lever:* shows which areas are busy and profitable, and lets a test target by area ([targeting](https://posthog.com/docs/feature-flags/user-and-group-targeting)).
5. **Experiments (later).** The repo rule is "one experiment at a time, minimum two weeks or 200 users per arm, decision recorded in `docs/decisions.md`" (`analytics.md:38`). PostHog shows no result before 50 exposures per variant, or before 5 conversions for funnel metrics ([sample size](https://posthog.com/docs/experiments/sample-size-running-time)). Holdouts of 1–10% exist ([holdouts](https://posthog.com/docs/experiments/holdouts)). Running tests in parallel or adding a holdout needs your approval (open point 5).
   - *Candidates, run in sequence:* bundle sizes and discounts; price points per interval, including cheaper fast checks where the sharing ratio is high; trial offers; wording of the "widen your radius" and top-up hints.
   - *Guardrails:* contribution margin per user, cancellations and churn, and the `usage_refused` rate.
   - *Rule:* a flag or experiment returns only a variant id or offer id. `pricing-console` maps the id to an offer and computes the price on the server, and code enforces the floor. No price, discount or margin ever comes from a flag payload, including remote-config payloads ([remote config](https://posthog.com/docs/feature-flags/remote-config)). Flags are evaluated on the server with local evaluation ([feature flags](https://posthog.com/docs/feature-flags)).
   - *Lever:* turnover without selling below cost.
6. **Willingness-to-pay surveys (later).** After a user's first paid month, ask one question about the value of a faster interval or a larger bundle. The two surveys already planned stay at launch. The free tier includes 1,500 responses a month ([pricing guide](https://flexprice.io/blog/posthog-pricing-guide)).
   *Lever:* shows where experiments should start.
7. **Lifecycle Workflows (launch, 4.6b).** Cap reached → trial or top-up, low balance, abandoned checkout and win-back (`backlog.md:79`). The free tier includes 10,000 messages a month ([Workflows GA](https://posthog.com/blog/workflows-ga)). Marketing consent and suppressions still apply.
   *Lever:* more turnover from existing users.
8. **Session replay with masking (launch).** Replay runs only on the deal card, the scan screen and the pricing page. All inputs are masked, and listing text is masked by CSS class (`analytics.md:36`). Masking runs in the browser, so masked content never reaches PostHog ([privacy](https://posthog.com/docs/session-replay/privacy)). The free tier includes 5,000 recordings a month.
   *Lever:* removes friction on the pages that earn money.

PostHog's LLM analytics ([docs](https://posthog.com/docs/llm-analytics)) is not used, because Langfuse does that job.

## 4. Langfuse uses, each tied to cost or quality

1. **Trace every model call (launch, 1.5).** Tracing uses OpenTelemetry through `@langfuse/otel` (`LangfuseSpanProcessor`) ([npm](https://www.npmjs.com/package/@langfuse/otel)). AI SDK calls go through `@langfuse/vercel-ai-sdk`, which needs Node 22 or later ([AI SDK 7](https://langfuse.com/changelog/2026-06-26-vercel-ai-sdk-7)). Each trace carries `listingId`, `scanId`, `packId`, `model`, `tier` and tokens (`analytics.md:44`), plus `areaId` and `runId`.
   - Langfuse computes its own token cost ([cost tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking)). That figure is a **cross-check only**. An ops alert fires when Langfuse and `cost-meter` disagree by more than a configured percentage. The ledger of record stays `cost-meter`.
   - Volume control: every model call is traced. Stage spans with no model call are sampled at a rate from `@nabvy/config`. Scans and evaluation runs are always traced at 100%.
   - *Lever:* cost per listing and per scan, with an over-budget alert (`analytics.md:50`).
2. **Prompt versions (launch, 1.5).** Versions are immutable. The labels `production` and `staging` point to versions, and a protected `production` label can be moved only by admins ([version control](https://langfuse.com/docs/prompt-management/features/prompt-version-control)).
   *Lever:* a fix ships as a label change, and a rollback is instant.
3. **Datasets from `fixtures/` and evaluations in CI (launch, 1.5a).** The fixtures become a dataset, and deterministic scorers run on every prompt or model change, linked to the pull request (`backlog.md:33`).
   - Addition: a **tier comparison** runs the same dataset on the current tier and on a cheaper one. The cheaper tier is adopted only if every scorer's pass rate is at or above the previous run.
   - CI can fail on a score regression ([automated evaluations](https://langfuse.com/blog/2025-09-05-automated-evaluations)).
   - Code scorers come first, and an LLM judge is used only if needed ([code evaluators](https://langfuse.com/docs/evaluation/evaluation-methods/code-evaluators)).
   - *Lever:* the largest direct cut in model spend.
4. **Scores from real use (launch, 4.6a).** `real_deal` and `not_a_deal` verdicts, Review Console corrections and scan-card survey answers become scores on the originating trace (`analytics.md:48`, [scores](https://langfuse.com/docs/evaluation/scores/overview)).
   *Lever:* quality per prompt version on real listings, and fixtures that grow from corrections.
5. **The week-one model-tier decision (launch plus one week).** Escalation thresholds are set from the correction rate in Langfuse and the cost in `cost-meter`, by tier and asking price (`analytics.md:49`, `decisions.md:258`).
   *Lever:* stops paying top-tier cost where the default tier is right.

## 5. Privacy and rules

- **Consent first.** PostHog loads in the browser only after consent (`analytics.md:33`). No cookieless capture happens before consent. The server sends events only for users with stored consent. The first-party `product_events` table records either way, because it is Nabvy's own record.
- **Identity.** Users are identified by `userId`, never by email. Plan and pack are person properties.
- **Never sent to PostHog:** listing text, seller data, photos, emails, postcodes (area id only) or free text (`analytics.md:40`). A Zod allow-list of property names in `packages/contracts` enforces this.
- **Langfuse traces carry ids, tier, tokens and cost, and no user personal data.** An SDK mask function runs before export ([masking](https://langfuse.com/docs/observability/features/masking)).
- **Hosting and retention.** PostHog is hosted in Frankfurt ([FAQ](https://posthog.com/faq)) and Langfuse in Ireland ([EU residency](https://langfuse.com/resources/engineering/langfuse-eu-data-residency-gdpr)). Retention is 30 days for PostHog and 90 days for Langfuse (`analytics.md:58`). Both are listed sub-processors.

**Tensions with the repo's rules**

- **Actor data kept in full, against traces sent to a third party.** The rule to keep actor data unredacted covers Nabvy's own storage. Sending listing text or seller fields to Langfuse is a different act. The conservative option applies: the mask strips seller fields and contact patterns, and the full listing is opened through the trace id in the Review Console (open point 4).
- **Money from a third party.** Langfuse prices calls from its own table. Feeding that into the floor would count model cost twice and break "No invented numbers". The floor would also drop silently whenever Langfuse is off. For these reasons `cost-meter` stays the only source of model cost.
- **`@nabvy/config` fails fast.** The `posthog` and `langfuse` groups mark their keys `required()` (`packages/config/src/env.ts:82-86,115-118`). The 0.10 wrappers safe-parse their group and fall back to a no-op client in dev, test and preview. In production, a missing key raises one ops alert.
- **Browser key.** `@nabvy/config` is read on the server. A server component passes the PostHog project key into the client provider, so no `NEXT_PUBLIC_` variable is added. The key is a public ingestion key. A `/ingest` rewrite in Next.js proxies to `eu.i.posthog.com`, so ad blockers do not drop events. The browser still has no database access.
- **Price experiments.** 0.10 adds one line to `docs/legal-review.md` about offers and prices that differ by user or area, with no analysis.
- **Self-hosted PostHog licence.** The `ee/` directory is source-available ([ee/LICENSE](https://github.com/PostHog/posthog/blob/master/ee/LICENSE)). PostHog Cloud avoids the issue. If PostHog is ever self-hosted, use `posthog-foss`.

## 6. Install plan as backlog tasks

**0.10 Analytics and observability clients.** Pulled forward from 4.6a and 1.5; comes after 0.9. **Sonnet.**
- New package `@nabvy/telemetry`:
  - server capture with `posthog-node`, which checks consent before each event and evaluates flags locally;
  - a client provider that loads `posthog-js` after consent, takes the key from a server component, masks by default and sends through `/ingest`;
  - `registerTracing()`, which sets up OpenTelemetry with `LangfuseSpanProcessor`, the mask function and the sampling rate;
  - `traceStage({ listingId | scanId, packId, tier, areaId, runId })`.
- Config comes only from the `posthog` and `langfuse` groups of `@nabvy/config`, with a new `LANGFUSE_SAMPLE_RATE`. The wrappers do nothing when keys are absent.
- The property allow-list is a Zod schema in `packages/contracts`, derived from the `product_events` contracts.
- Dependencies, each with a one-line reason and a licence check in the PR:
  - `posthog-js` and `posthog-node` are MIT ([js](https://github.com/PostHog/posthog-js/blob/main/LICENSE), [node](https://github.com/PostHog/posthog-node/blob/master/LICENSE));
  - `@langfuse/otel`, `@langfuse/tracing`, `@langfuse/client` and `@opentelemetry/sdk-node` are checked at install.
- Records open points 1 and 5 in `docs/questions.md`, with the worked example from section 2, and adds the legal-review line.
- **Done:**
  - a fixture test rejects events with email, postcode or free-text properties;
  - with no keys, nothing is captured and no network call is made;
  - without consent, nothing is captured;
  - a stubbed exporter receives a span with the required attributes and masked fields, and sampling drops only non-model spans;
  - lint and typecheck are clean;
  - the package README records the decisions, and `docs/progress.md` has a row.

**1.5 (change).** Use `traceStage` and add `areaId` and `runId`. Make sure each `cost-meter` model-call row's `ref_id` joins to its listing or scan, and from there to the check run and area. Add a daily Langfuse-against-`cost-meter` divergence check that raises an ops alert. **Top model** (pipeline core).
**Done (added):** a fixture listing's trace shows its area id; its `cost-meter` row joins to the run and area; a planted 20% divergence raises the alert.

**1.5a (change).** Add the tier comparison, which reports pass rate per scorer and cost per listing for each tier and refuses the cheaper tier if any scorer falls. **Top model** (adversarial verification).
**Done (added):** a deliberately weaker tier is refused; a cheaper tier of equal quality is recommended with its saving.

**4.6a (change).** **Sonnet.** Add:
- the `area` group;
- revenue events from the server;
- a profit dashboard showing margin by area and interval, sharing ratio and churn;
- an experiment registry, where each entry names its guardrails and returns only offer ids.

**Done (added):** a test top-up shows in PostHog revenue; an area group shows `watchers` and `contribution_micros`; a variant resolves through `pricing-console` to a price at or above the floor, and a variant pointing below the floor is refused.

**`ops-metrics` card (change).** **Top model** (money).
- Adds a daily metric per area × interval: check cost, model cost, watchers, paid watchers, shared cost, standalone cost, revenue, contribution margin and sharing ratio, all from `v_costs`, `v_check_runs`, `plan_terms`, `usage-ledger` and `subscriptions` views as in section 2.
- Adds Langfuse units per day.
- Pushes the area group properties to PostHog daily.

**Done:** a fixture with two wants on one area, at 5 and 60 minutes, gives hand-computed shared cost, standalone cost and sharing ratio; running it twice gives the same result.

**`pricing-console` card (change).** **Top model** (money).
- `offerForVariant(variantId, userId)` returns an offer id and a price, or refuses.
- The floor is price per credit ≥ measured cost per credit + minimum margin. The cost basis used by `estimate(want)` follows the owner's answer to open point 1.
- **Before the floor is switched on**, the launch list prices and tier inclusions are run against it (`decisions.md:218`). Any refusal goes to the owner through `docs/questions.md` and an admin notice. The floor never silently blocks a sale.
- A read-only panel shows shared cost, standalone cost and sharing ratio per area and interval.

**Done:** a property test finds no variant, offer or discount priced below the floor; the pre-switch report lists launch prices against both bases; the panel renders from fixture metrics.

**Order:** 0.10 after 0.9. The 1.5 and 1.5a changes ride with those tasks. The `ops-metrics` and `pricing-console` changes follow the merges of `cost-meter`, `check-scheduler`, `search-planner` and `usage-ledger`. The 4.6a changes stay in Phase 4.

## 7. What the owner must do

1. **Create a PostHog project on EU Cloud**, with ingestion host `eu.i.posthog.com` (`docs/secrets.md:43`). Set a billing limit for each product ([pricing](https://posthog.com/pricing)).
2. **Create a Langfuse project in the EU region.** Protect the `production` prompt label.
3. **Add the secrets as environment secrets** where `docs/secrets.md` names them. Never paste them in chat or commit them.
   - `POSTHOG_KEY`, `POSTHOG_HOST` (`secrets.md:43`)
   - `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` (`secrets.md:23`)

   Until they exist, 0.10 runs and sends nothing.

**Free tiers as researched (check again before relying on them)**

**PostHog** ([pricing](https://posthog.com/pricing), [guide](https://flexprice.io/blog/posthog-pricing-guide)):
- Each month: 1M events, 5,000 recordings, 1,500 survey responses and 10,000 workflow messages ([Workflows GA](https://posthog.com/blog/workflows-ga)), plus 1M rows from a payment-platform source such as Stripe.
- Error tracking and AI observability are included.
- Flags cost from $0.0001 per request.
- There is no charge per seat. PostHog says about 97% of accounts stay free.

**Langfuse** (third-party trackers only, unverified: [DEV teardown](https://dev.to/beton/langfuse-pricing-teardown-2026-2pi9), [comparison](https://www.morphllm.com/comparisons/langfuse-vs-langsmith)):
- Hobby is $0 for 50,000 units, Core $29 a month and Pro $199 a month. A unit is a trace, an observation or a score.
- Batches of 100–500 listings will use units quickly. Sampling (0.10) and the units-per-day metric (`ops-metrics`) make the tier choice rest on measured volume.
- Check prices at [langfuse.com/pricing](https://langfuse.com/pricing).
- The core is MIT and free to self-host ([EU residency](https://langfuse.com/resources/engineering/langfuse-eu-data-residency-gdpr)).
- ClickHouse acquired Langfuse in January 2026 (third-party source).

## 8. Open points (each with a conservative default)

1. **Floor basis for watching: standalone or shared cost?** See the worked example in section 2. Default: `estimate(want)` uses standalone cost, which is profitable even if an area empties. Before the floor is switched on, launch prices are checked against it and every refusal goes to you, so no approved price is silently blocked. Revisit after four weeks of `ops-metrics` data. A shared-cost discount would then become a `pricing-console` offer that is still checked against the floor.
2. **Connect Stripe directly to PostHog?** Default: no. Revenue goes to PostHog as server events tied to `userId`, so no Stripe customer emails reach PostHog.
3. **Connect the database to PostHog's warehouse?** Default: no at launch; margin is computed in `ops-metrics`. If it is ever wanted: a read-only role limited to aggregate views, with SSL, after a `docs/security.md` review.
4. **Listing text in Langfuse traces?** Default: masked. Seller fields and contact patterns are removed, production traces carry ids and structured facts, and the full listing stays in Nabvy, opened through the trace id.
5. **Price experiments, parallel tests and holdouts.** Default: one experiment at a time, per `analytics.md:38`. Each one must be approved by you in `pricing-console`, and every variant resolves on the server to a price at or above the floor, with margin and churn as guardrails. Each decision is recorded in `docs/decisions.md`. Parallel experiments or a 1–10% holdout only if you say so.
