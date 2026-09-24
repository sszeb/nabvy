# Marketing machinery

Everything that finds users, brings them back and turns them into paying customers, running from the first day the public beta opens. Behaviour-triggered messaging runs on PostHog Workflows (open source, already in the stack, triggered by the same events we track); transactional email goes through Resend with React Email templates kept in the repository; links and creators run on Dub. No separate marketing suite.

## Consent and the law (UK PECR and GDPR)

- **Service messages** (magic links, receipts, alerts the user asked for, security, trial and billing notices) need no marketing consent and go to everyone.
- **Marketing messages** (tips, offers, win-back, newsletter) need consent or the soft opt-in: a customer whose email we collected during sign-up or purchase, messaged about similar services, with an opt-out offered at collection and in every message. Sign-up shows an unticked "Send me tips and offers" box; ticking it records `marketing_consent` with a timestamp and source. Every marketing email carries a one-click unsubscribe (List-Unsubscribe headers, RFC 8058) and a link to the preference centre.
- **Preference centre** (`/app/account/preferences`): categories `tips`, `offers`, `product_updates`, `weekly_digest`, each on or off; "pause all marketing for 30 days"; service messages cannot be turned off. Suppressions are honoured within one hour across every channel.
- Events used for triggering are our first-party `product_events`, forwarded server-side to PostHog for messaging under contract and legitimate interests; analytics cookies remain a separate consent.

## Deliverability

- `nabvy.com` with SPF, DKIM and DMARC (`p=quarantine` moving to `reject`); transactional from `mail.nabvy.com`, marketing from `news.nabvy.com`, so a newsletter mistake never harms magic links.
- Warm-up over the first four weeks; bounce and complaint suppression shared between Resend and PostHog; complaint rate alert above 0.1%.
- Plain-text alternative for every email; no images required to read the message; every number in an email comes from the user's own data.

## Lifecycle programmes (PostHog Workflows)

Each workflow has one trigger, one exit condition, a goal event and a cap of one marketing message per user per day. All copy is plain English with the user's real numbers.

| Programme | Trigger | Messages | Exit | Goal event |
| --- | --- | --- | --- | --- |
| Abandoned checkout | `checkout_started` with no `subscription_active` in 1 hour | 1 h: "finish setting up your area" with what they'd get; 24 h: their cell's freshness and deals found yesterday; 72 h: offer £3 bonus usage on activation | `subscription_active` | `subscription_active` |
| Abandoned onboarding | `signup_completed` with no `hunt_created` in 24 hours | 24 h: one-tap default hunt for their postcode; 3 days: a real deal card from their area | `hunt_created` | `hunt_created` |
| Channel not linked | `hunt_created` with no `channel_linked` in 2 hours | Push or email: "alerts have nowhere to go yet" | `channel_linked` | `channel_linked` |
| Activation | `alert_delivered` with no `alert_opened` in 24 hours | Email: the three best deals found, with margins | `alert_opened` | `alert_opened` |
| Cap reached | `usage_refused` | Immediate: trial offer with £3 bonus; day 3 reminder with what they missed | `trial_started` or `topup_completed` | `trial_started` |
| Trial | `trial_started` | Day 1: how alerts and scans work; day 5: "two days left" with their alerts, opens and deals; day 7: last day | `subscription_active` or cancellation | `subscription_active` |
| Failed payment | Stripe `invoice.payment_failed` | Day 0, 3, 7: update card link (portal); day 10: downgrade notice | `invoice.paid` | `invoice.paid` |
| Win-back | `subscription_cancelled` + 30 days | What changed since they left, plus a £5 usage credit; one message only | `subscription_active` | `subscription_active` |
| Re-engagement | no `alert_opened` or `scan_started` for 14 days | One message: pause hunts or adjust radius | any activity | `alert_opened` |
| Nabvy Daily | 08:00 Europe/London every day (see below) | Local hot deals, their products' price moves, the market recap | preference off | `alert_opened` |
| Weekly review | Monday 08:00 Europe/London, opted in | Their week: alerts, opens, deals bought, inventory profit, price moves | preference off | `alert_opened` |
| Affiliate onboarding | Dub application approved | Assets, link, first-payout explainer | — | first referral |

