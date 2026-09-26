# Open questions

Resolved questions moved to `docs/questions-archive.md`. These remain genuinely open, awaiting an owner decision, confirmation, or account/secret setup.

- **2026-09-24, 1.1: route-health and listings without a description.** The actor's `app/route-health.js` (to be ported) and its in-run breaker count a reply for a listing with no description as a failed replay. Fed the actor's own 1.0.82 live check (47 of 50 replays, 3 without a description), one run switches the region to the dearer page route with an alert (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:237,241-243; fb-scrap-engine/app/route-health.js:13-14,54; `docs/fb-actor-reference.md` §12). Options: subtract `failures["description-missing"]` from attempts in Nabvy's port, or batch IDs by category. Option taken for now: port the helper unchanged with its tests (matching the actor's tested behaviour), then make the subtraction a separate, tested change once the owner agrees. It is recommended, because a missing description is a listing property, not a route failure.



- **2026-09-24, 0.5: CI steps that need accounts or later tasks.** `docs/operations.md` also asks for a migration dry-run against a Supabase branch, a Vercel preview, the fixture pass-rate check and deploys on merge. Option taken: CI dry-runs the migrations on a throwaway Postgres 17 instead (stand-ins for Supabase roles and `pg_net`), and the rest waits for its task: fixtures (0.6), Vercel (0.5a), deploys (0.3, 1.2, 0.5a). A real Supabase-branch dry-run needs the owner to add a `SUPABASE_ACCESS_TOKEN` repository secret; Supabase branches are billed per hour, so that is the owner's call. The gitleaks pre-commit hook in `docs/security.md` is not installed yet; it needs a hook manager as a new dependency.



- **2026-09-24, 0.4: explanation template wording.** `docs/packs/gpu-pc.md` gives two user-facing templates. The bundle one says parts "are worth about £{partOutTotal}", which the brief rules out (no part-out maths yet; asks are never "worth"). The main one says "Similar {product} sold for £{low}–£{high}" and shows "{dealScore}/100", but valuation works from asks while Facebook is the only source, and the brief forbids presenting asks as sale prices or showing an unexplained score (Precedence, "Price wording" and "Labels and scores"). Option taken: the bundle template is left out; the main template drops the "sold for" sentence and the score, and the pack marks it `displayable: false`, so nothing shows it to users until the owner approves wording. Conservative because no user sees wording the owner has not approved. Needed from the owner: the explanation wording (asks-based and, later, sale-based), and whether a deal score is shown and how it is explained.



- **2026-09-24, 0.4: `stock_photo` risk rule.** The build pack's rule matches a photo against known stock images or another seller's listing. The second half depends on seller data and becomes the internal `reused_photos` rule. The first half is listing-level, but it needs photo fingerprints, and the Precedence row "Photos" limits photo review to cases where the text is silent (the actor cannot capture photos yet). Option taken: `stock_photo` is `internal` in the gpu-pc pack, with its build-pack weight kept as a shadow weight, so it adds nothing to any public score. Conservative because it shows less. Needed from the owner: whether a stock-image match may count towards a public risk signal once photo review exists.



- **2026-09-24, 0.4: eBay fees in the gpu-pc pack.** `docs/packs/gpu-pc.md` sets `feePct` 0.129 and a 30p fixed fee with the note "confirm against eBay's current UK fee schedule". Option taken: the pack carries those values unchanged; nobody has checked them against eBay's current schedule. Needed: a check against eBay's current UK fees (private and business sellers differ) before valuation shows margins.



- **2026-09-24, 0.4: title gate for gpu-pc.** The build pack's gate excluded "for parts", "spares or repairs", "case only" (via "box only") and accessory words (monitor, chair, desk, mouse, keyboard, headset, controller). Option taken: accessory words and "for parts / spares or repairs" are no longer gate excludes, because they threw out PC bundles sold with peripherals and contradicted the pack's own `parts_only` flag and `faulty` multiplier; "box only / empty box" stays. Wanted adverts are excluded only by a narrow pattern (wanted, looking for, WTB, want to buy, "I buy", "we buy", "I'm buying", "buying your/all/any/broken"); the actor's broader `wantedTitle` (swap, trade, px, part ex, need a, £££) and `laptopTitle` run only as shadow noise rules until fixtures measure their precision. Conservative because nothing destructive runs on an unmeasured pattern. Needed from the owner: confirmation that PC bundles with peripherals and faulty or parts-only items are wanted in the gate.



- **2026-09-24, 1.1a: a divergence from the actor's `route-health.js`.** The actor's helper compares `successRate < minSuccess` with `successRate` possibly `null` (fb-scrap-engine/app/route-health.js:54); in JavaScript `null < 0.95` is true. With a caller option `minAttempts` of 0 or less and no graphql replays (for example an empty history), it switches the region to the dearer page route as `low-success`, with an alert, on no evidence. None of the actor's tests reach this case, and its test that an empty history starts on graphql (fb-scrap-engine/test/route-health.test.js:58-59) points the other way. Option taken: treat it as a bug; Nabvy's port keeps its `successRate !== null` guard, and a pinned test records the difference (`services/source-adapters/README.md`, "Route health"). The defaults (`minAttempts` 50) never reach it, so behaviour matches the actor in every tested case. Conservative because it never switches routes or raises an alert without data. For the actor's owner: fix it upstream, or confirm the intended behaviour.



- **2026-09-24, 4.0 auth: accounts and keys not set yet.** Resend (`RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, with `mail.nabvy.com` verified), Cloudflare Turnstile (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`) and a Google OAuth client (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, with the redirect URI `<BETTER_AUTH_URL>/api/auth/callback/google`) do not exist yet, and `DATABASE_URL_AUTH` needs the `nabvy_auth` login (above). Option taken: the module is built and tested with test doubles (a magic-link sender that records links, a local Turnstile verifier). `createAuthFromEnv` refuses to start without the Resend and Turnstile keys, so production never runs without captcha or email. Google sign-in stays off until both Google variables are set. Conservative because nothing runs unprotected and no account is created on the owner's behalf.



- **2026-09-24, 4.1a: may Facebook listing photos be displayed in the app?** Showing a photo means either hot-linking Facebook's image URLs or serving copies, and the brief says never to serve photos from our own storage (`docs/decisions.md`, Precedence, "Photos"). Option taken: photos sit behind the `listingPhotos` flag in `apps/web/src/lib/flags.ts`, off, and every listing shows a neutral placeholder with the photo count. Conservative because nothing is displayed until the owner decides.



- **2026-09-24, 4.1a: pricing page wording.** Plans, prices and tier wording are the owner's decision, and the tiers in `docs/decisions.md` conflict with the brief on cadence and on charging before legal advice (Precedence, "Cadence and tiers", "Legal gates"). Option taken: `/pricing` is a skeleton with the single line "Plans and prices are to be confirmed." and no plan names, prices or features. Needed from the owner: the plans and the wording to show.



- **2026-09-24, 4.1a: scan screen scope.** Scan mode's on-demand fetch is ruled out for Facebook by the brief ("Never run Facebook fetches or AI per user") and the MVP has no other source. Option taken: `/app/scan` is a skeleton that says "Not available yet." Needed from the owner: whether scan mode is in the public beta, and what it may do.



- **2026-09-24, w1 quote-redaction: mask wording shown to users.** Quotes shown to users replace contact details with placeholders, and the card does not set their wording. Option taken: the placeholders `apify_gateway.redact_text` already uses for fixtures, `[phone redacted]`, `[email redacted]`, `[handle redacted]`, `[link redacted]`, and `PO19 [redacted]` for a postcode's inward half (`services/quote-redaction/README.md`). Conservative because they say only that something was hidden. Needed from the owner: the wording to show, if different.



