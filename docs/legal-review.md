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
