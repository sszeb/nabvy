# @nabvy/subscriptions

Turns Better Auth's Stripe subscriptions into entitlements per user, under the no-refunds rules
(`docs/design/modules/subscriptions.md`, `docs/billing.md`).

## Switch and priority

Off by default (rule 11 of `docs/design/modules/_rules.md`; no seed row, so
`switches.state('subscriptions')` reads `off`). **Off or shadow**: no Checkout starts
(`subscriptions.off`, from the procedures and from the Stripe plugin's own Checkout endpoint);
the allowance sweep writes nothing; `v_billing_signals` has no rows while off. Entitlements
already granted stay, and everyone else is Free (card, "When off"). **Exceptions while off**:
Stripe webhooks keep recording and applying, so no renewal or cancellation is lost (see
"Decisions"), and `v_entitlements` always returns its rows (rule 11 names it). **On**: all of it.
MVP, live at the public beta launch (`docs/decisions.md:93`), BP4.

## Inputs

- Stripe webhooks, verified twice: by `createStripeWebhookRoute` (signature and replay) and by
  the Better Auth Stripe plugin, whose `onEvent` hook calls `processStripeEvent`. Types used:
  `customer.created|updated`, `customer.subscription.created|updated|deleted`, `invoice.paid`,
  `invoice.payment_failed`, `charge.succeeded|failed`, `charge.dispute.created`,
  `checkout.session.completed`; the rest are recorded as `ignored`.
- Event `account.deleted` (from `account`): `accountDeletedHandler` purges the entitlement.
- Injected policies: `SubscriptionsLadderPolicy` (pricing-console's ladder rows: areas, wants,
  channels, base cadence, floor, trial, Stripe price IDs; stub `pendingPricingConsoleLadder`
  until pricing-console merges), `UsageLedgerPolicy` (bundle and top-up credit, from
  usage-ledger), `TrialEligibility` (account-integrity, soft: `allowTrialWhenAbsent`, and
  `trialEligibilityWithSwitch` allows while that module is off).
- Reads: `@nabvy/switches`' `state(q, 'subscriptions' | 'account-integrity')`; `@nabvy/account`'s
  `isActive(q, userId)` (standing, through auth's `better_auth.account_active`).
- Configuration: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_TOPUP_5|10|25`,
  `STRIPE_PRICE_EXTRA_AREA` through `@nabvy/config`'s `loadEnv(['stripe'])`
  (`subscriptionsStripeFromEnv`). Thresholds in `packages/config/src/modules/subscriptions.ts`.

## Outputs

- **Events** (identifiers only):
  - `subscriptions.entitlement-changed` v1 `{ userId }`, keyed
    `subscriptions.entitlement-changed:<userId>@<stripeEventId>`.
  - `subscriptions.webhook-failed` v1 `{ stripeEventId | null, reason }` for `ops-alerts`, keyed
    by the event ID (or a hash of an unverified body) and the reason. Reasons: `signature`,
    `unknown_customer`, `unknown_plan`, `out_of_order`, `no_policy`, `consent_missing`,
    `processing`.
- **Usage grants** through `@nabvy/usage-ledger`: `grantAllowance` (the monthly bundle, refId
  `allowance:<sub>@<window start>`, expiring at the window's end, valued by policy) from renewal
  invoices and the sweep; `grantTopup` (refId = payment intent) from a paid top-up Checkout. The
  brief's `grantByPolicy` is usage-ledger's internal helper behind these two.
- **Internal views** (`nabvy_pipeline` only until per-module roles exist):
  - `subscriptions.v_entitlements`: `user_id, tier, status, areas, wants, channels,
    base_cadence_seconds, floor_cadence_seconds, period_end, cancel_at_period_end, trial_end,
    policy_version, updated_at`. Always returns its rows. A user with no row is Free.
  - `subscriptions.v_billing_signals` (internal only, never user-facing): `user_id,
    failed_payments, disputes, last_failed_payment_at, last_dispute_at, card_fingerprints`, for
    account-integrity's ban-evasion check. Rows only while not off.
- **No user-facing view**: no module has created the `app` schema yet (the call `account` and
  `usage-ledger` made). The user's plan is `getPlan()` through a procedure.
- **Functions** (`@nabvy/subscriptions`):
  - `startCheckout(q, userId, { plan, annual, startNow: true }, ladder)` → the body for Better
    Auth's `upgradeSubscription` (with the tick time in its metadata), after `checkoutGate`
    (switch on, tick fresh, account active) and a check that the ladder sells the plan.
  - `startTopup(q, userId, { packPounds, startNow: true }, deps)` → a payment Checkout with the
    same tick, refused unless the policy can value the pack.
  - `getPlan(q, userId, ladder)` (withUser, the user's own plan: no Stripe IDs, no policy
    version, no signal) and `getEntitlement(q, userId, ladder)` (modules).
  - `stripePluginOptions(deps)`: the plugin's options (plans from the ladder on every call,
    `authorizeReference` to self only, `getCheckoutSessionParams` enforcing the gate and adding
    the consent tick and Stripe Tax, `onEvent` → `processStripeEvent`).
  - `createStripeWebhookRoute(options)`, `processStripeEvent(event, deps)`,
    `grantDueAllowances(q, { after, now })` (the sweep, 500 a call), `purge(q, userIds)`,
    `accountDeletedHandler(deps)`, `checkoutConsentParams()`, `stripePort(stripe)`,
    `subscriptionsStripeFromEnv()`.
- Error codes `subscriptions.off | start_now_required | account_inactive | unknown_plan |
  no_policy`, each with a message in `SUBSCRIPTIONS_MESSAGES`. There is no refund function, for
  users or admins (`docs/decisions.md`, "No refunds").

## Tables

All in the `subscriptions` Postgres schema. Written only by `nabvy_pipeline`.

- `entitlements`: `user_id` (primary key), `tier`, `status` (`free | trialing | active |
  past_due`), `areas`, `wants`, `channels`, `base_cadence_seconds`, `floor_cadence_seconds`,
  `period_start`, `period_end`, `cancel_at_period_end`, `trial_end`, `stripe_subscription_id`,
  `interval_months` (1 or 12), `period_cash_minor` and `cash_period_start` (the paid period's
  net cash, for the allowance), `policy_version`, `last_event_id`, `last_event_at` (older Stripe
  events never overwrite newer ones), `updated_at`. `nabvy_app` reads its own row (RLS).
- `customers`: `stripe_customer_id` (primary key) → `user_id`, learned from the plugin's
  `userId` metadata; never updated, so a customer can never move to another user. `nabvy_app`
  reads its own link (top-up Checkout).
- `billing_events`: `id`, `stripe_event_id` (**unique**: idempotency and replay refusal),
  `type`, `stripe_object_id`, `user_id`, `outcome` (`applied | recorded | stale | ignored`),
  `stripe_created_at`, `checkout_session_id`, `consent_start_now` and `consent_at` (the "Start
  my plan now" tick and when it was ticked, stored with the payment; all three set together or
  none), `signal` (`payment_failed | dispute`), `card_fingerprint`, `amount_minor`, `currency`,
  `processed_at`. Append-only: no grant and a trigger refuse update, delete and truncate, even
  for the owner. No `nabvy_app` access.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Entitlement matrix | `active`, `trialing` → the plan; `past_due` → the plan (Smart Retries); every other status and deletion → Free; cancel at period end keeps the plan to the end | `docs/billing.md`, "Flows"; `docs/decisions.md`, "No refunds" | Fixed by the design |
| Areas | Plan's areas + quantity of extra-area items | `docs/billing.md`, "Entitlements" | Fixed |
| Plan values | None here: ladder policy rows, with version | `docs/decisions.md`, "Paid ladder" | Fixed |
| Free fallback | 1 area, 1 want, Telegram or email; only while pricing-console has no `free` row | "Free tier: bursts under a lifetime cap"; `docs/billing.md` | Starting value |
| Webhook tolerance | 300 s | Stripe's default | Fixed by Stripe's scheme |
| Tick freshness | 600 s between the tick and the Checkout | A Checkout opens straight after the tick | Starting value |
| Allowance window | Calendar months from the paid period's start, cash = period net ÷ months | `docs/billing.md`: allowance monthly on annual plans | Fixed |
| Sweep batch | 500 entitlements | `CLAUDE.md`, "Batches, not items" | Fixed |

## Fixtures and pass rate

Stage `entitlements` (`test/fixtures/entitlements.fixtures.ts`), 4/4, the card's four tests as
synthetic cases on the real migrations in PGlite, built from `docs/billing.md`,
`docs/decisions.md` ("No refunds") and synthetic Stripe events in `test/fixtures/stripe/`
(Stripe's documented shapes; no test keys yet): `entitlement-matrix`, `webhook-replay`,
`checkout-needs-start-now`, `billing-signals-internal`.

`test/domain.test.ts` covers the status matrix, plan matching, extra areas, allowance windows
and their boundaries, net cash and tick freshness. `test/webhook.test.ts` covers the lifecycle,
stale events, unknown plans, the trial check, allowances (renewal, out of order, no policy then
the sweep, annual), top-ups, signals, and the route (bad and stale signatures, forwarding).
`test/checkout.test.ts` covers the gate, plans only from the ladder, standing, top-up Checkout
and the plugin options. `test/idempotency.test.ts` runs each event and `account.deleted` twice.
`test/switch.test.ts` covers off, shadow and on. `test/contracts.test.ts` checks the events,
the Stripe fixtures and the inputs. `packages/db/tests/subscriptions.test.sql` covers grants,
RLS, append-only billing events, the views' switch rules and that no user-facing view reads
`v_billing_signals` (`pnpm db:dry-run`).

## Decisions

- 2026-09-24: entitlements are written from the plugin's `onEvent` hook, not its
  per-lifecycle callbacks. `@better-auth/stripe` 1.7.5 catches and only logs errors thrown by
  `onSubscriptionComplete`, `onSubscriptionUpdate`, `onSubscriptionCancel` and
  `onSubscriptionDeleted`, so a failed write would be acknowledged to Stripe and lost; an error
  in `onEvent` becomes a 400 and Stripe retries. Entitlements derive from Stripe's own
  subscription object in the event (Stripe is the source of truth), not from the plugin's
  `subscription` row, so this module needs no grant on `better_auth`.
- 2026-09-24: idempotency by Stripe event ID: one `billing_events` row per event, written in
  the same transaction as its effects, under an advisory lock on the ID. A failed event writes
  nothing and emits `webhook-failed`; Stripe's retry processes it again. Replays of processed
  events are answered 200 by the route without reaching the plugin.
- 2026-09-24: the route verifies the signature before the plugin does, because the plugin
  answers a bad signature with a 400 and no hook, and the card wants `webhook-failed` for it.
  Neither the response nor anything logged carries the body, the reason or the secret.
- 2026-09-24: Stripe does not order events. An older subscription event never overwrites a
  newer one (`last_event_at`), a subscription the user has moved off never downgrades the
  current one, and an invoice or charge that arrives before what it depends on fails as
  `out_of_order` or `unknown_customer`, so Stripe retries it later.
- 2026-09-24: the "Start my plan now" tick is enforced three times: the procedure input needs
  `startNow: true`; the plugin's Checkout endpoint refuses a request without a fresh tick time
  in its metadata (so a client skipping the procedure is refused); and Stripe Checkout itself
  shows a required tick (`consent_collection.terms_of_service`). The completed session's
  consent and the tick time are stored in `billing_events`; a payment without them is recorded
  with `consent_start_now = false` and reported as `consent_missing`.
- 2026-09-24: allowances are granted per monthly window of the paid period, from renewal
  invoices and from a sweep (annual plans; a missed webhook). A renewal without a usage policy
  records the period's cash and alerts ops; the sweep grants once a policy exists. Only
  invoices that took money grant; upgrades' proration and trials grant nothing (question).
- 2026-09-24: a new `customers` table (Stripe customer → user) besides the card's two, because
  disputes, charges and invoices name only the customer or the charge.
- 2026-09-24: webhooks keep recording while the module is off (question); Checkout and the
  sweep stop. The module sets no prices; top-up packs and the extra area are Stripe price IDs
  from config; plan prices are ladder rows.
- 2026-09-24: no audit rows yet: this module has no human or admin action (there is no refund
  path; design-partner lifetime plans are not built), so it does not import `audit-log`, which
  the card lists, until one is added.
- 2026-09-24: a plan change on an existing subscription goes through the plugin's upgrade
  endpoint without a Checkout, so `getCheckoutSessionParams` does not see it. Standing still
  applies there (auth revokes a restricted account's sessions); the switch does not (question).

## Open questions

`docs/questions/subscriptions.md`: Stripe test keys; the obsolete plan price variables; nothing
on sale until pricing-console; mounting the plugin in auth; webhooks while off; the tick
wording; consent kept after deletion; allowance on upgrade and trial; no Free monthly grant;
entitlements copying the policy; the trial check; design partners.

## Incidents

None.