- **2026-09-24, 0.10 telemetry: floor basis for watching -- standalone or shared cost.** `docs/design/analytics-growth.md` (design section 2, "Per-area profit when one check serves many watchers") notes that one Apify check of an area serves every want watching it, but nothing sums the shared cost yet (`ops-metrics`, a later task). Worked example (illustrative, not a price): the one recorded Apify run ($0.0177, `cost-meter.md:15`) costs a lone 1-minute want $764.64 a month standalone, or $38.23 a month shared across 20 wants at that interval; a standalone floor would refuse fast-check prices already approved, or make them unsellable, while a shared basis is profitable only while the area stays busy. Option taken (the design's own conservative default): `estimate(want)` uses standalone cost, so a want stays profitable even if its area empties; before the floor is switched on, every launch price is checked against it and every refusal goes to the owner, so no approved price is silently blocked; revisit after four weeks of `ops-metrics` data, at which point a shared-cost discount would become a `pricing-console` offer still checked against the floor. Needed from the owner: confirm or override this default once `ops-metrics` and `pricing-console` are built.



- **2026-09-24, 0.10 telemetry: price experiments, parallel tests and holdouts.** `docs/design/analytics-growth.md` (design section 8, point 5) extends `docs/analytics.md:38`'s "one experiment at a time" with pricing specifically: each variant resolves through `pricing-console` before a user sees it. Option taken (the design's own conservative default): one experiment at a time; each approved by the owner in `pricing-console`; every variant resolves on the server to a price at or above the floor, with margin and churn as guardrails; each decision recorded in `docs/decisions.md`; parallel experiments or a 1-10% holdout only if the owner says so. A one-line item is already in `docs/legal-review.md` ("Per-user dynamic prices and targeted offers"). Needed from the owner: confirm or override this default once `pricing-console` exists.



- **2026-09-24, 4.1f: sponsoring OpenFreeMap.** No option recorded; left to the owner's discretion.



- **2026-09-24, 4.1j: hint wording.** "Worth the trip" conflicts with the price-wording rule (never "worth"/"fair"); wording for "deal"/"saving"/"value" beside an ask is undecided. Option taken: "Slightly further away" (working label), "Asking £X below the median of N similar asks", no "deal"/"saving"/"value" until decided. Conservative because it is the most literal, least persuasive phrasing.



- **2026-09-24, 4.1k/4.1e: retention of pickup data and visited-listing records.** No fixed period decided. Option taken (interim): pickups and their route plans deleted 30 days after the day; visited-listing rows after 90 days; both user-deletable any time and purged on account deletion. Conservative because it matches the owner's "big tech" policy stance pending a decision.



- **2026-09-24, 4.1k: pickups encryption key.** A new secret, `PICKUPS_DATA_KEY`, is required and does not yet exist. Option taken: add it to `docs/secrets.md`; the `pickups` module does not ship without it.



- **2026-09-24, all tasks: licences already in the tree outside the allowed list.** `lightningcss` (MPL-2.0), `caniuse-lite` (CC-BY-4.0), `tslib` (0BSD — does 0BSD count as "BSD"?), optional `@img/sharp-libvips-*` (LGPL-3.0-or-later). Option taken: recorded in `licence-exceptions.json` pending the owner's decision; no new package added outside the allowed list meanwhile.



- **2026-09-24, all tasks: module names.** Options: the module-catalogue draft's names, or the build pack's original names. Option taken: catalogue names, pending the owner's approval of the catalogue itself.



- **2026-09-24, 1.6c/1.8c listing-reuse: user-facing wording for gems and alternatives.** The draft proposes concrete copy — badge "Top pick", the position line ("Asking £{ask}. Lower than {share} of {n} similar asks…"), the by-catch bias note, the hunt-page line "While hunting your {product} we also found …", and relation labels ("Same model, Ti version", "One tier up", "PC with this card") — but marks all of it "not shown to users until confirmed". Option taken: `gem-finder` and `similar-picks` ship with this wording behind their module switches (shadow/off), the same pattern as the pricing-page and scan-screen skeletons already in `docs/questions.md`. Conservative because no user sees wording the owner has not approved. Needed from the owner: the badge, position-line, bias-note and relation-label wording.



- **2026-09-24, 1.8c/1.8d listing-reuse: default scope for cross-hunt alternatives and top picks.** The draft sets three product-facing defaults with no sign-off yet: instant alerts for alternatives off (in-app and digest only); PCs shown as alternatives for a card hunt off by default, user-switchable; and top picks shown only to hunts and alternatives-enabled hunts, never to a user with no matching hunt. Option taken: ship the conservative defaults above; nothing new reaches a user who has not opted in. Conservative because visibility can only be widened later, never walked back. Needed from the owner: confirmation of the three defaults, and whether PC-containment or instant-alternative-alerts should default on for any tier.



- **2026-09-24, tgtbt §4.2: label wording.** Three options for the chip/panel text: A "Suspected too good to be true:" (matches `docs/decisions.md:158` as written), B "Too good to be true?" (needs that decision amended), C the same as A but only when the price signal is among the evidence, otherwise "Suspected risky sale:". Option taken: A, shown only in shadow and on founder-only screens until approved. Conservative because it needs no amendment to an existing decision. Needed from the owner: the final wording among A/B/C.



- **2026-09-24, tgtbt §4.3: evidence bullet templates.** The per-signal bullet text, the line under the bullets, and the safety line are drafted but unapproved. Option taken: the drafts, unshown. Conservative because nothing user-facing ships unapproved. Needed from the owner: approve or amend each template.



- **2026-09-24, tgtbt §3.1: report chip wording.** The six report-chip labels, their follow-up questions, the `payment_first` small print, and whether to keep a "Nothing odd" counter-report chip. Option taken: the drafts; include "Nothing odd" (it never lowers a level, and gives the calibration denominator). Conservative because it adds a chip that can only raise scrutiny, never lower it. Needed from the owner: wording approval; also catalogue question 43 (report codes and what counts as an "established" account).



- **2026-09-24, tgtbt §4.6: alerts for marked listings.** Whether a marked listing's alert is (a) sent with the mark shown, (b) sent to the digest only, or (c) held. Option taken: (a), with an opt-in "Don't alert me about suspected listings" off by default. Conservative because `alert-router` already never holds an alert for any other label, and holding it here would let a false report buy a rival buyer time on a bargain. Needed from the owner: confirm or pick (b)/(c).



- **2026-09-24, tgtbt §4.6: follow-up when a mark appears after an alert was sent.** Option taken: no follow-up push; the mark shows on the card, in "Opened listings" and in the alert feed. A removed mark is edited out of sent Telegram alerts. Conservative because it sends fewer messages and pushes no alarm. Needed from the owner: confirm.



- **2026-09-24, tgtbt §4.5: "Hide suspected" filter default.** Option taken: off by default, with a visible count and a "show" link, feed and map only. Conservative because it changes nothing a user sees until they opt in. Needed from the owner: confirm the default.



- **2026-09-24, tgtbt §4.5: promotion gate.** Whether a path-A listing (even in shadow) and an unapproved report-path candidate are kept out of top picks and "while hunting we also found". Option taken: yes for path A always; report-path candidates are excluded only once approved in `reviewed` mode or shown with their path `on`; until then they promote as usual. Conservative because it never demotes a gem on an unreviewed report. Needed from the owner: confirm.



- **2026-09-24, tgtbt §2–§3: starting-value thresholds.** 50 km and 100 km distance cuts, 0.6× median at n≥10 for the price signal, 30-day account age, the report weight formula, rate limits (5/hour, 15/day), burst holds (3/24h; 2/6h on a gem), the 5-minute-to-14-day report window, the 3-reporter minimum before naming a place or payment kind, the 2-minute gem-evaluation wait, the 4-working-hour correction target. Option taken: all as starting values, recalibrated after the rtx3090 shadow run (§5). Conservative because nothing ships until shadow data confirms or revises them. Needed from the owner: none yet; flagged for awareness before go-live.