## Nabvy Daily: the daily brief

One email, one Telegram or Discord post and one public web page a day, at 08:00 Europe/London, built from data we already hold. Personal sections come from the user's own hunts; the market recap is computed once nationally and shared by everyone, which keeps the cost at a penny a day.

| Section | Content | Source |
| --- | --- | --- |
| Hot deals near you | The five highest-scoring deals from the last 24 hours in the user's cells that are still live at send time, each with price, fair value, margin, risk flags and freshness | `alerts`, `listings`, `valuations` |
| Your products | For each product key in the user's hunts: 24-hour and 7-day price move, CeX cash change, count of new listings and of listings gone (sale signal) | `value_bands`, `price_observations` |
| Market recap (UK) | Biggest risers and fallers across the pack, most-listed products, CeX price changes and Most Wanted additions, new-listing volume by source versus the 30-day average, and a three-sentence plain-English summary | `mv_market_daily` plus one model call for the summary |
| Beyond the UK | Only where we hold data: CeX regional price differences (Ireland, Spain and the others the CeX API covers) and, later, eBay marketplaces added as packs; never a summary of markets we do not measure | `price_observations` by region |
| One thing to know | A rotating tip from the pack's what-to-ask checklist or a risk pattern seen this week | Pack content |
| Footer | Preference link, one-click unsubscribe, referral line | — |

Rules: every number comes from the tables; the model writes only the three-sentence recap from a structured bundle and may not add numbers (the same "no invented numbers" contract as valuations); the brief is skipped for a user with nothing new rather than padded; the public web version at `/daily/[date]` carries the market recap and the top national deals (no personal sections) and is indexable, giving a fresh page every day for search. Non-users can subscribe to the public version with consent from the waitlist or the price pages. For users with hunts, the personal sections are the Free tier's delivery method for non-eBay sources and count as service content; the recap rides along, and the preference centre still allows opting out of the whole brief.

## Acquisition

- **Price pages as SEO assets:** public, indexable pages generated from the Price Book for each product key ("Used RTX 3080 price UK: eBay sold, CeX cash, 90-day trend"), updated nightly, with a sign-up prompt to get alerts for that product. These are the long-term organic engine and cost nothing per page.
- **Freshness benchmark page** as the honest speed claim and a link magnet; **the public daily brief** at `/daily/[date]` as a second daily-updated page and the newsletter non-users can join.
- **Landing pages per audience** (flippers, charity-shop hunters, PC builders, server owners) on nabvy.com, each with its own UTM and Dub short link; copy tested through PostHog experiments.
- **Waitlist before launch:** email capture with a postcode and the products they want, stored first-party; launch-day workflow invites by cell as coverage opens.
- **Communities:** Discord and Telegram channel bots ("deals near Manchester") with a Nabvy watermark and link (backlog 5.3); creator programme through Dub (`docs/affiliates.md`).
- **Paid ads, later:** PostHog data pipelines send conversion events back to Google and Meta only after a human decides to spend; UTM discipline from day one so the data exists.
- **Referrals in-app:** "give £5, get £5" surfaced after the first profitable flip is recorded, the moment of highest satisfaction.

## Measurement

Every programme and page has a goal event in PostHog and a cohort; weekly review of send volume, open, click, goal conversion and unsubscribe rate per programme; any programme with a goal conversion below 2% after 500 sends is paused and rewritten. Attribution: UTM and Dub click IDs on every link, stored on the user profile at sign-up, joined to revenue in the business dashboard.

## What stays human

Copy and offers are written by a human and reviewed against `docs/web-app.md` copy rules (no urgency, no hype); the content calendar; the decision to spend on ads; discounts beyond the £3 and £5 credits above.

## Tables

`marketing_consents` (userId, category, granted, source, at), `email_suppressions` (email hash, reason, at), `waitlist` (email, postcode, products, source, at), `newsletter_subscribers` (email hash, consent source, at, unsubscribedAt), `utm_attributions` (userId, first-touch and last-touch UTM, dubClickId, at), `daily_briefs` (date, market recap JSON and text, public deals, sentAt). Owner: `services/marketing`.
