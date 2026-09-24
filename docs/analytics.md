# Analytics and the learning loop

Three layers, each answering a different question. All three are open source (PostHog and Langfuse are MIT-licensed cores with EU-hosted clouds and a self-host route).

| Layer | Question | Tool | Consent |
| --- | --- | --- | --- |
| First-party product events | What happened in the product, for the north star and dashboards | `product_events` table in Postgres | None needed: service data, minimised, no third party |
| Behavioural analytics | Why users do what they do, funnels, replays, experiments, surveys | PostHog (EU cloud) | Loads only after consent; identified by `userId`, never email |
| Model observability | What the models did, at what cost and quality | Langfuse (EU cloud) | No user personal data in traces |

## 1. First-party product events

Every meaningful action writes a `product_events` row (`userId`, `event`, `properties` JSON, `at`, `sessionId?`) through a single `track()` function in `services/ops-monitor`, called from procedures and tasks. This table is the source for the north star, the guardrail metrics and both dashboards, so the business never depends on a third-party script being allowed.

Event names are `object_action`, lower snake case. Properties never include listing text, seller data or free-text input.

| Event | Properties |
| --- | --- |
| `signup_completed` | method, referral or affiliate present |
| `onboarding_completed` | pack, radius, channel |
| `hunt_created`, `hunt_paused` | pack, radius, minDealScore |
| `alert_delivered`, `alert_opened` | source, channel, dealScore, freshnessSeconds, valuationState |
| `alert_feedback` | verdict, dealScore, riskScore |
| `scan_started`, `scan_identified`, `scan_valued`, `scan_action` | method (barcode or photo), confidence, confirmed, onDemand, valuationState, latencyMs, action |
| `bought_recorded`, `sold_recorded` | productKey, costMinor, soldPriceMinor, daysToSell, linkedAlert or linkedScan |
| `usage_charged`, `usage_refused`, `topup_completed` | action, pricePence, balanceAfter |
| `trial_offered`, `trial_started`, `subscription_active`, `subscription_cancelled` | plan, trigger (cap or pricing page) |
| `channel_linked` | channel |
| `brief_sent`, `brief_opened`, `brief_deal_clicked` | channel, sections present, dealScore |
| `api_call` | endpoint, keyId |

## 2. PostHog

- **Setup:** `posthog-js` in the app after consent, `posthog-node` on the server for signed-in users who consented; EU cloud (`eu.i.posthog.com`); the same event names as above are forwarded so PostHog has the full funnel; person profiles keyed by `userId`, with plan and pack as person properties; groups by plan.
- **Funnels watched weekly:** sign-up → onboarding → first alert delivered → first alert opened within 24 hours → first feedback → trial → paid; scan started → identified → valued → action taken; cap reached → trial offered → trial started.
- **Session replay** on the deal card, scan screen and pricing page only, with all inputs masked and listing text masked by CSS class; 30-day retention.
- **Feature flags:** every new surface ships behind a flag; the Facebook legal gate is a flag with an allow-list of design partners; flags are read server-side in procedures so entitlements stay authoritative.
- **Experiments:** trial offer wording at the cap, deal card block order, pricing page layout; one experiment at a time, minimum two weeks or 200 users per arm, decision recorded in `docs/decisions.md`.
- **Surveys:** a two-question survey after the tenth alert (was it useful, what is missing); a cancel reason survey on cancellation; a scan card survey ("was this valuation right?") shown to one in ten scans.
- **Not sent to PostHog:** listing titles or descriptions, seller data, photos, emails, postcodes (cell ID only), free text.

## 3. Langfuse

- **Tracing:** Vercel AI SDK calls export through OpenTelemetry to Langfuse; one trace per pipeline stage per listing or scan, with `listingId`, `scanId`, `packId`, `model`, `tier` (rules, default, escalation), token usage and cost. The trace ID is stored on `item_facts` and `scan_events` so a bad result can be opened from the Review Console.
- **Cost per listing and per scan** are Langfuse dashboards and also copied into `metrics_daily` for the admin dashboard and alerts.
- **Prompt management:** the pack instruction blocks and the recognition and explanation prompts live in Langfuse as versioned prompts with `production` and `staging` labels; the pipeline fetches by label and caches. A prompt change is a labelled version, not a code deploy.
- **Datasets and evaluations:** the fixtures in `fixtures/` are mirrored as a Langfuse dataset; every prompt or model change runs the extraction, recognition and explanation evaluations against it with deterministic scorers (field exact match, hidden-GPU detection, "no invented numbers"), and the run is linked to the pull request. Pass rates must not drop.
- **Scores from real use:** user feedback (`real_deal`, `not_a_deal`), Review Console corrections and scan-card survey answers are written back as Langfuse scores on the originating trace, so quality per prompt version and per model is measured on production data, not only fixtures.
- **Model escalation tuning:** the week-one decision on thresholds uses Langfuse data: cost and correction rate by tier and by asking price.
- **Alerts:** cost per listing above budget, error rate, or latency p95 regressions per prompt version.

## How the loop closes

`product_events` and Langfuse scores feed `metrics_daily`; the admin quality tab shows alert precision, extraction pass rate and correction rate by prompt version; the Review Console turns corrections into fixtures and Langfuse dataset items; the next prompt version is evaluated before it gets the `production` label. PostHog explains the human side: where users drop, which features they use, what they say.

## Privacy and retention

PostHog and Langfuse are listed as sub-processors; PostHog events and replays retained 30 days, Langfuse traces 90 days; both configured for EU data residency; both self-hostable if cost or policy requires.