- **2026-09-24, tgtbt §4.1: the two-independent-pieces rule.** Whether every path must need two independent, non-price-only pieces of evidence, with a single report never marking on its own. Option taken: yes. Conservative because it is the narrowest rule that still catches the owner's two examples. Needed from the owner: confirm the rule stands as policy, not just as a starting design choice.



- **2026-09-24, tgtbt §3.2: paying status and report weight.** Whether a paying (subscribed) user's report should carry more weight. Option taken: no; only card fingerprints, device cookies and shared networks link one person across several accounts, never payment status. Conservative because money must not buy influence over a warning. Needed from the owner: confirm.



- **2026-09-24, tgtbt §3.3: report-then-buy.** Whether a report whose author later marks the same listing "bought" should lose its weight without penalising the reporter. Option taken: yes; the report's weight is removed and its outcome set to `unknown`, never `not_upheld`; the `item` family is exempt. Conservative because it only stops a report from counting, never marks the reporter dishonest. Needed from the owner: confirm.



- **2026-09-24, tgtbt §5.5: staged go-live.** Whether each path moves `shadow → reviewed → on` only against the §5.4–5.5 precision and false-mark targets, with automatic demotion below 80% precision. Option taken: yes. Conservative because nothing goes live without measured precision. Needed from the owner: confirm the gate criteria as written.



- **2026-09-24, tgtbt §5.5: legal review before go-live.** Whether flipping a path to `reviewed` or `on` must wait for a lawyer's review of the wording (legal items 13, 22, LR-02, and the new items below). Option taken: the owner decides per path when flipping it; a review runs only if the owner requests one (`docs/decisions.md:188`). Conservative because it adds no review nobody asked for, but also promises none. Needed from the owner: confirm.



- **2026-09-24, tgtbt §6.2: replacing the `seller-reply-reports` placeholder, and free text on the `other` report reason.** Option taken: this design replaces the placeholder card in full; the `other` reason saves with no free text, as the placeholder already said, until the owner decides. Conservative because it keeps less than the alternative (up to 280 characters, links refused). Needed from the owner: confirm the replacement; decide whether `other` ever carries free text.



- **2026-09-24, tgtbt §6.2: retention.** Reports, reporter links and correction requests. Option taken: the reporter link and note are kept while the listing is live and 90 days after it closes, then only an anonymous contribution is kept; account deletion purges the reporter link, notes and stats within 24 hours; contact emails on the public form are deleted 30 days after closing; request records are kept 12 months. Conservative because it keeps the least data that still lets a shown mark be explained if questioned. Needed from the owner: confirm.



- **2026-09-24, tgtbt §5.3: the team's own reports during the rtx3090 test hunt.** Option taken: team members report only what a seller genuinely told them as a real buyer; no scripted or pretend messaging, no TSB-style probe. Conservative because Nabvy never contacts sellers as a matter of policy (`docs/compliance.md:36`), and this keeps the team to the same rule. Needed from the owner: confirm.



- **2026-09-24, tgtbt §5.3: the owner's two real example listings.** Whether they can be used as labelled fixtures. Option taken: ask the owner for the listing links; until then all positive test cases are synthetic, marked as such, and never counted in calibration. Needed from the owner: the two listing links, if still findable.



- **2026-09-24, tgtbt §4.5: the mark in Business exports, feeds and the public API.** Option taken: left out by default. Conservative because it is easier to add a signal to an external feed later than to withdraw one already shipped. Needed from the owner: confirm.



- **2026-09-24, tgtbt §7: an internal seller-level rollup for review priority.** Whether shown marks and upheld reports may ever be rolled up per internal seller key, for review-queue priority only, never for any user-facing output. Option taken: not built; it needs `seller-key` (question 9) and the owner's answer to catalogue question 38 first. Conservative because it adds no new use of seller data before the owner approves one. Needed from the owner: confirm whether to build it at all.



- **2026-09-24, tgtbt §3.1: post-report signposting text.** The neutral box shown after a `payment_first` or `link_or_fb_delivery` report (don't pay before you see the item, keep to Facebook's messages, report to Facebook too, contact your bank and Report Fraud if money was already sent). Option taken: shown, in the owner's wording, once the primary source pages (reportfraud.police.uk etc.) are checked. Needed from the owner: wording approval.



- **2026-09-24, tgtbt §3.4: push notification on report status change.** Option taken: none; the status shows in "Your reports" in-app only. Conservative because it sends fewer messages. Needed from the owner: confirm.



- **2026-09-24, tgtbt §7: excluding marked listings from the asking-price index.** Option taken: no in version 1; excluding them would feed the mark back into its own price input. Needed from the owner: revisit after the first calibration round.



- **2026-09-24, tgtbt §3.2: carrying reports across a relist.** Whether a counted report should carry to a re-posted listing in the same `relist-merge` group (matching description) for 30 days. Option taken: carried reports are not shown and complete no path, following `docs/decisions.md:14`; they only raise the new listing's place in the review queue. Conservative because it never shows a user "relisted" or "seen before" text the brief rules out. Needed from the owner: confirm.



- **2026-09-24, tgtbt §4.1: rule B-P (a report plus the low price alone).** Two critics disagreed: one wanted it to never mark (every bargain has a low price, and a bargain is exactly what a rival buyer targets), the other wanted it shown after review. Option taken: shown only after a reviewer approves it, only alongside a supporting signal (W1–W4) and the §5.5 report-path checks, and this rule never moves to automatic (`on`). Needed from the owner: confirm, or take the stricter alternative — review queue only, never shown to any user.



- **2026-09-24, tgtbt §2.2: pooling condition groups for the price signal.** When a listing's own condition group has fewer than 10 comparable asks, whether to compute the price signal against the pooled "used" groups at n≥10 instead, worded "the same model, used". Option taken: no; `docs/decisions.md:15` says "same spec and condition", so the signal stays `unknown` below n=10 in its own group. Needed from the owner: confirm.



- **2026-09-24, tgtbt §6.6: report publishing cadence.** Whether report-driven evidence changes publish in two fixed daily batches (07:00 and 19:00 UK time) so a mark's timing cannot point to the one buyer who just messaged. Option taken: yes; listing-signal changes and all removals stay immediate. Conservative because it protects a reporter's anonymity at the cost of a same-day delay, never longer. Needed from the owner: confirm.



- **2026-09-24, 4.3c–4.3o account-integrity: device model and caps.** The draft proposes one live screen per account plus a signed-in device cap (2 Free/Standard, 3 Pro/Business) with a picker, instead of the owner's original "sign out everywhere but one." Option taken: build the cap-plus-lease model (`account-sharing.md`); ship with a conservative cap of 2 on every plan until the owner sets D2's per-plan numbers. Conservative because it never lets more devices through than the tightest plan needs, and a later increase costs nothing a decrease would.



- **2026-09-24, 4.3m subscriptions: paid extra seat ("Duo").** The draft designs a second paid seat per account but sets no name or price (D5). Option taken: leave 4.3m blocked and unscheduled; no seat is sold at launch. Conservative because it adds no priced feature without the owner.



- **2026-09-24, 4.3f account: Telegram re-link allowance.** The draft suggests 2 re-links/30 days on Free, 3 on paid plans (D6), as a threshold a user could hit. Option taken: use the draft's numbers as the shadow-mode starting values only; nothing blocks a re-link until the owner confirms them. Conservative because a wrong cap only shows in metrics, never refuses a real user during shadow.



- **2026-09-24, 4.3j account-integrity: ladder timings.** L2's 7-day limit, L3's 7-then-30-day suspension, the 180-day repeat-ban window and the 90-day clean reset (D19) are all lengths a limited or suspended user would notice. Option taken: implement the state machine with these as configured, overridable constants in `@nabvy/config`, and keep every step in `shadow` (recording only) until the owner approves the lengths. Conservative because no real account is limited or suspended on an unapproved timer.



