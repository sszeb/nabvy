# Affiliate and creator programme

Creators (YouTube, TikTok, Discord and Telegram server owners, bloggers) get a link and a code, send people to Nabvy, and are paid a share of what those people spend. The programme runs from day one of the public beta on Dub Partners, an open-source affiliate platform with first-party link tracking, Stripe-native conversion attribution, a partner portal, automated global payouts through Stripe Express and PayPal, and tax handling. Customer-to-customer referrals ("give £5, get £5") stay in our own usage ledger.

## Terms (modelled on the programmes that work: 20–30% recurring, 60–90-day cookies, tiers for volume, holds for refunds, two-sided incentives)

| Term | Nabvy |
| --- | --- |
| Commission on subscriptions | 30% of net subscription revenue for the referred user's first 12 months (Standard, Pro, Business, extra areas) |
| Commission on usage top-ups | 10% for the same 12 months (top-ups carry real provider cost, so the share is lower) |
| Tiers | 30% base; 35% once 25 referred users are paying at the same time; 40% at 100. Reviewed quarterly, never reduced retroactively |
| Attribution | Last click, 90-day cookie, first-party tracking through Dub links; codes attribute without a click |
| Two-sided incentive | The referred user gets £5 of non-expiring usage credit on their first paid invoice, plus any code discount the creator chooses to pass on (creator may split up to 10 points of their commission into a customer discount) |
| Hold and clawback | Commissions become payable 30 days after the invoice (the money-back window); refunds and chargebacks reverse the commission |
| Payouts | Monthly, minimum £20, through Dub (Stripe Express bank payout, PayPal where needed); payout fees as published by Dub |
| Approval | Application reviewed within two working days; UK and international creators accepted; no purchase required |
| Disclosure | Creators must disclose paid links (#ad or "affiliate link") as required by UK ASA/CAP rules and their platform |
| Prohibited | Self-referral; paid search on "Nabvy" or misspellings; coupon and cashback sites; incentivised sign-ups; misleading claims about speed or profit; spam |
| Assets | Link, code, logo pack, deal-card screenshots, the public freshness page embed, short scripts, UTM presets |

## How it is wired

1. **Links and codes.** Dub issues each partner a short link (`nabvy.link/<slug>`, custom domain on Dub) and a code. The landing page reads Dub's first-party click cookie; sign-up carries it.
2. **Lead.** On sign-up the server calls Dub's track-lead endpoint with the click ID from the cookie and our `userId` as the external customer ID.
3. **Sale.** On every paid invoice (subscriptions and top-ups) the billing module's Stripe handler calls Dub's track-sale endpoint with amount, currency, invoice ID and the external customer ID. Dub computes the commission from the programme rules; the 12-month window and tier logic live in Dub's reward configuration.
4. **Refunds.** The refund handler calls Dub to reverse the sale, which claws back the commission.
5. **Two-sided credit.** The same invoice handler writes the £5 `referral` row into `usage_ledger` when the invoice is the user's first and the user has an affiliate attribution.
6. **Portal.** Partners use Dub's portal for stats and payouts; Nabvy shows a `/partners` page with terms, the application link and assets.
7. **Payouts.** Monthly, confirmed by a human in Dub with one click; Dub handles KYC, currencies and tax forms.

We never track affiliates with third-party cookies or fingerprinting; Dub's tracking is first-party and disclosed in the cookie policy.

## Economics

At £9, £29 and £99 plans with gross margins around 75–85% on subscriptions, a 30% commission for 12 months keeps payback under four months on Standard when a referred user stays six months or more. Top-ups run at roughly 60% margin, hence the 10% share. Tiers pay more only for partners who already deliver volume.

## Why Dub rather than our own

Building attribution, a portal, payouts with KYC and tax paperwork is weeks of work and ongoing operations. Dub is open source (AGPL-3.0, so it stays outside our codebase and is used as a service or self-hosted unchanged), integrates natively with Stripe, and charges self-serve plans plus payout fees rather than annual contracts. If its fees ever outgrow the programme, the same tracking calls can move to a self-hosted Dub or to our own ledger without changing partner-facing terms.

## Tables and fields

`user_profiles.affiliateClickId` (Dub click ID captured at sign-up), `user_profiles.affiliatePartnerId` (from Dub after lead tracking), `billing_events` rows for every track-sale and refund call with Dub's response, `affiliate_applications` (if the application form is hosted by us rather than Dub).

## Tests

Lead tracked once per user; sale tracked once per invoice (idempotent by invoice ID); refund reverses; the £5 credit written only on the first paid invoice; a user with no click ID and no code produces no calls.
