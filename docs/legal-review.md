# Items for legal review

The owner's instruction (2026-09-24): "Run everything as instructed and only write to a document what needs a legal review but do not run any legal reviews or checks until requested."

This file lists points a lawyer may want to look at. It gives no analysis, and no legal review or check has been run. Nabvy is built as the owner instructed (`docs/decisions.md`). Add an item whenever one comes up; review only when the owner asks.

| # | Area | Point to review | Where it is decided |
| --- | --- | --- | --- |
| 1 | Charging | Charging from launch, which the actor brief said should wait for legal advice | `docs/decisions.md`, "MVP scope and pipeline runtime"; Precedence row "Legal gates" |
| 2 | Refunds | The strict no-refunds policy, and its wording on the pricing page, at Checkout and in the terms | `docs/decisions.md`, "No refunds"; `docs/billing.md` |
| 3 | Refunds | Whether consumer cancellation rights, reminders before a trial converts or a plan renews, or refunds required by statute, affect the no-refunds policy | `docs/decisions.md`, "No refunds" |
| 4 | Enforcement | Automatic, autonomous suspensions and bans, with a vague notice and no reasons given | `docs/decisions.md`, "Fair use, suspension and bans" |
| 5 | Enforcement | Whether users need a way to contest an automated ban, or a human review, and how subject access requests are answered about enforcement data | `docs/decisions.md`, "Fair use, suspension and bans" |
| 6 | Enforcement | No refund on a ban; no new account for a banned person; ban-evasion checks using email and payment card | `docs/decisions.md`, "Fair use, suspension and bans" |
| 7 | Terms | The Terms of Service, No-refunds and Cancellation Policy, Acceptable Use Policy and Fair Use Policy drafts. They are modelled on Apify's and Supabase's terms in Nabvy's own wording; their own list of points is added here when they land | `docs/progress.md`, task 4.7 |
| 8 | Data | Using third-party listing data obtained from Apify (Facebook Marketplace listings; Nabvy never deals with Facebook directly), and the LIA and DPIA the actor brief asked for before further collection (gate lifted by the owner) | Precedence row "Legal gates"; `docs/decisions.md`, "Legal gates lifted" |
| 9 | Data | Keeping all actor data unredacted, including seller data, for internal use; the retention period; any notice to sellers | `docs/decisions.md`, "Actor data kept in full"; `docs/questions.md` |
| 10 | Data | Showing listing photos in the app (off until the owner decides) | `docs/decisions.md`, "MVP scope and pipeline runtime" |
| 11 | Data | Photos users upload for scan recognition, and their processing by an AI model | `docs/decisions.md`, "MVP scope and pipeline runtime" |
| 12 | Data | Anti-sharing controls: device, IP and location data, any device identification, internal risk scores | Account-sharing design (in progress) |
| 13 | Wording | "Suspected ..." labels shown to users; the brief asks for legal review before launch | Precedence row "Labels and scores" |
| 14 | Wording | Asking-price position and "Estimates, not advice" wording | Precedence row "Price wording"; `docs/web-app.md` |
| 15 | Resale | Sharing listing data with third parties through export, feeds and the public API (gate lifted by the owner) | Precedence row "Resale of listing data"; `docs/decisions.md`, "Legal gates lifted" |
| 16 | Privacy | Privacy notice, cookie and analytics consent (PostHog), sub-processor list, ICO registration | `docs/compliance.md` |
| 17 | Marketing | Affiliate programme terms and ad disclosure; marketing consent | `docs/affiliates.md`; `docs/marketing.md` |
| 18 | Terms | The owner asked to "copy over" Apify's and Supabase's terms. The drafts follow their structure in Nabvy's own wording rather than copying text | Terms drafts (in progress) |
| 19 | Policies | All policies and conduct follow big tech's UK-facing positions (owner's decision). Their terms were written for their own services; whether each position fits Nabvy is for the lawyer | `docs/decisions.md`, "Policies and conduct match big tech" |
| 20 | Data | Pickup addresses and times that users enter for their own route planning (sellers' addresses, entered by the user) | `docs/decisions.md`, "Search, map and pickup features" |
| 21 | Enforcement | Payment-card fingerprints and emails kept to catch ban evasion | `docs/decisions.md`, "Fair use, suspension and bans" |
| 22 | Data | Users' one-tap reports about sellers and listings ("too good to be true"), shared as a mark with other users | `docs/decisions.md`, "Too good to be true" |

Rows 23–83 below come from the five 2026-09-24 design-draft integrations (`docs/design/drafts/{search-map-routes,listing-reuse,too-good-to-be-true,account-sharing,listing-location}.md`), continuing this table's own numbering from row 22. The account-sharing note's placeholder `LR-AS1`–`LR-AS10` IDs are replaced with rows 62–71 below; they are not the same sequence as the `LR-01`–`LR-34` policy-draft markers further down this file.

### search-map-routes

| # | Area | Point to review | Where it is decided |
| --- | --- | --- | --- |
| 23 | Licences | OpenStreetMap data (ODbL) in map tiles and road routing: attribution and share-alike | search-map-routes.md §3.8, §6.6 |
| 24 | Licences | OS Open Names and ONS/OS postcode data under the Open Government Licence and OS OpenData terms: attribution | search-map-routes.md §7.1 |
| 25 | Data | Northern Ireland (BT) postcode data and Land & Property Services licensing | search-map-routes.md §10 row 14 |
| 26 | Licences | PostGIS (GPL-2.0-or-later) in the database platform, against the dependency licence rule | search-map-routes.md §1 |
| 27 | Licences | OpenFreeMap's terms, when used as the fallback | search-map-routes.md §3.8 |
| 28 | Licences | Noto fonts under the SIL Open Font License served as map glyphs | search-map-routes.md §3.8 |
| 29 | Privacy | Where user origins and pickup points are processed: a router VM in Germany, Finland or London, or a hosted routing provider | search-map-routes.md §6.6, §10 rows 1–2 |
| 30 | Data | Storing sellers' addresses and agreed times that users enter, and their retention period | search-map-routes.md §5.3, §5.6, §10 row 15 |
| 31 | Privacy | Handing pickup coordinates to Google Maps, Apple Maps or Waze through links the user taps | search-map-routes.md §6.5 |
| 32 | Privacy | Calendar files containing sellers' addresses, and any subscribable calendar feed | search-map-routes.md §6.5, §10 row 18 |
| 33 | Privacy | Using the browser's current location for distance and for re-planning a route | search-map-routes.md §2.3, §2.7, §6.4 |
| 34 | Data | Showing town-level places and rounded distances for listings, and the trilateration point | search-map-routes.md §2.4, §3.5 |
| 35 | Wording | The wording of "Slightly further away" hints, the "low ask" marker badge and "below the median of N similar asks" | search-map-routes.md §4.4, §10 rows 9–10 |
| 36 | Wording | Showing HMRC rates and the National Living Wage as a basis for a user's trip cost | search-map-routes.md §4.2, §10 rows 7–8 |
| 37 | Licences | Google Maps Platform's restriction on use with non-Google maps, if Google routing is ever chosen | search-map-routes.md §6.2, §10 row 1 |
| 38 | Privacy | Per-user records of visited listings and of hint impressions logged for calibration | search-map-routes.md §7.3, §7.7, §10 row 15 |

### listing-reuse

| # | Area | Point to review | Where it is decided |
| --- | --- | --- | --- |
| 39 | Enforcement | Showing a listing found by one user's hunt to other users, the same data use as any alert (`gem-finder`/`spec-match`, 2026-09-24). | listing-reuse.md |
| 40 | Wording | Wording of "Top pick" and the position line must not imply a valuation, a guarantee or that the item is safe (`gem-finder`, 2026-09-24). | listing-reuse.md |
| 41 | Wording | GPU model and brand names in curated relation labels, nominative trade mark use (`similar-picks`, 2026-09-24). | listing-reuse.md |
| 42 | Data | Description text used for gem checks: only the town or area may reach output, under the existing location-precision rule (`gem-finder`, 2026-09-24). | listing-reuse.md |

### too-good-to-be-true

| # | Area | Point to review | Where it is decided |
| --- | --- | --- | --- |
| 43 | Enforcement | Showing "Suspected too good to be true" with evidence on identifiable listings, and option A against option B wording | Too-good-to-be-true design §4.2, §11 item 1; extends item 13 and LR-02 |
| 44 | Data | Counting users' reports towards a mark other users see, shown as attributed claims ("a buyer who messaged the seller says …") | Too-good-to-be-true design §4.3, §11 item 2; extends item 22 |
| 45 | Data | Storing reports that allege a seller asked for money first or misled buyers, including free-text notes if owner decision 14 allows them; the brief's point on criminal-offence data | Too-good-to-be-true design §3.1, §11 item 3 |
| 46 | Enforcement | Showing a mark automatically, with no human review, once a path is `on` | Too-good-to-be-true design §5.5, §11 item 4 |
| 47 | Enforcement | Silently giving weight 0 to, voiding or holding users' reports, and not telling reporters why | Too-good-to-be-true design §3.2–3.3, §11 item 5 |
| 48 | Data | Answering a seller's or a reporter's request for a copy of personal data where it covers reports | Too-good-to-be-true design §11 item 6; compare LR-32 |
| 49 | Data | The public report-a-mistake form for non-users, including storing and keeping a contact email | Too-good-to-be-true design §4.4, §11 item 7 |
| 50 | Data | Retention of report rows, reporter links, notes and correction requests | Too-good-to-be-true design §6.2, §11 item 8 |
| 51 | Enforcement | Treating linked accounts (email hash, card fingerprint, shared device cookie or network) as one reporter | Too-good-to-be-true design §3.2, §11 item 9; compare LR-33 and item 21 |
| 52 | Enforcement | Account actions for false or abusive reports under the acceptable use policy 9.1–9.2 | Too-good-to-be-true design §7, §11 item 10 |
| 53 | Data | Signposting users to Report Fraud, their bank and Facebook's reporting tools | Too-good-to-be-true design §3.1, §11 item 11 |
| 54 | Enforcement | Stating what a listing's description offers ("postage or courier only", "Facebook delivery") as evidence in a mark | Too-good-to-be-true design §2.2, §11 item 12 |
| 55 | Product | Leaving listings that meet path A, even in shadow, and approved report-path candidates, out of top picks and by-catch suggestions | Too-good-to-be-true design §4.5, §11 item 13 |
| 56 | Data | Handling of reports and correction requests if Irish users are added | Too-good-to-be-true design §11 item 14 |
| 57 | Data | Any future sharing of mark or report data with banks, Meta or the police | Too-good-to-be-true design §7, §11 item 15 |
| 58 | Product | Including or leaving out the mark in Business exports, feeds and the public API | Too-good-to-be-true design §4.5, §11 item 16 |
| 59 | Enforcement | The team's reports about real sellers during the rtx3090 test hunt | Too-good-to-be-true design §5.3, §11 item 17 |
| 60 | Data | A DPIA for any internal seller-level rollup of marks and reports | Too-good-to-be-true design §7, §11 item 18 |
| 61 | Data | Carrying reports across a relist group to the current listing | Too-good-to-be-true design §3.2, §11 item 19 |

### account-sharing

| # | Area | Point to review | Where it is decided |
| --- | --- | --- | --- |
| 62 | Privacy | Recording per-session network hashes, town-level location, user agent and device labels, plus a long-lived recognised-device cookie, to detect sharing. | `docs/design/drafts/account-sharing.md` §6.1, 3d |
| 63 | Privacy | Browser fingerprinting (not in v1) and its default vendor telemetry, if D16 is ever taken up. | `docs/design/drafts/account-sharing.md` §6.3, 4 |
| 64 | Privacy | Per-user signed alert links that log opens, including opens by people who are not Nabvy users. | `docs/design/drafts/account-sharing.md` §6.4, 3c |
| 65 | Enforcement | Internal risk scores and signals kept about users, and automatic, autonomous re-verification, limits, suspensions and bans based on them. | `docs/design/drafts/account-sharing.md` §6.6–6.8, 3d–3e |
| 66 | Enforcement | Ban-evasion keys: hashes of email, card fingerprint, device key and Telegram chat/user ID of banned accounts. | `docs/design/drafts/account-sharing.md` §6.17, 3d |
| 67 | Privacy | Sending Telegram alerts with `protect_content` and reading Telegram/Discord member counts for channel feeds. | `docs/design/drafts/account-sharing.md` §6.19, 3c |
| 68 | Data | Retention periods for session events, link opens, signals, scores, actions and evasion keys. | `docs/design/drafts/account-sharing.md` §6.24, 5.1 |
| 69 | Product | A paid extra seat as the sanctioned route for account sharing. | `docs/design/drafts/account-sharing.md` §6.25, 3f |
| 70 | Data | One free trial per card fingerprint, normalised email and device, ending a repeat trial at once and charging the first month. | `docs/design/drafts/account-sharing.md` §6.41, D22 |
| 71 | Data | Processors newly handling this data: Vercel (geolocation headers), Cloudflare, Telegram. | `docs/design/drafts/account-sharing.md` §6.22 |

### listing-location

| # | Area | Point to review | Where it is decided |
| --- | --- | --- | --- |
| 72 | Data | Storing, internally, full postcodes, street names and business premises found in listing text, including sole traders' premises | `docs/design/listing-location.md` (from `drafts/listing-location.md` §7.1, §12 item 1) |
| 73 | Data | Showing users a town, area or postcode district taken from a listing's description (for example "E1") | `docs/design/listing-location.md` (§12 item 2) |
| 74 | Wording | Showing a "Location differs" fact about an identifiable listing, and using it as evidence for "too good to be true" | `docs/design/listing-location.md` (§12 item 3) |
| 75 | Data | Keeping Facebook's grid-snapped coordinates internally, and reverse-geocoding them to an area shown to users | `docs/design/listing-location.md` (§12 item 4) |
| 76 | Data | Distances and radius filters as a possible way to infer a seller's location, mitigated by measuring from the displayed area | `docs/design/listing-location.md` (§12 item 5) |
| 77 | Licensing | Commercial use of Northern Ireland (BT) postcode data, which needs a Land & Property Services licence | `docs/design/listing-location.md` (§12 item 6) |
| 78 | Licensing | Open Government Licence attribution for OS, Royal Mail, ONS, NRS and OSNI data, and CC BY 4.0 attribution for GeoNames if it is ever used | `docs/design/listing-location.md` (§12 item 7) |
| 79 | Data | Sending redacted listing text to the AI provider to resolve pickup locations, and the processor agreement and transfer cover this needs | `docs/design/listing-location.md` (§12 item 8) |
| 80 | Data | A seller-level location analysis in a restricted view, if one is ever built | `docs/design/listing-location.md` (§12 item 9) |
| 81 | Data | Showing the seller's area as a read-only hint beside a user's private pickup entries in the route planner | `docs/design/listing-location.md` (§12 item 10) |
| 82 | Data | Masking postcodes and addresses in description text shown to users, and the gaps found in the gateway's fixture redaction | `docs/design/listing-location.md` (§12 item 11) |
| 83 | Licensing | PostGIS (GPL-2.0-or-later) used as a managed database extension, outside the permissive licence list in `CLAUDE.md` | `docs/design/listing-location.md` (§12 item 12) |

### actor-app-guide

| # | Area | Point to review | Where it is decided |
| --- | --- | --- | --- |
| 84 | Wording | `fb-scrap-engine/docs/design/COPY_ADVERT_SPAM.md`'s new "Suspected trade seller" and shadow-only "Suspected scam" labels, their fact templates, and criminal-offence-data treatment for scam labels under UK GDPR Art 10 | `docs/design/actor-app-guide.md`, "What changes" 11; extends item 13 |

## Points in the policy drafts

The drafts in `docs/policies/` (terms, no-refunds and cancellation, acceptable use, fair use) carry `TODO-LEGAL (LR-nn)` markers. They are modelled on big tech's UK-facing terms and on Apify's and Supabase's, in Nabvy's own words (`docs/policies/SOURCES.md`). These lines extend item 7 above; no review has been run.

| ID | Document | Clause | Question |
| --- | --- | --- | --- |
| LR-01 | terms.md | 1.1 Who we are | Which entity details and other information must the terms show, and where? |
| LR-02 | terms.md | 2.5 Labels; 11.2 Reports and feedback | Is the description of "Suspected ..." and "Too good to be true" labels, and of user reports counting towards them, suitable? |
| LR-03 | terms.md | 2.7 Estimates, not advice | Is the "not advice, not a party to the sale" wording suitable? |
| LR-04 | terms.md | 2.9 Changes to the service | Are the reasons, the 30-day notice and the right to cancel suitable for changes that reduce a paid service? |
| LR-05 | terms.md | 3.6 and 14.6 Business use | Which users count as business users, and are the business-only exclusions, cap (£[AMOUNT]) and misuse cover suitable? |
| LR-06 | terms.md 4.3, 5.2; refunds-and-cancellation.md 4, 5 | Trial, renewal and reminders | Are the trial conversion wording, the timing and content of the trial and annual-renewal reminders, and "one trial per person" suitable? |
| LR-07 | terms.md | 4.7 Price changes | Are 30 days' notice for subscriptions, 14 days for usage prices and immediate tax changes suitable? |
| LR-08 | terms.md 6.3; refunds-and-cancellation.md 3 | 14-day cancellation right | Is the wording on starting straight away and the 14-day right suitable, and what must Checkout record? |
| LR-09 | terms.md 6.1, 6.4, 14.1; refunds-and-cancellation.md 2 | No refunds | Is "non-refundable, except where required by law" with "legal rights unaffected" suitable for each item listed? |
| LR-10 | terms.md | 7.5 Deleting your account | Can remaining paid time and usage be lost when a user deletes their account? |
| LR-11 | terms.md 9.4; acceptable-use.md 2.3 | Use and resale of Nabvy data | Are the personal-use permission and the Business exports, feeds and API terms suitable? |
| LR-12 | terms.md 10.1, 10.2; fair-use.md 5 | Grounds for suspension and bans | Are "at our discretion", the listed grounds and banning without warning suitable? |
| LR-13 | terms.md 10.3; fair-use.md 6 | Automatic enforcement and notice | Are automated decisions, no warning, a short notice and "no reasons" suitable? |
| LR-14 | terms.md | 10.4 Review of a decision | Are the review route, the window, one review per decision and outcomes without reasons suitable? |
| LR-15 | terms.md 10.5; fair-use.md 10; refunds-and-cancellation.md 10.1 | Billing during restriction or suspension | Can the subscription continue without refund or credit during a restriction or suspension? |
| LR-16 | terms.md 10.6; refunds-and-cancellation.md 10.2 | No refund on a ban | Can the unused subscription, an annual plan and purchased usage be kept on a ban? |
| LR-17 | terms.md | 10.7 No new accounts after a ban | Are the new-account bar, closing linked accounts without notice, refusal of service and keeping email and card data suitable? |
| LR-18 | terms.md 12.3; refunds-and-cancellation.md 9.1 | Ending a service for other reasons | Are the notice, the pro-rata refund and pausing without notice when a source stops suitable? |
| LR-19 | terms.md | 14.5 Business losses | Can lost resale profit be excluded for consumers who resell? |
| LR-20 | terms.md | 15.2 Changes to the terms | Are the notice period and timing for changes suitable? |
| LR-21 | terms.md | 16 Complaints | Must an alternative dispute resolution body be named, and are the response times suitable? |
| LR-22 | terms.md | 17.2 Requests from sellers | Is the seller removal and objection route suitable? |
| LR-23 | terms.md | 18 Law and courts | Is the governing law and courts wording suitable for consumers across the UK and for business users? |
| LR-24 | refunds-and-cancellation.md | 8 Usage balance | Are non-refundable top-ups, monthly expiry of included usage and loss of the balance on closure suitable? |
| LR-25 | refunds-and-cancellation.md | 11 Payment disputes and chargebacks | Is treating a dispute as a cancellation, reversing credits, and chargeback abuse as a ground for a ban suitable? |
| LR-26 | acceptable-use.md | 11 Similar conduct | Is the "similar conduct" catch-all suitable? |
| LR-27 | acceptable-use.md | 12.5 Reporting to the authorities | Is the wording on reporting to and sharing information with authorities suitable? |
| LR-28 | fair-use.md | 4 Excessive or abusive use | Are the examples suitable, including use within plan limits that counts as excessive? |
| LR-29 | fair-use.md | 11 Changes to the limits | Are the notice for lowering limits and immediate urgent changes suitable? |
| LR-30 | terms.md | 3.5 Staff access | Is the description of staff access to accounts and data suitable? |
| LR-31 | terms.md | 2.2 Where listings come from | Is the description of the listing source and the third-party provider suitable? |
| LR-32 | terms.md 10.3, 10.8; fair-use.md 6.3 | No reasons and requests for a copy of personal data | How are requests for a copy of personal data answered where they cover enforcement reasons, evidence, signals or scores? |
| LR-33 | acceptable-use.md 5.3; fair-use.md 3.2 | Linked accounts, devices, VPNs and proxies | Is treating linked accounts as one, and the rule against using devices, VPNs or proxies to hide activity, suitable? |
| LR-34 | fb-scrap-engine `docs/HANDOFF.md` (`d7be0a4`) | UK GDPR basics for the app's own data | Do Nabvy's privacy notice and its deletion and objection request routes cover what the brief now lists? |
- Per-user dynamic prices and targeted offers (`pricing-console`, 2026-09-24).
- 2026-09-24, free tier: a card check that is never charged before the second and third free windows; one card per account; free-tier terms (lifetime cost cap, bursts, reset) shown before sign-up.
- Erasing a user's credit ledger (grants, charges, reversals) within 24 hours of account deletion, while Stripe keeps the payment records (`usage-ledger`, 2026-09-24).
- 2026-09-24, abuse threat model (4.3t): keeping hashed trial keys (canonical email, card fingerprint, device) after account deletion, to stop rejoining for a fresh free tier.
- 2026-09-24, Stripe (4.10c): a legally required refund of a VAT-inclusive payment issued with a credit note, and what the invoice and credit note must show; keeping `billing_events` (the Checkout consent and payment signals) after account deletion for chargebacks and tax records; enabling a Stripe Connect platform, which changes the account's obligations, before any payee exists.
- 2026-09-25, pickup-location (w2): storing full postcodes and street text found in descriptions internally (`pickup_location.candidates.value`); showing users a pickup area derived from the description rather than the seller's chosen field; using a location conflict between field and text as an input to a "too good to be true" mark.
- 2026-09-25, prepared-message (w2): offering users a pre-written message to send to private sellers, and showing redacted quotes from the listing in its checklist.