- **2026-09-24, 4.3o subscriptions: free-trial eligibility rule.** The draft ends a repeat trial (same card, email or device) at once and charges the first month (D22). Option taken: implement `checkTrialKeys()` and wire it into the subscription-created hook, but keep it in an "allow and log" mode until the owner confirms charging a card without a fresh trial notice is acceptable. Conservative because no card is charged unexpectedly before the owner signs off.



- **2026-09-24, listing-location: where gazetteer/data-source attribution appears.** Option taken: an in-app "Data sources" page, linked from the map footer. Conservative because it satisfies OGL/CC BY attribution requirements with least clutter, pending the owner's placement preference.



- **2026-09-24, 0.10 telemetry: no key for local feature-flag evaluation.** `docs/design/analytics-growth.md:143` has server capture "evaluate flags locally", which needs a PostHog personal API key (or a feature-flags secure key) passed as `personalApiKey`, with `onlyEvaluateLocally: true`. No such key is listed in `docs/secrets.md`, and creating one is the owner's account to make, not a value to invent. Option taken (conservative): `isFeatureEnabled()` takes `hasConsent` and returns `undefined` without it, the same gate as `capture()`; with consent, it still calls PostHog's remote `/flags` endpoint with `userId` rather than not evaluating at all. Needed from the owner: create a PostHog personal API key (or feature-flags secure key) and add it to `docs/secrets.md`; once it exists, `createPostHogServer()` can pass it as `personalApiKey` with `onlyEvaluateLocally: true` so a consented check never leaves Nabvy.



- **2026-09-24, w1 apify-gateway: anyone can invoke the Edge Function.** It runs with `verify_jwt` off and takes no instructions, so an outside POST can only make it work through the queue and poll Apify (unchanged from the bootstrap). Now that the watcher invokes it every minute, a shared-secret header sent by `invoke()` and checked by the function would stop outside calls; it needs a second secret beside `APIFY_TOKEN`. Option taken: unchanged until the owner decides.



- **2026-09-24, w1 waitlist: which fields are required.** The module card and `docs/marketing.md` describe the form as capturing email, postcode and wanted products together, but do not say whether postcode or products are mandatory. Option taken: only the email is required; postcode and wanted products are optional (`packages/contracts/src/modules/waitlist.ts`, `WaitlistSubmitInput`). Conservative because it asks visitors for the least data needed to join the list. Needed from the owner: whether the public form should require postcode and/or products before submitting.



- **2026-09-24, w1 waitlist: repeat sign-ups.** Task 0.5a's "Done" only requires that a repeat sign-up with the same address writes one row; it does not say whether a second submission should update the stored postcode, products or UTM. Option taken: the first entry is kept as-is; `submit()` upserts on email with `on conflict do nothing`, so a later submission's different postcode or UTM is discarded (`services/waitlist/src/repo/index.ts`). Conservative because it never silently overwrites data already stored for that address. Needed from the owner: whether a repeat visit should instead refresh the entry's attribution (last-touch) or merge wanted products.



- **2026-09-24, w1 waitlist: submission rate limit.** `docs/engineering.md`, "Rate limits and abuse" lists numbers for sign-up, magic-link, scan, hunt and feedback endpoints, but not for the public waitlist form. Option taken: 5 submissions per hour per IP, the same as `rateLimits.signUpPerIp` (`packages/config/src/modules/waitlist.ts`, `WAITLIST_SUBMIT_PER_IP`), the closest documented limit for an unauthenticated public endpoint. Conservative because it is the tightest of the documented public-endpoint limits. Needed from the owner: a confirmed number if this should differ.



- **2026-09-24, w1 waitlist: sending interface.** No email is sent yet: the owner's email and DNS accounts (Resend, Cloudflare) do not exist. Option taken: a `WaitlistSender` interface (`send(entry): Promise<void>`) with one implementation, `InMemoryWaitlistSender`, which only records what it is asked to send; `submit()` does not call it (module card, "Outputs": none beyond its view). Conservative because it sends nothing and adds no dependency on an unbuilt provider, while leaving the shape a later task fills in with a real sender (Resend, say) without changing `submit()`'s signature. Needed from the owner: which task wires in real sending, and what a confirmation email should say.



- **2026-09-24, w1 waitlist: submission-attempts pruning.** Reviewer of PR #31 flagged that `waitlist.submission_attempts` (the per-IP rate-limit counter) grows by one row forever and has no pruning. Option taken: none built in this task; the table is small (one row per distinct IP address that has ever submitted) and pruning is an operational job (a `pg_cron` sweep, say) outside this module's scope. Conservative because it changes no shared scheduling infrastructure. Needed from the coordinator or owner: whether to add a pruning job now or wait until the table's size is measured.



- **2026-09-24, w1 waitlist: IP hash secret.** Reviewer of PR #31 asked for the rate-limit key to be an HMAC of the caller's IP address with a secret, the way `SELLER_HASH_SALT` salts seller IDs, rather than a plain unsalted SHA-256. Option taken: keep the unsalted hash; no such secret is listed in `docs/secrets.md`, and `CLAUDE.md` says to stop and record a missing secret rather than invent one. Conservative because it adds no undocumented secret. Needed from the owner or coordinator: a new secret (for example `WAITLIST_IP_HASH_SECRET`) added to `docs/secrets.md`, after which `services/waitlist/src/repo/index.ts`'s `consumeSubmitQuota` can switch to an HMAC.



- **2026-09-24, w1 account: Telegram re-link plan names and caps.** The card says re-links are "capped per plan", but the `subscriptions` module (task 4.3) has not shipped plan names or tiers yet (`docs/questions.md`, "4.1a: pricing page wording" is still unresolved for the same reason). Option taken: `packages/config/src/modules/account.ts` uses the plan names `docs/billing.md` proposes (`free`, `standard`, `business`) with a conservative starting cap (1 re-link per 30 days on `default`/`free`, 3 on `standard`, 10 on `business`), and `createTelegramLinkCode()` reads the `default` cap only, since this module has no way yet to look up a user's plan (that read would come from `subscriptions`, not built). Needed from the owner: confirmed plan names and per-plan caps once pricing is decided. Conservative because it under-allows rather than over-allows re-links until a real plan lookup exists.



- **2026-09-24, w1 account: refusing new bans while `account` is off goes beyond the card.** Review of PR #33 (finding 9): the card's "when off: no profile changes" doesn't explicitly cover `setStanding()`, but `assertModuleOn()` refuses it like every other write while the switch is off, so an `account-integrity` automated ban or an admin override cannot land while the module is toggled off. Option taken: leave the refusal in place (no admin-write path should silently bypass the module switch) rather than carve out `setStanding()` as an exception; recorded because the card doesn't say either way. Needed from the owner: confirm `setStanding()` should stay behind the switch, or should be exempt like `isActive()`/`v_standing` (rule 11).



- **2026-09-24, w1 account: `exportAccount()` covers only this module's rows.** Review of PR #33 (finding 11): the export carries only profile and channel rows this module owns; hunts, alerts and any other module's data are not included. Option taken: leave the export scoped to this module, matching the card's "no HTTP between modules" and "each module owns its tables" rules — a full account export is necessarily a cross-module task once other modules exist. Needed from the owner or a later task: a `w1 export` (or similar) job that calls every module's own export function and assembles the full archive.



