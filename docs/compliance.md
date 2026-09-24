# Compliance, privacy and legal

## Data protection (UK GDPR)

- Nabvy is a data controller for user accounts and for listing data it stores. Register with the ICO before public launch (human task).
- Lawful basis: contract for accounts, hunts and billing; legitimate interests for processing public listing data with the minimisation below and for first-party product events needed to run and improve the service; consent for PostHog analytics, session replay and surveys.
- Minimisation: no seller names or profile links; hashed seller IDs; coordinates rounded to 100 m for stored listings; scan photos and raw snapshots deleted after 30 days.
- Rights: account deletion and data export self-serve from the account page; a support address (hello@nabvy.com) for requests; respond within one month.
- Retention schedule: snapshots 30 days; scan photos 30 days unless saved to inventory; alerts and delivery logs 12 months; user accounts until deletion; price observations indefinitely, de-personalised.
- Sub-processors listed in the privacy policy: Supabase (EU), Vercel, Trigger.dev, Apify, Anthropic, Stripe, Resend, Telegram, PostHog, Sentry, Langfuse, Cloudflare, Dub.

## Public documents (human-written, lawyer-reviewed)

- Terms of service, including: valuations are estimates, not financial advice; users buy at their own risk; no guarantee of availability or speed beyond the measured freshness shown.
- Privacy policy and cookie policy; a cookie banner for analytics only (PostHog off until consent).
- Affiliate disclosure for eBay Partner Network links, in the footer and on eBay deal cards.
- Affiliate programme terms for creators (commission, hold, prohibited practices, termination) and a disclosure requirement: creators must label paid links as ads under UK ASA/CAP rules; Dub's first-party click cookie is listed in the cookie policy.
- No-refunds and cancellation policy (`docs/billing.md`; `docs/decisions.md`, "No refunds").

## Platform terms

- **eBay:** use of Browse, Insights and Sell data within the API License Agreement; display eBay item data with the required attribution; do not retain Browse item data longer than the licence allows for display, keeping only derived observations (price, date, product key) long-term; honour the Marketplace Account Deletion notification requirement once seller tokens are stored.
- **eBay Partner Network:** disclose affiliate links; no incentivised clicks; no cookie stuffing.
- **CeX:** web API used at low volume; licensing request in progress; stop on request.
- **Apify:** actors' own terms; our Facebook actor collects only public listing data; no logged-in sessions.
- **Facebook Marketplace legal gate (before exposing Facebook alerts to paying users):** UK legal review of (1) database right over provider-collected listing data, (2) UK GDPR for the personal data in listings, (3) Meta's automated collection terms as they apply to us as a customer of a data provider. Outcome recorded in `docs/decisions.md`. Until then Facebook alerts go to the founder and design partners only.

## Consumer law (UK)

- Prices shown including VAT; clear cadence and speed statements with the measured floor; no fake urgency or scarcity anywhere in the product.
- Subscriptions: clear renewal terms at checkout, reminder before annual renewal, easy cancellation through the Customer Portal, the no-refunds policy published and accepted at checkout (express consent to start now and acknowledgement of losing the 14-day right to cancel), reminders before a trial converts and before annual renewal.
- Electronic marketing (PECR): marketing email only with consent or the soft opt-in, one-click unsubscribe in every message, preference centre, suppression within an hour; service messages separated from marketing on different sending subdomains.

## Content and safety

- No auto-messaging of sellers; prepared messages are copied by the user.
- Risk flags are shown as signals with evidence, never as accusations; wording avoids calling a seller a scammer.
