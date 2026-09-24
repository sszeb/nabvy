# Billing and monetisation

Owner module: `billing-entitlements`. Subscriptions run through Better Auth's Stripe plugin (customer created at sign-up, plans with trials, Checkout, Billing Portal, webhook handling with signature verification, one trial per account across all plans). One-off boosts and referral credits are custom code in the same module using the Stripe SDK. Nabvy never sees card numbers. Prices are in GBP and include UK VAT.

## Catalogue (Stripe Products and Prices)

| Product | Price ID env var | Amount | Interval | Includes |
| --- | --- | --- | --- | --- |
| Standard | `STRIPE_PRICE_STANDARD_MONTHLY` | £9.00 | month | 1 area, 5-minute cadence, £10 usage a month |
| Standard annual | `STRIPE_PRICE_STANDARD_ANNUAL` | £90.00 | year | As above; usage allowance still monthly |
| Pro | `STRIPE_PRICE_PRO_MONTHLY` | £29.00 | month | 3 areas, 1-minute cadence, £35 usage a month, top-ups 10% off |
| Pro annual | `STRIPE_PRICE_PRO_ANNUAL` | £290.00 | year | |
| Business | `STRIPE_PRICE_BUSINESS_MONTHLY` | £99.00 | month | 10 areas, 1-minute cadence, export, channel feeds, API access, £120 usage a month, top-ups 20% off |
| Business annual | `STRIPE_PRICE_BUSINESS_ANNUAL` | £990.00 | year | |
| Extra area | `STRIPE_PRICE_EXTRA_AREA` | £4.00 | month | Quantity = extra areas, any paid plan |
| Usage top-up £5 / £10 / £25 | `STRIPE_PRICE_TOPUP_5`, `_10`, `_25` | £5 / £10 / £25 | one-off | Usage balance that does not expire; Pro and Business receive 10% or 20% more usage per pound |

The Free tier has no Stripe object: £0.50 usage a month, reset on the first of the month, full data enrichment, live eBay alerts, daily digest of other sources. Boosts and exports are not separate Stripe products; they are metered usage items paid from the balance.

Plugin configuration: three plans, `standard`, `pro` and `business`, each with `priceId`, `annualDiscountPriceId`, `limits` (areas, cadenceSeconds, includedUsagePence, topupDiscountPct) and, for `standard` only, `freeTrial: { days: 7 }`; `createCustomerOnSignUp: true`; `requireEmailVerification: true`; automatic tax enabled in Checkout params. The trial is offered when a Free user reaches the usage cap and includes a £3 bonus usage grant that expires with the trial; the plugin enforces one trial per account. Extra areas are a separate subscription item with quantity, managed by custom code through the SDK.

## Usage balance

Metered actions debit a per-user usage balance in pence through a ledger, never a running counter:

- `usage_ledger` rows: `userId`, `deltaPence` (negative for a charge), `kind` (`included_grant`, `bonus_grant`, `topup`, `charge`, `reversal`, `referral`), `action` (`scan_cached`, `scan_live`, `similar_search`, `boost_24h`, `boost_7d`, `export`), `refId` (scan event, boost, Stripe payment intent), `expiresAt` for grants, `at`.
- Balance = sum of unexpired grants and top-ups minus charges, computed as two buckets: expiring (included and bonus grants) is spent first, then non-expiring (top-ups). A monthly job writes the included grant on each user's billing anniversary (Free: first of the month) and expires the previous one.
- Every metered action checks the balance first, shows its price in the UI, and refuses with a top-up or upgrade prompt when insufficient. Charges are written in the same transaction as the action's result; a failed action is reversed (its credits returned) in the same transaction. A reversal is not a refund of money.
- The Free cap of £0.50 is simply the Free included grant; there is no separate scan counter.
- List prices per action are configuration (`docs/decisions.md`), set at two to three times measured cost and reviewed monthly against `metrics_daily`.

## Entitlements

The `entitlements` view answers, per user: `tier`, `areasIncluded` (Free 0, Standard 1, Pro 3, Business 10, plus extra-area quantity), `cadenceClass` (Free: digest only, eBay live; Standard: 300 s; Pro and Business: 60 s), `channels` (Free: Telegram or email digest; paid: all, Business adds channel feeds), `liveSources` (Free: eBay; paid: all enabled sources), `maxActiveHunts` (Free 3, Standard 20, Pro 100, Business 500), `includedUsagePence` (50, 1000, 3500, 12000), `topupDiscountPct` (0, 0, 10, 20), `exportEnabled` (Business), `activeBoosts`.