- **2026-09-24, actor app guide: the notified `excludeListingIds` and pasted-link-canonicalisation commits do not appear in the guide as read.** The task's brief said later commits the same afternoon added `excludeListingIds` (up to 50,000 known listing IDs skipped before any detail request, uncharged) and canonicalised pasted Marketplace links. `docs/APP_INTEGRATION_GUIDE.md` was read through the GitHub API (`get_file_contents`, no ref pinned, so HEAD) and gives blob `abac9a8d34c8f1520cf70cff2b762bb5d0055e25`. Neither `excludeListingIds` nor any mention of pasted-link canonicalisation appears anywhere in that text (checked by full read plus a case-insensitive search for `exclude`, `50,000`, `50000`, `pasted`, `canonical`). The only match for "canonical" is an unrelated `canon()` helper in the `gateway-sweeper` Edge Function recipe (`…:554-555`) that canonicalises a run's `INPUT` JSON for idempotent run-adoption after an ambiguous start — a plausible source of the "canonicalised" wording if the notice was paraphrasing that instead of a pasted-link feature. Option taken: do not write a contract entry or a backlog task for `excludeListingIds`; flag it here instead of guessing at its shape (batch size, charge behaviour, field name), per `CLAUDE.md`'s "no invented numbers" and "ask, don't guess". Needed from the coordinator: confirm whether these features landed in a different file or a later commit than the one fetched, are still pending upstream, or the notice's description does not match what actually shipped; then task `check-scheduler`/`details-queue` accordingly.



- **2026-09-24, actor app guide: does `copy-advert` adopt `COPY_ADVERT_SPAM.md`'s tiers wholesale, or treat it as evidence only?** The new document's S1–S4 clustering rule (5+-word title, same price, 3+ towns within 48h, an ask of £0–£10 or 5+ towns for a label; 2+ towns only collapses) differs from `copy-advert.md`'s current pg_trgm ≥0.80 description-similarity threshold, sourced from the older `SELLER_DATA.md:80-81`. The new document also builds trade-seller and scam detection in the same schema and pipeline as copy-clustering, while Nabvy's own module catalogue splits those into `suspected-labels`/`warning-signs`, fed by `copy-advert` only as one signal among several (`actor-integration.md` 1.3). Option taken: neither design is applied; backlog task 1.7k is added to bring the decision back to the owner before `copy-advert.md` is rewritten. Conservative because no threshold or module boundary changes until the owner confirms which document wins.



- **2026-09-24, w1 route-health: listings without a description counted as failed replays.** Unresolved from `docs/questions.md` (dated 2026-09-24, task 1.1): the ported helper counts a reply for a listing with no description as a failed replay, which can switch a region to the dearer `page` route with an alert on otherwise-healthy traffic. Option taken here: port the behaviour unchanged, with a pinned test and fixture case (`description-missing-counts-as-failure`), matching the existing conservative choice; the subtraction fix (`failures['description-missing']`) stays a separate, tested change once the owner agrees.



- **2026-09-24, edge queue: Cloudflare Waiting Room.** The owner asked for sign-ups to be queued by an existing Cloudflare or open-source tool. Waiting Room is a Cloudflare product whose availability depends on the plan (to check on the owner's account when the Cloudflare DNS account for 0.5a exists). Option taken: Turnstile, rate-limiting rules and Bot Fight Mode at the edge (available on every plan), and Nabvy's own admission queue as the authority; Waiting Room added when the plan allows. Conservative because it adds no dependency and no cost. Needed from the owner: the Cloudflare plan, or a go on paying for Waiting Room.



- **2026-09-24, w1 product-events: monthly partition rotation.** `docs/contracts.md:185` partitions `product_events.events` by month, but no `pg_cron` job exists in the repository yet and enabling the extension is a core decision, not one module's. Option taken (PR #42): the access migration creates partitions from one month back to three months ahead of when it is applied (`product_events.ensure_month_partition()`) plus a default partition, so a write is never refused. Needed: a foundation task that enables `pg_cron` and schedules `product_events.ensure_month_partition(current_date + interval '2 months')` monthly (backlog 0.12). Conservative because it never fails a write and adds no core extension on its own initiative.



- **2026-09-24, w1 detail-evidence: listing-ingest and unresolved rows.** A removed ID in a details run returns a row with `directItemUnresolved: true`, no title and no price (`docs/fb-actor-reference.md`). listing-ingest's `readCard` reads it as a card, so a details refresh of a removed listing would set its price to null and its availability to `unknown`, and would change its card hash. This module records such a row as `unresolved` with no version. Option taken: leave listing-ingest unchanged (not this module's files); raised for its owner. Conservative because it changes no other module.



- **2026-09-24, w1 detail-evidence: a second table.** The card lists one table (`evidence`). Option taken: add `fetches`, one row per listing per job, because the detail outcome, attempts, cache status and unresolved fetches belong to a fetch, and an unresolved fetch has no version. `v_outcomes` reads it. Conservative because `evidence` keeps the card's columns and unique key (with `source` added), and nothing is dropped.



- **2026-09-24, 1.2m schedules: no Trigger.dev account or workspace package existed yet.**
  `trigger/README.md` says "no Trigger.dev account exists yet, so nothing here runs live", and
  `trigger/` was not a pnpm workspace member; `pnpm-workspace.yaml` had no entry for it. `docs/backlog.md`'s
  guidance was "pg_cron only if the repository already uses it for another module (grep
  `cron.schedule` under `packages/db/migrations`); otherwise a thin Trigger.dev scheduled task" —
  no `cron.schedule` use exists anywhere in `packages/db/migrations`. Option taken: added `trigger`
  to `pnpm-workspace.yaml`, a minimal `trigger/package.json` (`@nabvy/trigger`) depending on
  `@trigger.dev/sdk` (MIT, 4.6.4) plus the service package its task calls, and the scheduled task
  file as `schedules.task({ id, cron: '*/15 * * * *', run })`. Conservative because it is the
  smallest change that satisfies the explicit "otherwise a Trigger.dev task" instruction without
  inventing the queue/retry/publisher machinery `docs/engineering.md` describes for event tasks —
  that stays task 1.2's job (`trigger/README.md`, `packages/transport/README.md`). The task does
  not run live until the owner's Trigger.dev project exists and is deployed to (task 1.2).



- **2026-09-24, 4.9 usage-ledger: refusal messages.** The card asks for "a clear message" when metered actions are refused, but user-facing wording is not the session's to set. Option taken: short placeholder messages in `USAGE_LEDGER_MESSAGES` (`packages/contracts/src/modules/usage-ledger.ts`), for the owner to replace.



- **2026-09-24, w1 details-queue: `excludeListingIds` is not sent.** The build brief said the actor's `excludeListingIds` input skips known listings uncharged and to use it. Read through the GitHub API at `fb-scrap-engine` HEAD (`abac9a8d`): the input exists only in the public Store edition (`src/public-edition.js`, `PUBLIC_KEYS`, limit 50,000; the edition runs on `UO1yEB9ct9SH6nHZ0`, which Nabvy must never call), and in `src/main.js` it filters *search* rows only, never IDs passed in `listingIds` (`directItemIds` are always kept). A details run sends only `listingIds`, so the input would save nothing; and the pinned private build's v3 contract rejects unknown keys with a charged `FAILED` run (`docs/design/actor-app-guide.md`, "Contracts"). Option taken (conservative): never send it; the queue's own deduplication does the same job for detail fetches (a fetched listing is re-sent only on a caller's refresh). Question: should `check-scheduler`'s search runs use it once the private actor declares it? That belongs to `check-scheduler`, not this module.



- **2026-09-24, w1 details-queue: consuming `listing-ingest.first-seen` before `details-selector` exists.** The card says the queue "does not choose which new listings need details" (`details-selector`, task 1.4b, wave 6); the build brief says this module consumes `first-seen`. Option taken: the handler queues every listing first seen on a hunt's search card (search runs exist only for users' active hunts and the rtx3090 test hunt, so nothing is fetched that no hunt asked for), newest-check follow-ups before sweep follow-ups, without `details-selector`'s area and category filter. Spend stays bounded by the daily cap, the spend throttle and the gateway's $150 cap. Listings first seen through a details run, or already described by their own search run, are not fetched. Question: when `details-selector` lands, should this handler be removed (it then calls `enqueue()` itself), or should the queue keep consuming `first-seen` and `details-selector` only filter?



