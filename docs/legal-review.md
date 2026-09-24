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
| 8 | Data | Using Facebook Marketplace listings collected through Apify (database right, copyright, the platform's terms), and the LIA and DPIA the actor brief asked for before further collection (gate lifted by the owner) | Precedence row "Legal gates"; `docs/decisions.md`, "Legal gates lifted" |
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
