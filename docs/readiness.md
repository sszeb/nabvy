# Readiness assessment

Purpose: state what the documentation covers, what remains for humans, and whether an agent can start building for live production from this pack.

## Coverage

| Area | Where | Status |
| --- | --- | --- |
| Product definition, audience, features, non-goals | `README.md`, `docs/decisions.md` | Complete |
| Architecture, modules, data flows, timestamps, scale | `docs/architecture.md`, `docs/modules.md` | Complete |
| Types, events, tables, indexes, retention, adapter interface, model contracts | `docs/contracts.md` | Complete; implemented as Zod in Phase 0 |
| Data access: Facebook actor, eBay, CeX, Gumtree, fail-over, caps | `docs/providers.md` | Complete, pending the actor field mapping (task 1.0) |
| Valuation, risk, days-to-sell, escalation | `docs/valuation.md`, `docs/packs/gpu-pc.md` | Complete; thresholds to be tuned from week-one data |
| Scan mode and similar-item search | `docs/scan-mode.md` | Complete |
| Web app screens, onboarding, channels, copy, analytics | `docs/web-app.md` | Complete; brand assets pending |
| User and admin dashboards, database stance | `docs/dashboards.md` | Complete |
| Analytics and learning loop (first-party events, PostHog, Langfuse) | `docs/analytics.md` | Complete; PostHog and Langfuse projects pending |
| Marketing machinery (lifecycle programmes, consent, deliverability, SEO pages, waitlist) | `docs/marketing.md` | Complete; copy and sending domains pending |
| Monetisation: Stripe catalogue, usage balance, entitlements, trials, tax, refunds, referrals | `docs/billing.md` | Complete; Stripe account setup pending |
| Affiliate and creator programme | `docs/affiliates.md` | Complete; Dub workspace setup pending |
| Identity and sessions (Better Auth), server-only data access, RLS | `docs/security.md`, `docs/contracts.md` | Complete |
| Security | `docs/security.md` | Complete; external scan pending |
| Compliance and legal | `docs/compliance.md` | Complete; documents and ICO registration pending |
| Operations, CI/CD, monitoring, runbooks, testing, launch checklist | `docs/operations.md` | Complete |
| Build order and definitions of done | `docs/backlog.md` (42 tasks, 7 check-ins) | Complete |
| Fixtures and secrets | `docs/fixtures.md`, `docs/secrets.md` | Complete; collection and accounts pending |
| Engineering conventions (toolchain, packages, database roles, identifiers, events, metering, storage, limits, local dev, branching) | `docs/engineering.md` | Complete |
| Progress tracking across sessions | `docs/progress.md` | Complete |

## What only a human can do

| Action | Needed before |
| --- | --- |
| Apify token and the deployed Facebook actor; Anthropic key; Trigger.dev project; Telegram bot | Phase 1 |
| eBay developer keyset (production), Partner Network approval, Marketplace Insights and Sell API access | Phase 2 and 3 |
| CeX or CeXDB licensing conversation | Ongoing; not blocking |
| Stripe account with legal entity, VAT settings, products and prices | Phase 4 |
| Resend sending domain, VAPID keys, Sentry, PostHog, Turnstile, Google OAuth client | Phase 4 |
| Terms, privacy and cookie policies (lawyer-reviewed); ICO registration; affiliate disclosure wording | Launch |
| UK legal review for the Facebook gate | Facebook alerts to paying users |
| Brand assets (logo, palette) | Public launch |
| Fixture labelling (first 100 items) and design partners (five) | Phase 1 and 4 |
| Decisions after week one: primary and fallback Facebook actor, model escalation thresholds | End of Phase 1 |
| External security scan; load check sign-off | Launch |

## Known risks and the mitigation in the pack

| Risk | Mitigation |
| --- | --- |
| Facebook access changes or the actor is blocked | Fallback actor, fail-over rule, kill switch, "delayed" banner, private-only gate until legal review |
| CeX web API changes or is closed | Cached low-volume use, licensing request, fallback actor; valuation works without the floor (confidence lower) |
| eBay sold prices unavailable without Insights | `ended` signal from rechecks at half weight; `ask_based` state shown honestly |
| Cold start of the Price Book | On-demand fetch in scan mode; hourly sweep; ask-based state; corrections from the Review Console |
| Provider cost overrun | Daily caps per provider and per scan; cadence rule tied to revenue per cell; spend alerts |
| Wrong valuations damaging trust | Comparables shown on every card; confidence and state labels; feedback loop; fixture pass-rate gate in CI |
| Agent drift across sessions | Single contracts package, one task per session, check-ins, `docs/questions.md` |

## CEO and technical review

**CEO: Can a customer pay us on day one of the beta?** Technical: yes, from Phase 4: Checkout with trial, portal, webhooks to entitlements, VAT via Stripe Tax; the free tier runs from Phase 2 with eBay alerts funded by affiliate commission.

**CEO: What is the first thing a user sees that no competitor shows?** Technical: the deal card's fair-value range with a 90-day trend, the CeX cash floor and the freshness stamp, all from Phase 1 on Facebook listings; scan mode from Phase 3.

**CEO: Where does money leak?** Technical: provider calls and model calls. Both are capped daily and metered per call; the cadence rule refuses to run a cell faster than its revenue allows; unit costs are in the daily rollup from Phase 1.

**CEO: What stops an agent from building something insecure?** Technical: `docs/security.md` is required reading for any task touching auth, tokens, uploads, webhooks or migrations; RLS tests, secrets scanning and bundle checks are in CI; service-role keys never reach the browser.

**CEO: What is still a promise rather than a fact?** Technical: measured freshness, actor costs and extraction accuracy come from the week-one run; sold-price quality depends on eBay's Insights decision; the Facebook legal gate decides who sees Facebook alerts. All three are scheduled, not assumed.

**CEO: Can this go live without me?** Technical: no, and it should not. The human list above is short and mostly accounts, approvals and legal documents; everything else is specified to a definition of done.

**Verdict:** the pack is sufficient to start Phase 0 and Phase 1 now and to reach a private beta with the human actions listed. Public paid launch depends on the launch checklist in `docs/operations.md`.