- **2026-09-24, w1 details-queue: daily cap of 1,000 IDs.** The card defers work "past a daily cap" but gives no figure. Option taken: 1,000 IDs a London day, about $28 a month on graphql and $50 on page at the guide's settled per-listing costs, a third of the $150 monthly Apify cap (`packages/config/src/modules/details-queue.ts`). Conservative because it leaves most of the budget to searches, and deferred work is visible and sent the next day, never dropped. Question for the owner: the right daily figure once real hunt volumes are known.



- **2026-09-24, w1 details-queue: what each throttle level holds.** `spend-governor` publishes `none | slow-free | slow-paid | slow-sweeps | hold-new`. Option taken: `hold-new` sends nothing; `slow-paid` and `slow-sweeps` hold sweep follow-ups (the lowest priority) and send the rest; lower levels send everything. Conservative because every detail fetch is paid and the most urgent work (new listings from frequent checks, shortlisted refreshes) keeps flowing until the governor holds everything. Question: should `slow-paid` hold more (for example photo captures too)?



- **2026-09-24, w1 marketing-consent: `canMarket()`'s signature needs the target email, not just the userId.** The module card gives `canMarket(userId, category)`, but the card's own acceptance test is "a suppressed address is never sent to" (`docs/modules.md:107`), and `email_suppressions` is keyed by email hash, never by `userId` — nothing in `auth` or `account` exposes a user's email address to another module (`services/auth/README.md`'s "Views" section: "None. Nothing outside this module reads the auth tables."). Option taken: `canMarket(q, { userId, email, category })` takes the address the caller is about to send to (which any real send path already has in hand) and hashes it internally for the suppression check, rather than inventing a new cross-module read of a user's email. Conservative because it adds no new surface to `auth` or `account`, and a caller that skips the email simply cannot call this function — the fixture stage `can-market` pins `suppressed-address-never-sent` as the module's core case. Needed from a human: confirm this signature (or an alternative: a future `auth` export resolving `userId → email`) before `lifecycle-messaging` (task 4.6b) is built against it.



- **2026-09-24, w1 marketing-consent: `canMarket()` also checks account standing, beyond the card's literal wording.** Rule 12 of `docs/design/modules/_rules.md` ("every signed-in procedure and every job that acts for a user first checks the account's standing... through `account`") is not spelled out on this module's own card, but sending marketing to a banned or suspended account is exactly the kind of "acting for a user" the rule means. Option taken: `canMarket()` calls `@nabvy/account`'s `isActive()` (itself a one-line delegate to `@nabvy/auth`) and fails closed if the account is not active, alongside the switch and suppression checks; this is why the card's "Depends on: switches, auth, account" line makes sense even though the card's own "Outputs" line names only `canMarket()`. Nothing in this module re-derives standing: it reads `account`'s existing function, the same "exactly one implementation" reasoning `services/account/README.md` uses for its own delegation to `auth`. Needed from a human: confirm a banned/suspended account should be blocked from marketing (as distinct from service messages, which never call `canMarket()` at all).



- **2026-09-24, w1 marketing-consent: `email_suppressions` and `newsletter_subscribers` store only a hash, matching `docs/marketing.md`'s own table shapes, so this module holds no mailing list to read addresses back out of.** `docs/marketing.md`'s "Tables" section lists both tables as "email hash" columns (unlike `waitlist.entries`, which stores the plain address). Read literally, that means the actual list of addresses to send a newsletter to is not recoverable from this module's own tables. Option taken: treat this module as the consent/suppression record only; the real send list is assumed to live in the sending provider's own audience (Resend's contact list), synced separately once that account exists (`services/marketing-consent/README.md`, "Decisions"). Needed from a human: confirm this reading, or that the newsletter table should instead store the plain address (a change to `docs/marketing.md`'s own spec, not something this session should make unasked).



- **2026-09-24, w1 marketing-consent: the Resend/PostHog webhook payload shape is this module's own normalised contract, not either provider's real wire format.** Neither account exists yet (this session's brief), and no apps/web webhook route exists to translate a provider's payload. Option taken: `MarketingConsentSuppressionEvent` (`{ email, reason, source }`) is the boundary a future webhook route adapts each provider's own payload to before calling `recordSuppression()`; `SuppressionSyncClient` is the seam a later session wires to the real Resend and PostHog APIs, with `InMemorySuppressionSyncClient` as the only implementation today (this session's brief). Needed from a human or a later module session: the real Resend and PostHog webhook signature verification and payload parsing, once those accounts exist.



- **2026-09-24, 4.3t: the free pool against the monthly Apify cap.** The pool's floor of £20 a day is about £600 a month; the gateway's hard cap is $150 (about £120) a month for all users. Option taken (G7, 1.2t): until the owner sets it, the free pool's monthly ceiling is half the provider monthly cap, and a day's pool is the smaller of £20 and what remains of that ceiling. Conservative because paid watchers keep at least half the month's provider budget. Owner, 2026-09-24: the free tier is limited; paid users may sign up and upgrade at any time. That confirms the direction; the ceiling's share is still open.



- **2026-09-24, w1 parts-rules: re-running after a catalogue change.** A run is keyed on listing, evidence hash and rule version; the rule version follows the patterns, the thresholds, this module's rules and the negative contexts in force, not the catalogue's aliases. When product-catalogue adds an alias (for example the Ryzen 7 7700X, today `cpu:unresolved`), stored runs keep their null catalogue IDs until the listing's text changes. Option taken: do not consume `product-catalogue.updated` in this build; the unresolved hits stay listed as gaps, so the model pass still sees them. The alternative is a re-run of the listings whose unresolved quotes the update's aliases now match. Conservative because nothing is re-resolved silently and no stored hit changes under a reader.



- **2026-09-24, 4.10a pricing-console: free-tier numbers not yet set.** The per-user weekly and monthly caps, the weekly and monthly pools and the sign-up limits per IP, device and email domain have no values in the decisions. Option taken: null (not set) in the seeded free-tier row; the reading modules (`spend-governor`, `account-integrity`) apply their own conservative defaults until the owner sets them.



- **2026-09-24, 4.10a pricing-console: a daily cap per free account.** The review of PR #55 cites an owner cap of "£2 a day per free account" (decisions, 17:20/17:25), which is not on `main`'s `docs/decisions.md`. Option taken: a nullable `accountDayCapPence` in the free-tier policy (`v_free_policy.account_day_cap_pence`), seeded null (not set) until the decision is on `main`; the owner sets it with one audited change. Conservative because no number is seeded without a source, and the £2 lifetime cap already bounds each account.



