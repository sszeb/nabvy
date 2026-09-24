# Web app

A Next.js PWA at nabvy.app; marketing pages at nabvy.com. Mobile-first, installable, works as a normal website on desktop. Sign-in by magic link or Google through Better Auth; the app calls typed oRPC procedures (with TanStack Query on the client for reads) that run module functions inside `withUser`, with row-level security as a second layer; the same router serves the OpenAPI public API for Business customers; all model and provider work in Trigger.dev tasks, never in the browser.

## Routes and screens

| Route | Screen | Purpose |
| --- | --- | --- |
| `/` (nabvy.com) | Landing | What Nabvy does, the honest speed benchmark, pricing, sign-up |
| `/pricing` | Pricing | Watch-and-check model explained in plain words: areas and cadence per plan, included usage, list prices per action, VAT-inclusive |
| `/freshness` | Public freshness | Yesterday's median listed-to-delivered time per source |
| `/app` | Dashboard | Today's numbers, deals-near-you map, hunts, watchlist trends, inventory profit, scans, usage (`docs/dashboards.md`) |
| `/app/deals` | Deal feed | Alerts newest first; filters by hunt, source, score; freshness stamp on each |
| `/app/deal/[id]` | Deal card | Full valuation, comparables, flags, actions, feedback |
| `/app/hunts` | Hunts | List, create from postcode + product or category, edit, pause |
| `/app/scan` | Scan | Camera, barcode, photo, progress state, scan card |
| `/app/inventory` | Inventory | Items bought, listed, sold; profit to date |
| `/app/account` | Account | Profile, channels (Telegram link, push, email), usage balance and history, top-up, billing portal link, referral code, export, delete account |
| `/app/account/preferences` | Preferences | Marketing categories on or off, pause marketing 30 days, digest day |
| `/prices/[productKey]` (nabvy.com) | Price page | Public, indexable: used price in the UK from eBay sold, CeX cash, 90-day trend, alert sign-up prompt |
| `/waitlist` (nabvy.com) | Waitlist | Email, postcode, wanted products; used before launch and for cells not yet covered |
| `/daily/[date]` (nabvy.com) | Nabvy Daily archive | Public market recap and top national deals for each day, indexable, with newsletter sign-up |
| `/app/onboarding` | Onboarding | Postcode → default hunt → channel → first alert preview |
| `/partners` | Partners | Affiliate programme terms, application link (Dub), assets, disclosure rules |
| `/admin` | Admin dashboard | Operations, quality, business and users tabs with actions, per `docs/dashboards.md` |
| `/admin/review` | Review console | Quarantine, corrections, spot checks |

## Deal card

Order of blocks: verdict line (deal score, margin, "below CeX cash price" badge when applicable); asking price and fair-value range with the 90-day sparkline and trend arrow; confidence and state (`valued`, `ask_based`, `unvalued`); CeX cash and voucher; days-to-sell range; risk flags with evidence; comparables (sold, ended, live asks) with source, price, date, distance; freshness stamp "listed 14:02 · found 14:05 · delivered 14:05"; actions: open listing, copy prepared message, checklist, mark bought (cost), later mark sold (price, marketplace); feedback: real deal / not a deal. Affiliate note on eBay cards.

Prepared message and checklist come from the pack template. Never auto-send.

## Onboarding

Postcode → one default hunt for the first pack (radius 40 km, deal score 60, all delivery methods) → connect a channel (Telegram deep link with a one-time code, or enable push, or email) → show three example cards from the last day in their area → offer the trial.

## Channel linking

- **Telegram:** account page shows a `t.me/<bot>?start=<one-time code>` link; the bot resolves the code to the user and stores `telegram_links(userId, chatId)`. `/stop` unlinks.
- **Web push:** service worker (Serwist) subscribes with the VAPID public key; subscription stored in `push_subscriptions(userId, endpoint, keys, userAgent)`; iOS requires the app to be installed to the home screen, which onboarding explains.
- **Email:** verified address from auth; digest opt-out in preferences; unsubscribe link in every email.

## Scan screen

Camera view with barcode detection running; shutter for a photo; optional second photo of the price tag; progress list while sources return ("eBay ✓, CeX ✓, Facebook …"); then the scan card per `docs/scan-mode.md`; correction affordance on the identification line.

## Copy rules

Plain English, UK spelling, no exclamation marks, no urgency language. Every number carries its basis ("median of 14 sales in 90 days"). Disclaimers: "Estimates, not advice" on every valuation; affiliate note on eBay cards.

## Analytics events (first-party always, PostHog after consent; full taxonomy in `docs/analytics.md`)

`signup`, `onboarding_completed`, `hunt_created`, `alert_opened`, `alert_feedback` (verdict), `scan_started`, `scan_identified` (confidence, confirmed), `scan_valued` (state, onDemand), `listed_on_ebay`, `bought_recorded`, `sold_recorded`, `checkout_started`, `subscription_active`, `channel_linked` (channel). The north star is computed from `sold_recorded` with a linked alert or scan.

## Brand and visual identity

Name: Nabvy. Tone: plain, confident, honest; no hype. Until brand assets exist, use the shadcn/ui default theme with one accent colour (deep teal) and system fonts; a human supplies the logo and palette later. Never use marketplace or CeX logos beyond what their terms allow.

## Accessibility and performance

Keyboard-navigable, WCAG AA contrast, reduced-motion respected, Lighthouse PWA and accessibility scores above 90 on the deal feed and scan screens.