Entitlements derive from the plugin's `subscription` table (status, plan, period end, trial end, seats) plus `boosts` and `user_profiles.lifetimeFree`, recomputed in the plugin's lifecycle hooks (`onSubscriptionComplete`, `onSubscriptionUpdate`, `onSubscriptionCancel`, `onSubscriptionDeleted`) and by the boost webhook. The plugin verifies webhook signatures; custom handlers for boosts record the Stripe event ID in `billing_events` for idempotency. Stripe is the source of truth; the app never grants a paid entitlement without a Stripe event, except design-partner lifetime accounts set by an admin with an audit row.

## Flows

- **Upgrade:** `authClient.subscription.upgrade({ plan, annual })` opens Stripe Checkout; success returns to the app; the webhook grants the entitlement, so the app shows "activating" for up to a minute. Plan switches between Standard and Pro use the plugin's upgrade or scheduled change.
- **Manage, cancel, change card, invoices:** the plugin's billing portal session, linked from the account page. Cancellation takes effect at period end with no proration credit; entitlement drops when the subscription ends. Downgrades are scheduled for the period end; upgrades apply at once and charge the difference.
- **Top-ups:** custom Stripe Checkout in payment mode with a top-up price; `checkout.session.completed` writes a `topup` ledger row (with the plan's bonus percentage) and a `billing_events` row for idempotency. Auto top-up (charge the saved card when the balance falls below £1) is a later option, off by default.
- **Boosts and exports:** debited from the usage balance; a boost writes a `boosts` row for the Crawl Planner.
- **Failed payment:** Stripe Smart Retries; the app shows a banner from `invoice.payment_failed`; after the final retry the subscription becomes `unpaid` and the entitlement reverts to Free. Data and hunts are kept.
- **No refunds** (owner, 2026-09-24; `docs/decisions.md`, "No refunds"):
  - **Disclosure.** Pricing and Checkout show "Payments are non-refundable" before purchase.
  - **Start now.** Every Checkout for a subscription, trial or top-up has one required tick, "Start my plan now", with the wording from `docs/policies/refunds-and-cancellation.md`. The confirmation and its time are stored in `billing_events` (owner, 2026-09-24).
  - **No refund path** for users or admins.
  - **Chargebacks.** `charge.dispute.created` is recorded in `billing_events`, and the affiliate commission is reversed.
- **Referral credit:** £5 non-expiring usage to both the referrer and the referred user when the referred user's first subscription invoice is paid; written as `referral` ledger rows once per pair. Referral codes are per user and stored in `user_profiles`.
- **Design partners:** admin sets `lifetimeFree` on the profile; entitlement treated as Pro.

## Tax and invoicing

Stripe Tax enabled with UK VAT on all prices (prices are tax-inclusive). Business customers can enter a VAT number in the Customer Portal. Stripe issues invoices and receipts; the app links to them. Nabvy's legal entity, address and VAT status must be set in Stripe before going live (human task).

## Revenue from eBay Partner Network

Not user-facing. Browse calls carry the EPN campaign ID; commission accrues in the EPN account. Affiliate use is disclosed in the app footer and on eBay deal cards ("Nabvy may earn a commission if you buy through this link"). Never alter ranking or verdicts for affiliate reasons; the Valuation Engine has no knowledge of affiliate status.

## Cost guardrails tied to billing

The Crawl Planner's cadence rule uses subscription revenue per cell from `entitlements`. A cell with no paying subscribers runs at the hourly sweep only. Boosts add a temporary unit at the boost cadence and are capped by `FB_DAILY_CAP_MINOR` like everything else.

## Tables

`subscription` (Better Auth Stripe plugin: plan, referenceId, stripeCustomerId, stripeSubscriptionId, status, periodStart, periodEnd, cancelAtPeriodEnd, trialStart, trialEnd, billingInterval, stripeScheduleId), `entitlements` (materialised per user), `usage_ledger` and `usage_balances` (materialised expiring and non-expiring buckets), `boosts` (productKey, cadence, startsAt, endsAt, ledgerRowId), `billing_events` (Stripe event ID, type, processedAt) for the custom handlers, `referrals` (referrerUserId, referredUserId, creditedAt).

## Tests

Webhook idempotency (same event twice → one change); entitlement matrix per tier; trial offered once and refused twice; failed-payment downgrade; monthly grant and expiry; balance buckets spend expiring first; a metered action refused at zero balance and reversed on failure; Checkout refuses to proceed without the start-now tick, and the stored confirmation matches the session; no user or admin path can create a refund; downgrades land at period end with no credit; boost expiry removes the unit; referral credit applied once.