- **2026-09-24, 4.10c: set test-mode keys as environment secrets (owner's item).** None of `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_TOPUP_5|10|25`, `STRIPE_PRICE_EXTRA_AREA` or `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`docs/secrets.md`) is present in this environment. Option taken: the plan and review are docs only; PR #54's synthetic fixtures and the SDK's test signature helper stand in for Stripe. The owner adds test-mode keys as environment secrets (a restricted key for the app; a broader test key, run once by a human, for the setup script in 4.10e) and never pastes a key into a session, a commit or a chat. Conservative because nothing reaches Stripe until then.



- **2026-09-24, 4.10c: Stripe Connect.** The owner listed Connect among the products needed. Nabvy pays nobody through Stripe today: affiliates are paid by Dub Partners on Dub's own Connect platform (`docs/affiliates.md`), and Nabvy never takes payment for a marketplace item. What is Connect wanted for: moving affiliate payouts off Dub onto Nabvy's own platform, a reseller or partner model, or something else? Option taken: nothing designed and Connect left disabled in the dashboard, because enabling a platform changes the account's obligations (listed in `docs/legal-review.md`) and no decision names a payee. Conservative because it adds no obligation before there is a use.



- **2026-09-24, 4.10c: Stripe Tax head office (owner's item).** The test account's Tax settings read `pending` with `head_office` missing (read 20:12 UTC through the Stripe MCP). Option taken: listed here; the owner sets the head office address under Tax settings in the dashboard (test and live), which is also where the UK registration is added when Nabvy registers for VAT. Nothing in code depends on it, but no Checkout with automatic tax completes until it is set.



- **Cadences faster than hourly.** Still open ("Actor guide changes" above).



- **2026-09-24, 4.3af: "production" for the admin fixtures is `NODE_ENV=production`.** H13 wants fixture data never to reach production admin pages. Option taken: a `runtime` group in `@nabvy/config` reads `NODE_ENV` (default `development`), and the two admin reads throw under `production`, which every `next build` and `next start` sets. So an admin at any deployed build, preview included, gets a 500 on `/admin` until task 4.1 puts the procedures behind those reads; only `next dev` and the tests show the fixtures. Conservative because it can never show placeholder spend and runs as real. A `VERCEL_ENV`-based distinction would let previews show fixtures, which is the owner's call.



- **2026-09-24, cadence-slider: pin-price CTA and the help-popover copy are unresolved product wording.** The seven mode names are settled (coordinator, on the owner's delegation, 17:37; `docs/design/cadence-slider.md`): Ultracheck, Rapid, Brisk, Steady (30 min), Regular, Relaxed, Slow Watch, centralised in `apps/web/src/lib/cadence.ts` (`CADENCE_STEPS`) so a later change is a one-file edit. Still provisional: the "Fastest / Slowest" captions, the help-popover sentence (a placeholder was written), and the `Pin this pace — from £X/mo` CTA, which needs a per-user price the estimate procedure doesn't yet return (`WantManagerCadenceEstimate` has no price field) and so was left out of `cadence-slider.tsx` entirely rather than invent a figure — add a priced field to the estimate contract and the CTA together once the owner confirms the copy.



- **2026-09-24, 1.7a: `listing-suppression.changed` carries entry IDs, not listing IDs, so this
  module cannot target only the listings a change touches.** The handler
  (`services/copy-advert/src/handlers/index.ts`, `suppressionChangedHandler`) recomputes every
  currently active cluster's member instead, reading every row of `copy_advert.members` where
  `left_at is null`. Option taken: recompute everything on this event. Conservative because it
  never under-reacts to a suppression change, and correct because copy clusters are expected to be
  rare (design 4.13: "almost absent" for PC and GPU listings), so the set recomputed stays small in
  practice. Needed from the owner or a later session: whether this still holds at production scale,
  or whether `listing-suppression` should be asked to publish the listing IDs an entry resolves to.



- **2026-09-24, 1.7a: candidate detail requests (S4) have no priority below `sweep`.**
  `details-queue`'s four priorities (`new-listing`, `shortlisted`, `photo-capture`, `sweep`) do not
  include one for copy-advert's collision candidates, which the design calls "after sweep
  follow-ups (lowest)" (`docs/design/drafts/copy-advert.md` 4.12). Option taken: use `sweep`, the
  lowest available. Conservative because it never outranks a real acquisition need; it just cannot
  rank below sweep follow-ups as the design intends. Needed: either accept `sweep` or add a fifth
  priority to `details-queue`.



- **2026-09-24, 1.7a: the load test (100,000 synthetic prints, per-batch lookup p95 under 500 ms)
  from `docs/design/drafts/copy-advert.md` section 8 was not run in this task.** This session's
  environment has no long-running Postgres instance to load-test against beyond the throwaway
  database `pnpm db:dry-run` tears down immediately, and generating and loading 100,000 synthetic
  rows was out of scope for one build session's time. Option taken: ship without it, recorded here
  rather than skipped silently. Needed: a follow-up task (or the reviewer, if it has the means) runs
  the load test on a longer-lived database before the module leaves shadow.



- **2026-09-24, 1.7a: `flags` gets a row for every active clustered listing, not only members of a
  mass-posted cluster.** The schema sketch's own comment reads "one per listing in a mass-posted
  cluster" (`docs/design/drafts/copy-advert.md` 5.1), but `v_listing_copy_facts` (needed by every
  internal reader in section 7, for clusters that are not mass-posted too, for example a same-town
  relist collapse) has no other backing table. Option taken: `flags` backs `v_listing_copy_facts`
  for every active member of every active cluster; `would_show` alone (mass-posted and
  `towns >= flagMinTowns`) still decides what a user could ever be shown. Conservative because it
  changes no user-facing behaviour, only which listings appear in the internal view. Needed: the
  design confirms or adjusts this reading, since it is a scaffold-figure interpretation and not the
  actual open question.



- **2026-09-24, w4 lifecycle-messaging: "abandoned checkout", "failed payment" and "affiliate onboarding" need events that do not exist yet.** The module card's "Sources" line cites `docs/marketing.md:18-35`, the full 12-row "Lifecycle programmes" table, but three of those rows' trigger, exit or goal events are not in `ProductEventsName` (`packages/contracts/src/modules/product-events.ts`): "Abandoned checkout" needs `checkout_started`; "Failed payment" needs a Stripe `invoice.payment_failed`/`invoice.paid` event (the table's own words, not a name already on the list); "Affiliate onboarding" needs a Dub webhook event. Rule 2 of `docs/design/modules/_rules.md` ("a module session touches only its own files") means this session cannot add those events to `product-events`'s own contract file. Option taken: build the other seven programmes (`abandoned-onboarding`, `channel-not-linked`, `activation`, `cap-reached`, `trial`, `win-back`, `re-engagement`) against the events that already exist; skip these three rather than inventing events in a file this module does not own. Conservative because it adds no surface to another module's contract without that module's own session reviewing it. Needed from a human or the `product-events` module's own future session: add `checkout_started`, an `invoice.payment_failed`/`invoice.paid` pair and a Dub-approval event to `ProductEventsEvent`, at which point this module's `PROGRAMMES` catalogue (`src/domain/programmes.ts`) can add the matching three programmes without touching anything else.



- **2026-09-24, w4 lifecycle-messaging: email resolution has no source.** This module needs a user's email address both to call `canMarket()` and to actually send (`ResendClient.send()`), but none of the modules this card depends on (`switches`, `product-events`, `marketing-consent`, `account`) exposes one — `account.v_profiles` carries `display_name` only, and `services/marketing-consent/README.md` already records the identical gap for its own `canMarket()` signature. Option taken: `EmailResolver` (`src/send-clients.ts`) is the seam a real implementation fills once one exists (an `auth`-backed lookup, most likely); `InMemoryEmailResolver` is the only implementation today, and a user it cannot resolve is skipped (no `programme_runs` row written, so the step is retried on the next run) rather than guessed at. Conservative because it never invents an email or bypasses `canMarket()`'s suppression check. Needed from a human or a later module session: expose a `userId → email` read (most naturally from `auth`, which already owns `better_auth.user.email`) that `EmailResolver`'s real implementation can call.



- **2026-09-24, w4 lifecycle-messaging: a real deal card needs `alerts`/`valuations`, outside this module's declared inputs.** `docs/marketing.md`'s own wording for "Activation" ("the three best deals found, with margins") and "Abandoned onboarding" ("a real deal card from your area") describes content this module cannot build from `v_events`, `v_profiles` and `canMarket()` alone — those numbers live in `alerts` and `valuations` (CLAUDE.md: "No invented numbers... Prices, margins and days-to-sell come from services/valuation"). Option taken: those two steps' placeholder copy (`src/domain/copy.ts`) uses the real numbers this module can read (counts of the user's own `alert_delivered`/`alert_opened` events) and names what a real deal card would show, rather than fabricating one. Needed from a human: confirm whether `lifecycle-messaging` should depend on `alerts`/`valuations` directly for these two steps, or whether a future card revision should read them through a different module's view instead (the module card's own "Depends on" line does not list either today).



- **2026-09-24, w1 listing-lifecycle: rechecks for unresolved and marked-sold listings.** Option taken: due rechecks of an `unresolved` listing (a removed ID) are recorded as skipped; `marked-sold` listings are still rechecked when asked, because a seller can unmark a sale. Conservative on spend for removed IDs only.



- **2026-09-24, w1 source-health: counting "breaker trips".** Route-health's `v_decisions` (`docs/design/modules/route-health.md`) holds only each region's current decision, not a history of transitions, and source-health consumes no route-health event. Option taken: source-health counts one trip per distinct `apify-gateway.run-collected` job (deduped by job ID in `health_daily.processed_job_ids`) whose region decision reads `circuit-open` at the time this module processes that job, which can count a circuit that stays open across several runs more than once. Conservative because it never undercounts evidence of trouble, and the card's own alert basis is a threshold on degraded searches, not on this count, so overcounting here does not itself trigger an alert.



- **2026-09-24, subscriptions: Stripe test-mode keys missing.** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and the `STRIPE_PRICE_*` variables (`docs/secrets.md`) have not been supplied. Option taken: built and tested against synthetic webhook events in Stripe's documented shapes (`services/subscriptions/test/fixtures/stripe/`) and signatures made with the Stripe SDK's test helper, with no network call. Conservative because nothing reaches Stripe; the owner supplies test keys, and the fixtures are replaced with `stripe listen` captures.



- **2026-09-24, subscriptions: plan price variables are the old ladder's.** `docs/secrets.md` and the `stripe` env group list `STRIPE_PRICE_STANDARD_*`, `_PRO_*`, `_BUSINESS_*`, while the paid ladder of 17:35 is Starter, Pro, Max and Business with every value a pricing-console policy row. Option taken: plan price IDs come from the ladder policy rows (`SubscriptionsLadderPlan.stripePriceId`, `stripeAnnualPriceId`), never from env or code; only the top-up packs (`STRIPE_PRICE_TOPUP_5/10/25`) and the extra area (`STRIPE_PRICE_EXTRA_AREA`) are read from config. `subscriptionsStripeFromEnv` still loads the whole `stripe` group, so the obsolete plan variables must be set (to anything) until `docs/secrets.md` and `packages/config` drop them. Conservative because no price is fixed in code or env ahead of the owner's confirmation.



- **2026-09-24, subscriptions: the "Start my plan now" wording.** User-facing wording is not the session's to set; `docs/policies/refunds-and-cancellation.md` describes the tick but gives no label. Option taken: the owner's own words, "Start my plan now" and "Payments are non-refundable, except where required by law.", in `SUBSCRIPTIONS_CHECKOUT_WORDING`, shown as Stripe Checkout's required terms tick (`consent_collection.terms_of_service = required`). Stripe needs a terms of service URL set in the dashboard for that tick (human task). The refusal messages in `SUBSCRIPTIONS_MESSAGES` are placeholders too.



- **2026-09-24, subscriptions: consent kept after account deletion.** Rule 12 says user rows are purged within 24 hours of `account.deleted`, but the owner wants chargebacks answered with the stored consent, and payment records are usually kept for tax. Option taken: the entitlement is purged; `billing_events` (consent, signals) and the Stripe customer link are kept. Needs the owner's call and possibly a line in `docs/legal-review.md` (not added from a module branch).



- **2026-09-24, subscriptions: Stripe customer at sign-up (review of PR #54, finding 8).** `createCustomerOnSignUp: true` (from `docs/billing.md`) sends every Free user's email to Stripe. Option taken: kept, as `docs/billing.md` specifies it; creating the customer at the first Checkout would send less. Owner's call (data minimisation).



- **2026-09-24, subscriptions: webhook endpoint events and delayed payment methods (review of PR #54, round 2).** The Stripe webhook endpoint must be subscribed, in the Stripe dashboard, to every event type the README's "Inputs" lists, including `checkout.session.async_payment_succeeded`; without it a top-up paid by a delayed method (Bacs Direct Debit, bank transfer) completes `unpaid` and is never credited. Option taken: the list is in the README and this is recorded as an owner's dashboard step (with the terms of service URL). `startTopup` does not pin `payment_method_types: ['card']`, because which methods are offered is a product decision; the code credits a delayed payment only when `async_payment_succeeded` arrives. Conservative because no credit is granted before payment either way.



- **2026-09-25, coordinator 14: photo-review is READY on the graph but gated.** `scripts/sweep.mjs` shows `photo-review` [cp 2] ready once want-manager #88 is open, but its card says the phase is gated on actor photo capture, a photo model provider and an AI processor agreement (`docs/design/modules/photo-review.md`, "Priority and phase"), none of which exist yet; parts-record already carries the injected seam. Option taken: not started; the next coordinator starts it when the owner names the photo model provider, or says to build it against injected seams now. Conservative because a session for a module that cannot run spends tokens the owner asked to save.



- **Task w2 pickup-location, owner wording.** Every `note_code` (`description_says_collection_from`, `listed_in`, `description_names_other_pickup`, `description_delivers_elsewhere`, `pickup_place_not_stated`), the "approximate" mark and the status names need the owner's wording before the switch goes `on` (draft §10). Only codes cross the boundary.
### Folded from docs/questions/L1-web.md (sweep 04:38, 2026-09-26; genuinely open items)

- **2026-09-25, L1 web: Turnstile is required even for the local run.** `docs/decisions.md`
  ("Local single-user run first") lists the `.env.local` variables the local run needs and does
  not include `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY`; `services/auth`'s captcha plugin
  refuses `/sign-in/magic-link` with no `x-captcha-response` token regardless. Option taken: kept
  Turnstile required (never weakened the captcha check to make the local run easier), and the
  sign-in page shows a plain message instead of the widget when the keys are absent
  (`safeLoadEnv`, never a crash). The owner needs to add both keys to `.env.local` for sign-in to
  work locally; Cloudflare publishes fixed "always passes" test keys
  (`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`) for exactly this kind of
  local, non-production use, if real keys are not wanted yet. `docs/local-run.md` (task L3) should
  list whichever the owner chooses.
- **2026-09-25, L1 web: a want has no name, category or stored postcode.** `HuntForm`'s existing
  fields (name, category, postcode district) do not exist on `WantManagerWant`/
  `WantManagerUpsertWantInput`; the postcode is deliberately never stored
  (`services/want-manager/README.md`). Option taken: dropped the name and category inputs (a
  want's display name is derived from its criteria); the postcode input stays but is asked for
  again on every save, including edits, since there is nothing to prefill; `HuntCard`'s location
  line shows the resolved `centreId` instead of a postcode district. Whether a want should carry
  its own display name, and whether prefilling the postcode on edit is worth storing something
  for, are product decisions, not this session's to make.
- **2026-09-25, L1 web: the pre-existing screenshot suite (`e2e/screens.spec.ts`,
  `interaction.spec.ts`) is now silently testing the sign-in redirect, not the screen.** Those
  specs navigate to `/app`, `/app/deals`, `/app/deal/d-1002`, `/app/hunts`, `/app/hunts/h-1`,
  `/app/account` and `/app/account/preferences` with no session; task L1 added a real signed-in
  gate to those pages (`lib/session.ts`), so an unauthenticated run now redirects to `/sign-in`
  before the intended screen renders. The tests still pass (a 200 response, a visible `<h1>`, and
  the copy rules hold trivially on the sign-in page's own text), so this is not a CI failure, but
  the named screens' screenshots and copy checks are not actually exercised any more. Fixing this
  needs those specs to sign in for real (this task's own `e2e/l1.spec.ts` shows one way to), which
  is a larger, separate change to test infrastructure the L1 task did not ask for. Flagged here
  rather than silently left for someone to notice later.

