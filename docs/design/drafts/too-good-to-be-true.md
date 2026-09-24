# "Too good to be true": design of the mark

**Design draft for the coordinator and the owner, 2026-09-24.** Built from four researchers' findings (scam patterns, big-tech warnings, the real recorded data, report flows) and the binding decisions in `docs/decisions.md`. Nothing in `/home/user/nabvy` was changed.

**The owner's requirement (2026-09-24):** "I want our app to mark listings 'too good to be true'. For example I did notice scammers listing in like Isle of Wight and when asked where the collection is he says Manchester. Or listed in Chichester and when you ask when can collect he says postage only etc." It is recorded as a decision in `docs/decisions.md:154-166`.

**The job, in one paragraph.** Mark a listing "Suspected too good to be true:", followed by the facts, when a documented rule finds **two independent pieces of evidence** of the pattern the owner describes. The pattern is that the item is not really where the advert says, collection is refused, or money is wanted before the buyer sees the item. The evidence comes from the listing itself, from buyers who messaged the seller, or from both. The mark:
- attaches to the listing, never to the seller;
- never shows a score or a seller's identity;
- never hides a listing or holds an alert by itself;
- runs in shadow through the rtx3090 test hunt around Chichester, and only then goes live, one rule at a time.

**Conventions.**
- Paths without a prefix are in `/home/user/nabvy`.
- `RUN/` is the recorded run `fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/`, and "row n" is its nth listing row.
- `SP/` is this session's scratchpad, `/tmp/claude-0/-home-user-nabvy/6ec97e4b-b0e8-55d8-9880-b19e4f1f389e/scratchpad/`.
- "The catalogue" is the draft module catalogue `SP/atomic/modules.md`, which is not approved yet (`docs/progress.md:69`).
- "listing-location" is the draft design `SP/location/listing-location.md`, and "copy-advert" is `SP/atomic/copy-advert.md`.
- **Estimate** marks any figure that was not measured, and its basis is given next to it.
- Seller names and contact details are never reproduced here.
- Line references are to the drafts as of 2026-09-24 11:58 (the catalogue, `listing-location`, `copy-advert`, `account-sharing`, `SP/geo/search-map-routes.md` and the audit `SP/atomic/changes.md`).

## Summary of the design

1. **Most of the scam happens in the chat, which Nabvy never sees.**
   - Both of the owner's examples show up only after the buyer messages the seller.
   - TSB judged 34 of 100 Marketplace adverts fraudulent, but only after its staff engaged the sellers ([TSB](https://www.tsb.co.uk/news-releases/urgent-consumer-warning-as-tsb-finds-over-a-third-of-adverts-on-facebook-marketplace-could-be-scams.html)).
   - None of our 20 recorded listings carries any listing-level signal (real-data researcher; `SP/tgtbt/baserates.json`).
   - So **one-tap user reports are the main channel**. Listing rules are the precise, low-recall half.
2. **No new detectors where one exists already.** Each input comes from the module that owns it:
   - postage-only text and the location conflict: `listing-location`;
   - distant copies: `copy-advert`;
   - "far below similar asks" at n≥10: `warning-signs` over `asking-price-index` and `asking-price-position`;
   - payment-first and "Facebook delivery" text: `warning-signs`, which gets new fact codes.
3. **The catalogue's `seller-reply-reports` module** (placeholder card, `SP/atomic/modules.md:1004-1018`) is filled in by this design. It takes what buyers report the seller said. It checks each report against the listing, weights it, counts one person once, spreads it across confirmed copies, and publishes evidence. It holds no mark.
4. **`suspected-labels` hosts the mark** as a new label type, `too_good_to_be_true`. There are three documented paths, each needing two independent pieces of evidence:
   - two listing signals, at least one of them not the price;
   - one established person's report plus a non-price listing signal;
   - reports from two independent people.
   Price alone, copies alone and one report alone never mark. A report plus a low price alone goes to a reviewer and shows only if the reviewer approves it (§4.1, rule B-P), because every bargain has a low price and a bargain is what a rival buyer targets.
5. **What users see:** evidence bullets in fixed wording, towns only, miles rounded, no counts under 10, no reported place or payment kind unless at least 3 people agree, no dates, no quotes and no score, plus a "Report a mistake" link. It appears on the deal card, in alerts, as a marker style on the map, and behind a "Hide suspected" filter that is off by default.
6. **Recommended default: alerts are still sent for marked listings, with the mark in them.** By default a mark never hides a listing or holds an alert, except for users who chose to hide marked listings or not to be alerted about them; the only wait is for a gem candidate's evaluation (up to 2 minutes, §2.1), and the alert is sent whatever the result. A mark does deter other buyers and keeps a listing out of top picks, which is what a rival wants, so a false mark helps a rival. The report paths and controls are built so that one person cannot make one.
7. **Go-live is staged per path.**
   - **shadow** runs during the test hunt;
   - **reviewed** means a person approves each mark before it shows; at the end of the test hunt each path that passes §5.5 step 1 goes live in this mode (`docs/decisions.md:166`);
   - **on** means automatic, once 30 reviewed marks reach at least 90% precision and the false-mark target holds. Report-plus-price marks (B-P) never become automatic.
   Nothing shows before the owner approves the wording.
8. **Enforcement stays internal.** Abusive reporters are handled by `account-integrity` under the Fair Use Policy. Users see only the short notice that names the policy.

---

## 1. The patterns

### 1.1 Ranking

The ranking combines harm and frequency. **Harm** is where the buyer's money is lost. **Frequency** is how often UK banks, police and consumer bodies name the pattern, plus the owner's own examples.

Scale, for context:
- Purchase scams were 71% of APP cases in 2025. That is about 176,000 cases (**estimate**: 71% × 248,070), with £118.1m lost. These figures come from secondary coverage of UK Finance's 2026 report, because the primary page was blocked ([neopay summary](https://www.neopay.co.uk/uk-finance-fraud-report-2026-payment-fraud-losses-reach-1-28-billion/)). The "+20%" does not match the £87.1m UK Finance gave for 2024, so check the PDF.
- 68% of purchase scams start on Facebook or Instagram ([Lloyds via Malwarebytes](https://www.malwarebytes.com/blog/scams/2026/06/scammers-love-meta-according-to-lloyds-bank)).
- 73% of TSB's purchase-fraud cases start on Marketplace ([TSB](https://www.tsb.co.uk/news-releases/tsb-sees-huge-fraud-spikes-from-meta-owned-companies.html)).
- The average loss is about £570 across purchase scams (Lloyds) and £647 per Marketplace victim ([Santander](https://www.santander.co.uk/about-santander/media-centre/press-releases/over-1800-customers-saved-from-potential-facebook/)).

| Rank | Pattern | Why this rank | Nabvy can see in the listing | Only a user report reveals | Nabvy signal |
| --- | --- | --- | --- | --- | --- |
| 1 | **Money before seeing the item:** bank transfer, deposit or "holding fee", PayPal Friends and Family, vouchers or crypto | This is the step where the money is lost in nearly every purchase scam. Every UK authority says not to pay by transfer for goods you haven't seen ([Take Five](https://www.takefive-stopfraud.org.uk/protect-yourself/purchase-fraud/), [Met](https://www.met.police.uk/advice/advice-and-information/fa/fraud/personal-fraud/online-shopping/), [Police Scotland](https://www.scotland.police.uk/advice/scams-and-frauds/online-marketplace-fraud/)). In the Which? Scamwatch case a buyer lost £3,590 as a 50% deposit ([Which?](https://www.which.co.uk/news/article/scamwatch-i-lost-over-7k-in-an-elaborate-facebook-marketplace-scam-aKa5s4B0GC7C)) | Sometimes, as payment-first wording ("deposit to hold", "F&F only", "bank transfer before posting"). Not when the payment happens at the handover: row 1 says "cash or bank transfer on pickup" (`RUN/dataset.json:139`) | The request itself, deposit pressure, and a payee name that doesn't match | L2 `pay_first`; report family `payment` |
| 2 | **Postage or courier only; collection refused.** The owner's Chichester example | It makes rank 1 possible: with no handover, prepayment is the only way. Marketplace has no in-site payment protection for these deals ([Which?, Dec 2024](https://www.which.co.uk/news/article/its-a-steal-how-we-listed-fake-bargains-on-marketplace-websites-aQDLs8m1bFWa); [Facebook help](https://www.facebook.com/help/2374002556073992)). Which? got a bait-and-switch edit ("posted, pre-payment by bank transfer or PayPal F&F") past moderation | Sometimes, as narrowing text ("postage only", "courier only", "no collection"). All 20 recorded rows are collection-type (`deliveryTypes` includes `IN_PERSON`, `shippingOffered` false; `docs/fb-actor-reference.md:317-318`). None has postage wording | "When can I collect?" answered with "postage only". This is the owner's case exactly | L1 `postage_only`; report family `handover` |
| 3 | **The item is somewhere else.** The owner's example: listed on the Isle of Wight, collection in Manchester | Also makes rank 1 possible. The location field is seller-controlled ([Facebook help](https://www.facebook.com/help/856832575260415)), so the scammer places the advert where buyers are | Only when the text names a distant pickup place, or the advert has copies in distant towns. 3 of 20 recorded texts name a place, and all 3 agree with the field (real-data researcher) | The chat-only version, which is the owner's case: the advert is silent and the seller says "it's in Manchester" | L4 `location_far`, L5 `distant_copies`; report family `location` |
| 4 | **Fake link or "Facebook delivery"** | Harm can exceed the item price, because card details are captured. It is well documented against sellers and mirrored against buyers ([Co-operative Bank](https://www.co-operativebank.co.uk/help-and-support/fraud-and-security/common-fraud-threats/purchase-and-delivery-scam/), [MoneyHelper](https://www.moneyhelper.org.uk/en/blog/scams-and-fraud/gumtree-scams)). Less frequent than ranks 1–3 | Rarely, as "Facebook delivery", "secure payment link" or a non-Facebook URL. The listing's own shipping and checkout flags were false on every recorded UK listing and their meaning is undocumented (`docs/fb-actor-reference.md:318,334`), so they are recorded, never relied on (§2.1) | The link sent in chat | L3 `platform_claim`; report family `link` |
| 5 | **A price far below similar asks** | The lure in nearly every case, and the first sign every guide names ("too good to be true": [Report Fraud / Action Fraud](https://www.actionfraud.police.uk/a-z-of-fraud/online-shopping-fraud), [Gumtree](https://www.gumtree.com/info/safety/p/trust-safety/how-to-recognise-and-avoid-purchase-scams/)). But genuine bargains are Nabvy's whole point, so price is support, never proof | Yes, as the asking-price position at n≥10 (`docs/decisions.md:15`). No recorded group reaches n≥10: the largest same-GPU group is 2 | Nothing | P `far_below_asks` |
| 6 | **Copies of the advert in distant towns** | Strong where it occurs, but almost absent for PCs and GPUs (1 cluster), against 29.1% of the sofa control (`SP/atomic/copy-advert.md:38-40`) | Yes, from confirmed copy clusters (`SP/atomic/copy-advert.md:204-227`) | That the copies answer "somewhere else" too | L5 `distant_copies`; reports spread to copies |
| 7 | **Item not as described:** a relabelled card, a gutted card, photos of a different item | A GPU-specific harm ([Tom's Hardware](https://www.tomshardware.com/pc-components/gpus/gpu-scam-resells-rtx-3090-as-a-4090-complete-with-a-fake-ad102-label-on-a-relapped-gpu), [PC Guide](https://www.pcguide.com/news/facebook-scammers-are-gutting-the-rtx-4090-and-reselling-it-online/)). Usually found at the handover | The text-visible versions ("untested", "for parts", "box only") are neutral warning signs or noise, not this mark (`SP/atomic/modules.md:775-789`) | What the buyer found | Report family `item` |
| 8 | **"Working away, can't meet" backstory** | It explains ranks 2 and 3, but genuine sellers write it too. Row 3 says "relocating abroad" next to "Collection only - welcome to test before buying" (`RUN/dataset.json:874`) | Sometimes | "My brother has it", "a courier will bring it" | W1 `away_story` (support only) |
| 9 | **Pressure and urgency** | Named by Take Five and Meta. It is common in genuine adverts, and 0 of 20 recorded rows use it | Sometimes | "Others are interested, pay a deposit now" | W4 `urgency` (support only); report family `payment` |
| 10 | **Moving the chat to WhatsApp, text or email** | Named by Meta and MoneyHelper. A loose contact regex misfires: "@ BACK PANEL" in row 18 (`RUN/dataset.json:6135`) | Sometimes | The request in chat | W2 `off_platform_contact` (support only); `other` reports |
| 11 | **Stock or stolen photos** | Documented ([Police Scotland](https://www.scotland.police.uk/advice/scams-and-frauds/online-marketplace-fraud/)), but out of reach. The gallery is on 1 of 20 rows (`docs/fb-actor-reference.md:282`), and photo review runs only when the text is silent (`docs/decisions.md:23`) | Not in version 1 | "Photos aren't of this item" | Report family `item` (detail `photos_not_this_item`) |
| 12 | **New or hacked accounts** | Meta's own warnings key on account traits ([Meta, March 2026](https://about.fb.com/news/2026/03/meta-launches-new-anti-scam-tools-deploys-ai-technology-to-fight-scammers-and-protect-people/)) | No. There is no join date when logged out, and a seller appears on 3 of 20 rows, mostly as rotating tokens (`docs/fb-actor-reference.md:205,297,309`). Seller-level signals are **internal only** (`docs/decisions.md:12`) | "New account, old one hacked" | None user-facing (§7) |

**Out of scope for this mark:**
- **Scams against sellers**, such as fake banking-app "buyers" (researcher: Hampshire and Isle of Wight, Gwent). The mark warns buyers.
- **Labelling trade sellers, and "we buy" adverts.** Whether a seller trades is "suspected trade seller"'s question, and adverts whose own offer is to buy are `noise-filter`'s (`SP/atomic/modules.md:700-714,790-804`). Row 11 is a trade advert (`RUN/dataset.json:3722`). Trade-looking sale adverts are still judged by this mark (§2.1): pasted trade boilerplate never exempts a listing.
- **Faults, "sold as seen" and mining.** These are neutral `warning-signs` facts (row 4, `RUN/dataset.json:1173`).

### 1.2 What the real data says about recall

- **No signals in the sample.** On the 20 recorded listings, the counts are: postage or courier wording 0, deposit, PayPal or F&F 0, conflicting place 0, contact details 0, n≥10 price groups 0. Zero hits in 20 still allows a true rate of up to about 14% (one-sided 95%, 1 − 0.05^(1/20)).
- **The sample is narrow.** It covers one query, one page, one centre, no Isle of Wight rows and one 3090-class listing.
- **Where the owner's cases show up.** Most will show up only in reports (an **estimate**, based on the owner's examples, TSB's method and 17 of 20 texts naming no place at all).
- **Listings far from the centre are normal.** 14 of 20 recorded listings sat outside Facebook's 65 km radius (12–109 km, median 77 km). "Listed far from the hunt" is ordinary and is never a signal (`SP/tgtbt/baserates.json`; the `location` card, `SP/atomic/modules.md:453`).
- **Adverts that rely on photos escape the text rules.** An advert with a filler line of text and its real terms in the photos or the chat fires no text signal, and its copies split as look-alikes (`SP/atomic/copy-advert.md:169-170`). §2.1 keeps such gem candidates out of promotion when the text is thin or missing, but padded filler text still escapes that check. For such adverts, reports are the only route.

---

## 2. Listing-level rules

### 2.1 Principles

- **Read, never re-detect.** Each signal is read from the module that owns it:
  - place and handover phrases: `listing-location`;
  - clusters: `copy-advert`;
  - asking-price statistics: `asking-price-index` and `asking-price-position`;
  - payment and link wording: `warning-signs`.
  `suspected-labels` only combines what these publish (`docs/decisions.md:58-68`; `SP/atomic/modules.md:42-50`).
- **Text rules run only on `full_verified` descriptions** (`docs/fb-actor-reference.md:252,752`). On `partial` or `missing` text, a text signal is `unknown`, never `no`. A refresh through `details-queue` is requested only for a listing that `details-selector` already selects for an active hunt, or for a gem candidate (`docs/decisions.md:22,171`); otherwise its text signals stay `unknown`.
- **The structured fields come first.**
  - Collection is Facebook's UK default: `IN_PERSON` is on all 20 recorded rows, alone on 19 (`docs/fb-actor-reference.md:317`). So "offered for collection" is not a seller choice.
  - The owner's "postage only in a listing offered for collection" (`docs/decisions.md:155`) therefore reduces to narrowing text on a listing whose `shippingOffered` is false.
  - The text never overrides a field (`SP/location/listing-location.md:154-164`).
  - **`shippingOffered` and the checkout flag are recorded, never relied on.** Both were false on every recorded UK listing (`shippingOffered` on 20 of 20 rows in jobs 6 and 15; `sourceFields.detail.is_checkout_enabled` on 20 of 20 in job 6; the critics' read-only SELECTs on `apify_gateway.items`), and their meaning is undocumented (`docs/fb-actor-reference.md:318`). They are recorded with each signal and report for calibration. No user-facing text relies on them until a UK listing with either set to true has been seen.
- **Only narrowing counts.** Text that adds options ("can deliver locally", rows 1, 11 and 17) is harmless. Text that removes collection is what counts.
- **Counter-signals are narrow.** An explicit in-person check ("welcome to test", "cash on pickup", "viewing welcome") appears on 5 of 20 recorded rows: rows 1, 3, 4, 7 and 14 (`SP/tgtbt/baserates.json`). The seller writes it and it costs a scammer nothing, so X1 blocks no pair that contains L1, L2, L3 or L5 (§2.3). X2, a buyer-protected payment offered in the text, blocks path A pairs that include L1.
- **Every rule has an ID and version, a threshold with its basis, and the status "starting value".** Thresholds live in `packages/config/src/modules/<module>.ts` (catalogue rule 14, `SP/atomic/modules.md:112`).
- **Which listings are judged.** Listings that `noise-filter` marks as wanted, swap, service or buy-in adverts are not judged (row 20, the £25 repair service; `RUN/dataset.json:6713`). Trade-seller wording, or a "suspected trade seller" candidate, never exempts a listing from judging: only `noise-filter`'s wanted, swap, service and buy-in reasons do (trader boilerplate inside a priced sale is not a buy-in advert, `SP/atomic/modules.md:702`). Suppressed listings are never shown (`SP/atomic/modules.md:1019-1033`).
- **Edits are caught.**
  - When a known listing's card changes, `listing-lifecycle` rechecks it (`SP/atomic/modules.md:578-592`).
  - `alert-router` asks for a recheck of alerted listings (`SP/atomic/modules.md:914`).
  - `suspected-labels` calls `listingLifecycle.requestRecheck(ids, 'tgtbt')` at +6 h and +24 h for every listing with a candidate, a shown mark or a counted report. Description-only edits are otherwise seen only at a recheck, because the card hash covers only the title, price and thumbnail (`SP/location/listing-location.md:222`). Cost **estimate**: about $0.00092 per detail on the `graphql` route (`SP/atomic/copy-advert.md:270`), so two rechecks cost about $0.0018 per listing.
  - A new evidence hash re-runs every text rule. Text signals are then sticky within one listing ID (§4.1, "The mark goes away").
  - This covers Which?'s bait-and-switch edit, but only if the edit is seen.
- **Gem candidates are checked before they are shown.** A listing far below its product's asks (asking-price position, n≥10) is evaluated against these rules before it is shown as a top pick, to users hunting that product (results and alerts), or as a similar alternative (`docs/decisions.md:171`). For gem candidates only, `alert-router` waits for the listing's current `suspected_labels.evaluations` row, with a starting timeout of 2 minutes (basis: the 2-minute freshness guardrail, `docs/decisions.md:237`), and then sends. The evaluation never holds or suppresses the alert; it decides only whether a shown mark goes in it. A priority detail fetch through `details-queue` may be requested so the text rules can run.
- **Gem candidates with little to check are not promoted.** A gem candidate is not promoted to top picks or by-catch suggestions while any of these holds:
  - W3 (`thin_text`) is `yes`;
  - its text is not `full_verified` after one refresh;
  - its product is known only from photos (`listing-assessment`'s "photo-only evidence" caution, `SP/atomic/modules.md:687`).
  It stays in normal results and alerts.

### 2.2 Qualifying signals

These are the signals that can count towards the mark.

| ID | Name | Definition | Input (module and view) | Starting threshold and basis | Evidence line shown to users (draft; the owner approves wording) |
| --- | --- | --- | --- | --- | --- |
| **L1** | `postage_only` | The description restricts the handover to postage, courier or delivery ("postage only", "courier only", "delivery only", "no collection", "can't collect, will post", "will send tracked once paid"). The listing's `shippingOffered` is false. Excluded: "local delivery", "can deliver locally", "collection or post", and template text such as "(Specify if you are willing to deliver locally)" (row 1). Phrases match after the shared normaliser plus the digit-for-letter map of the L2 notes, so "p0stage 0nly" matches (a change requested of `listing-location`, §6.1) | `listing_location.v_resolved`: the handover flags `postage_only_text`, `courier_only_text` or `delivery_only_text`, and `collection = no`. That module's phrase classifier owns them, and structured fields go first (`SP/location/listing-location.md:154-164,699`) | Narrowing phrase present, with the rule `listing-location@1`. Basis: the owner's decision (`docs/decisions.md:155`). 0 of 20 recorded rows match (`SP/tgtbt/baserates.json`), so the false-positive rate is unmeasured until shadow | "The description says postage or courier only." `shippingOffered` is recorded, never stated to users (§2.1) |
| **L2** | `pay_first` | The description asks for payment, a deposit or a holding fee before viewing, collection or posting. It needs **either** an explicit before-cue ("before viewing", "before collection", "before posting", "upfront", "to hold", "to secure", "first") **or** a kind that is risky at any time ("PayPal friends and family", "F&F", "gift payment", vouchers, crypto). Bare "bank transfer only" is never enough. Exclusions, negation, obfuscated spellings and the rule when L1 is also `yes`: see the L2 notes below the table | `warning_signs.v_facts`, new code `pay_first_text` with a `kind` (`bank_transfer`, `friends_and_family`, `deposit`, `voucher_gift_or_crypto`, `other`) and a `before_cue` flag. It replaces the build pack's `deposit_request`, which would fire on row 1 (`docs/packs/gpu-pc.md:44`; `RUN/dataset.json:139`) | Phrase present and not excluded. Basis: every UK authority advises against paying before seeing the item (§1.1, rank 1). Row 1 is the boundary case. Unmeasured until shadow: the recorded run has no postage wording at all (0 of 20 rows in jobs 6 and 15 match post, courier or ship; the critics' read-only SELECT), so the rate of honest "postage and pay first" adverts is unknown | "The description asks for payment before you see the item (friends and family)." The kind comes from a fixed list, never a quote |
| **L3** | `platform_claim` | The description offers "Facebook delivery", "Marketplace shipping", "Meta Pay", "Facebook protection", "secure payment link", a courier paid by link, or a URL that is not facebook.com. The listing's `shippingOffered` and checkout flags are recorded with the signal, never relied on (§2.1) | `warning_signs.v_facts`, new code `platform_claim_text`; the flags from `detail_evidence.v_current`, recorded for calibration | Phrase present. Basis: researchers expect high precision, but that rests on inference, and Facebook's UK shipping page could not be checked. So it needs a second signal like every other rule (§4.1) | "The description offers delivery or payment through a link or 'Facebook delivery'." It never states what Facebook offers in general (big-tech researcher: the UK position is unconfirmed), and never what the listing's own fields offer |
| **L4** | `location_far` | `listing-location` resolved the listing as `conflicting`: a strong pickup cue in the text names a place far from the location field. The status must be `decided_by` `rules` or `review`. AI-decided conflicts count only after that lane's precision is measured (task 1.5o). **L4 counts only together with L1, L2 or L3** (§4.1): a description that names the real town is disclosure, and it is `listing-location`'s autofill case (`SP/location/listing-location.md:137,335`) | `listing_location.v_resolved`: `status`, `decided_by`, `conflict_km_band`, display and alternate labels (`SP/location/listing-location.md:485-495`) | `conflict_km_band` in `50–100` or `100+`. Basis: 50 km is above the default hunt radius of 40 km (`docs/web-app.md:36`), so at its real pickup place the item would fall outside a default hunt. `listing-location`'s own chip cut is 25 km (`SP/location/listing-location.md:324,354`); the 25–50 km conflicts are usually "the nearest big town" and stay a location chip only | "Listed in Isle of Wight; the description places the item in Manchester, about 195 miles away." Town labels come from the gazetteer (**estimate**: straight line between the two town centres, this session's haversine calculation, about 316 km) |
| **L5** | `distant_copies` | The listing is a member of a confirmed copy cluster, or of a text-copy pair, spread over distant towns, and is not the possible original (L5 notes) | `copy_advert.v_listing_copy_facts`: `towns`, `spread_km`, `mass_posted`, and a new `text_copy_spread_km`; `copy_advert.v_members` for `listed_at` order (`SP/atomic/copy-advert.md:401-422,208`) | Member of a confirmed cluster with `towns` ≥ 2 and `spread_km` ≥ 100, or of an S5 text-copy pair with `text_copy_spread_km` ≥ 100. `would_show` is not required. This needs one reader change in `copy-advert`: add `text_copy_spread_km` to `v_listing_copy_facts`; `copy-advert` still owns detection. Basis: 100 km is copy-advert's suggested "distant" for this consumer; the owner's own example has only two places (`docs/decisions.md:154`), below the proposed `flagMinTowns` of 5 (`SP/atomic/copy-advert.md:269`) | At or above `flagMinTowns`: "The same advert appears in 6 towns up to about 250 miles apart in the last 30 days." Below it: "The same advert also appears in another town about {miles} miles away in the last 30 days." It never names the other towns or links other listings (`SP/atomic/copy-advert.md:495-553`) |
| **P** | `far_below_asks` | The ask is far below similar asks in an index group with n≥10, not explained by material-state wording, and not a noise hit. P is `unknown` unless the parts check in the P notes passes | `warning_signs.v_facts`: the existing `ask_far_below_similar` fact without a material-state `low_ask_explained` fact; `asking_price_position.v_positions` for the rank, n and group label; `listing_assessment.v_assessments` for `confirmed_parts` and `gpu_state`; `parts-record` conflicts (`SP/atomic/modules.md:670-699,745-789`) | Ask ≤ 0.6 × group median at n≥10. Basis: the brief's analysis cut, where wording explained 27% of 48 asks below 0.6× (`SP/atomic/modules.md:777`), and `docs/decisions.md:15`. Below n=10 the signal is `unknown`, never "not cheap". Shadow tests cuts of 0.6, 0.7 and 0.8 (§5.2) | "Asking £350; 13 of 14 current UK asks for RTX 3090, used – good, in the last 30 days are higher." The group label comes from `asking_price_position.v_positions`, never fixed text. Never "worth", "fair", "value" or "market price" (`docs/decisions.md:15`) |

**L2 notes.**
- **Exclusions** apply only when the same payment clause ties the payment itself to the handover ("bank transfer on pickup", "pay when you collect", "cash in person"). A deposit, holding fee or part-payment before the handover always counts, whatever the balance terms (`kind = deposit`): "£100 deposit by bank transfer to hold, rest on collection" is L2 `yes`. This closes the commonest deposit scam (the Which? Scamwatch case lost a 50% deposit, §1.1).
- **Negation.** An exclusion phrase negated within 5 words ("can't", "cannot", "no", "not", "unable") does not exclude: "Can't do in person, bank transfer before I post" is L2 `yes`. "No deposit" excludes only `kind = deposit`.
- **Obfuscated spellings.** L1 and L2 phrases match after the shared normaliser (`SP/location/listing-location.md:226-237`) plus a digit-for-letter map (0→o, 1→i or l, 3→e, 5→s) and an abbreviation list (F&F, FnF, F n F, PPFF, PP gift, B/T, BT, BACS, sort code). B/T and BT count only inside a payment clause, because BT is also the Northern Ireland postcode area.
- **With L1.** Posting means paying before you see the item, so when L1 is `yes`, L2 counts as a separate piece only for kinds `friends_and_family` or `voucher_gift_or_crypto`, or a deposit asked before viewing. "Payment before posting/sending" and "bank transfer" on a postage listing are part of L1 and never a second piece.

**L5 notes.**
- **Possible original exempt.** The earliest-listed member is exempt from L5 and from spread reports (§3.2) when every other member was listed after Nabvy first fetched it (its T1). Copies posted after a listing was already live are the clone signature: `copy-advert` "makes no claim about which came first", and a photo match "can attach a scam copy to a genuine seller" (`SP/atomic/copy-advert.md:42,610`). A mass-post burst made before Nabvy's first fetch has no exempt member. The earliest `listed_at` is already computed for the cluster key (`SP/atomic/copy-advert.md:208`).
- **Why not only confirmed clusters.** `copy-advert` clusters only on an identical title and price (`advert_fp`, `SP/atomic/copy-advert.md:156,168`), so a £1 or one-word change per copy leaves only S5 text-copy evidence (`:171`), and titles under 20 characters with descriptions under 100 split as look-alikes (`:263-264`). Counting S5 pairs closes the first; the second stays open (§1.2).

**P notes.**
- **Parts check.** P is `unknown` unless every part that defines the listing's index group is in `listing_assessment.v_assessments.confirmed_parts`, with inclusion `included` and no parts-record conflict. For a PC group, `gpu_state` must be `named`. Any of these makes P `unknown`: a group-defining part with inclusion `not_included`, `sold_separately`, `optional`, `previously_owned` or `only_mentioned`; or `gpu_state` `none`, `not stated`, `in photos` or `conflicting` (`SP/atomic/modules.md:672,675,687,690`; `fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:141,180`). Basis: a PC sold without its GPU is cheap for an honest reason, the "rtx3090" term finds exactly such PCs, and the extractors may keep "RTX 3090" from "3090 removed" (rule and AI disagreements are recorded, not settled).
- **What explains a low ask.** For P, only material-state wording explains a low ask: not working, for parts, a named fault, box only, a named core part missing, or a part not included (`low_ask_explained` reasons `not_working`, `for_parts`, `named_fault`, `box_only`, `core_part_missing`, `part_not_included`; §6.5). Swap, trade, part-exchange and "offers" wording, and cosmetic wording (scratches, marks, dust, coil whine), never explain it. Basis: 2 of 20 recorded rows mention swaps or trades (rows 8 and 11, `SP/tgtbt/baserates.json`), so a throwaway "swaps considered" would otherwise switch P off.
- **Small condition groups.** A rare condition keeps n below 10: on the recorded run "Used – good" is 10 of 20 rows, "Used – like new" 5, "New" 3, "Used – fair" 1 and no condition 1 (`SP/tgtbt/baserates.json`). Whether to compute P against the pooled used groups for the same item and context at n≥10 when the listing's own condition group has n < 10 is owner decision 26, because `docs/decisions.md:15` says "same spec and condition". If pooled, the group label reads "the same model, used". Default until the owner decides: not pooled, so P stays `unknown`.
- **Logged in full.** `evaluations.signals.P` stores `{ state, ratio, rank, n, group }`, so shadow mode shows where scam asks really sit, including just above the cut (§5.2).

### 2.3 Supporting and counter signals

Supporting signals are internal only in version 1. They never make a mark on their own and are never shown as evidence. A reviewer needs one of them to approve a B-P candidate (§4.1), and W3 keeps a gem candidate out of promotion (§2.1). Shadow mode measures whether they add precision.

| ID | Name | Definition | Input | Starting threshold and basis | Use |
| --- | --- | --- | --- | --- | --- |
| W1 | `away_story` | "working away", "abroad", "offshore", "in the forces", "can't meet", "my brother/partner has it" | `warning_signs.v_facts`, new internal code `away_story_text` | Phrase present. Basis: TSB, Autotrader and the Met describe the "cannot meet" story. Row 3 is the counter-example | Review priority; calibration |
| W2 | `off_platform_contact` | Phone number, WhatsApp, email or a non-Facebook link in the text | `warning_signs.v_facts`, new internal code `off_platform_contact_text`. The pattern needs word boundaries and a full phone or email shape | Row 18's "@ BACK PANEL" must not match (`RUN/dataset.json:6135`) | Review priority; calibration |
| W3 | `thin_text` | A `full_verified` description under 40 characters once template text is removed, or `partial`/`missing` after one refresh | `detail_evidence.v_current`; `warning_signs` internal code `thin_text` | 40 characters. Basis: the shortest recorded genuine description is 56 characters, and 2 of 20 are under 100, both harmless (live SELECT, real-data researcher). The brief's one suspect was cheap with no description | Review priority; calibration |
| W4 | `urgency` | "must go today", "first to see will buy", "lots of interest, pay to hold" | `warning_signs` internal code `urgency_text` | Phrase present. 0 of 20 recorded rows | Review priority; calibration |
| **X1** | `in_person_check_offered` (counter) | "welcome to test", "can see it running", "viewing welcome", "happy to power it on", "cash on collection/pickup", "bank transfer on pickup", or "Collection only" as a cue | `warning_signs` new codes `viewing_offered_text` and `payment_on_collection_text`; `listing_location.v_resolved` `collection = yes` from a text cue. `payment_on_collection_text` does not fire on a clause that also demands a deposit | Phrase present. It fires on rows 1, 3, 4, 7 and 14 (`SP/tgtbt/baserates.json`), none of which carries any of L1–L5 | **Blocks no path A pair in version 1.** The only pair it would block, L4 + P (the autofill case, where the X1 cue is a pickup or pay-on-collection cue at L4's text place), no longer qualifies at all (§4.1). It never blocks a pair containing L1, L2, L3 or L5, because the scammer writes it too (Which?'s bait-and-switch). X1 on a listing that also has L1, L2 or L3 is logged as internal support `x1_contradicted`. It does not block report paths, because the seller can still change the deal in chat |
| **X2** | `protected_payment_offered` (counter) | "PayPal Goods and Services", payment by card ("pay by card", "card payment"; bare "card" never matches, because "graphics card" is everywhere), "pay on delivery", "pay when it arrives", "via eBay" | `warning_signs` new code `protected_payment_text` | Phrase present. "PayPal" is on 0 of 20 recorded rows (`SP/tgtbt/baserates.json`); the other phrases are unmeasured | **Blocks path A whenever L1 is one of its two signals**: a seller who posts with buyer protection is not the pattern. It does not block report paths |

### 2.4 How the signals behave on the recorded run

This is the design's expected output, tested as fixtures in §8.

| Row | What it holds | L1 | L2 | L3 | L4 | L5 | P | X1 | Mark |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | "cash or bank transfer on pickup"; template leftovers (`RUN/dataset.json:139`) | no | no (excluded "on pickup") | no | no | no | unknown (n<10) | yes | none |
| 3 | "relocating abroad" with "Collection only - welcome to test" (`:874`) | no | no | no | no | no | unknown | yes | none |
| 4 | Cheap, faulty, "sold as seen" (`:1173`) | no | no | no | no | no | unknown; explained if it became known | yes | none |
| 11 | Trade "we buy" advert; "Local delivery available" (`:3722`) | no (adds an option) | no | no | no | no | unknown | no | none (no L1–L5 fires) |
| 14 | "Collection only from E1 (Whitechapel)", "cash on pickup" (`:4807`) | no | no | no | no (district inside London) | no | unknown | yes | none |
| 18 | "No Scammers", "@ BACK PANEL" (`:6135`) | no | no | no | no | no | unknown | no | none |
| 20 | £25 repair service (`:6713`) | not judged: noise-filter | | | | | | | none |

---

## 3. User reports

### 3.1 The one-tap flow

**Where it appears:**
- **Deal card.** Every "Open on Facebook" button uses the signed `/go/<token>` link that `notifier` owns (task 4.3g, `SP/sharing/account-sharing.md:260,805`); card opens outside alerts are added to that route by a `notifier` change (task 1.7o), never by a second `/go/` route. `notifier` records the open (T7, `notifier.opened`; `SP/atomic/modules.md:92,946`); `seller-reply-reports` owns no route and records no opens. When the user comes back to the app (the page becomes visible again), a small bar appears on that card: "Messaged the seller? Tell other buyers what they said." It is also listed under "Opened listings", for replies that arrive hours later.
- **Alerts.**
  - **Telegram:** inline buttons under each alert: "Open on Facebook" (`notifier`'s signed `/go/<token>` link), "What did the seller say?" and, when a mark shows, "Report a mistake". Telegram allows 1–64 bytes of `callback_data`, enough for a short alert reference and a reason code (report-flows researcher, `docs.python-telegram-bot.org`).
  - **Push and email:** alerts link to the card's sheet.
- **Pasted-link results** use the same card, so the same `notifier` route and open record apply.

**When the sheet is offered (the gate):**
- `notifier`'s open record shows the user opened this listing through `/go/<token>` at least **5 minutes** ago and at most **14 days** ago. These are starting values: 5 minutes is time to message and read a reply, and the recorded listings were 16.6–33.7 hours old when found (`docs/fb-actor-reference.md:227`).
- The listing's `messagingEnabled` is true (all 20 recorded rows; `docs/fb-actor-reference.md:318`).
- The listing is not suppressed and is not a noise-filtered wanted, service or buy-in advert.
- The user is signed in, with a verified email and active standing (`account.isActive()`; `docs/decisions.md:123-124`).
- Signed "Open listing" links are per recipient (the token carries a per-user key version and an HMAC), so a forwarded alert creates no open for someone else (`SP/sharing/account-sharing.md:260`).
- Nabvy cannot know whether a message was really sent. The gate only makes a report plausible; the counting rules in §3.2 do the rest.

**The sheet:**
- Heading: **"What did the seller say?"**
- Tapping a chip saves the report at once: that is the one tap.
- After the tap, an optional follow-up row appears. It holds the chip's own follow-up question (two for "Collection is somewhere else"), plus "Anything else they said?" to add another chip to the same report.
- "No reply yet" closes the sheet without saving anything.

| Chip (draft wording; the owner approves) | Code | Optional second tap | Family | Checked automatically against the listing | Counts towards the mark |
| --- | --- | --- | --- | --- | --- |
| "Collection is somewhere else" | `collection_elsewhere` | "Where?": a town picker (towns, areas and Facebook page names only, from `location`'s display places; never a postcode or street), or "Didn't say". Then "Could you still see it and pay when you collect there?": Yes, No, Didn't ask | `location` | Distance band from the listing's display place (`listing_location.v_resolved` plus `location.distanceKm()`) | Only at **50 km or more** (the same basis as L4), and by the second answer. "Yes" is stored as an internal pickup hint for `listing-location` review and never counts: an honest seller who has moved, keeps the item at work or has an autofilled location tells every buyer the real town. "No" counts as designed. "Didn't ask" counts only in path B. Under 50 km any answer is stored as an internal pickup hint for review only. It never moves the listing's location (`SP/location/listing-location.md:1031`, decision 10). "Didn't say" (where) also counts only in path B (§4.1) |
| "Postage or courier only" | `postage_only` | "How did they want paying?": bank transfer, friends and family, PayPal Goods and Services or card, didn't say | `handover` | The listing's `shippingOffered` at the time of the report, recorded (§2.1) | Only when the listing's `shippingOffered` is false; if it is true the report is stored, never counted (the field was false on every recorded listing, so this check has not yet excluded anything). A report answering "PayPal Goods and Services or card" is stored, never counted |
| "Asked me to pay before I could see the item". Small print under the chip: "Paying by bank transfer when you collect is normal. Don't report that." | `payment_first` | "How?": bank transfer, friends and family, deposit or holding fee, other | `payment` | — | Yes |
| "Sent a link or 'Facebook delivery'" | `link_or_fb_delivery` | "What kind?": payment link, delivery or courier link, "Facebook delivery" | `link` | The listing's `shippingOffered` and checkout flags, recorded with the report | Yes. The sheet adds "Don't open it or enter card details" (owner's wording). Nabvy never stores, opens or follows the link: there is no URL field and, in version 1, no free-text field |
| "Item not as described" | `not_as_described` | "What was wrong?": different model, photos weren't of this item, faulty or missing parts the advert didn't mention, other | `item` | A `faulty_or_missing_parts` report is stored, not counted, when `warning-signs` has a fault, for-parts, untested or "sold as seen" fact, or `parts-record` has a part with inclusion `not_included` or `sold_separately` | Yes, unless the check stores it uncounted. Report-then-buy never voids this family (§3.3) |
| "Something else" | `other` | None in version 1: saved without free text, as the catalogue placeholder says ("No free text", `SP/atomic/modules.md:1006`), until the owner decides (decision 14). If the owner allows it: at most 280 characters, links refused | — | — | **Never.** It is internal only, used for review and to find new reasons |
| "Nothing odd" (proposed; owner decision 3) | `as_listed` | — | counter | — | A counter-report. It never lowers a level; on a listing that meets a report path it holds the candidate for review (§3.2). It gives the calibration denominator |

The first three chips carry the owner's own examples (`docs/decisions.md:156`). The list follows the benchmarks: 4–6 concrete reasons, one optional follow-up, and optional free text, which here waits for owner decision 14 (Facebook, eBay, Gumtree, Depop, Airbnb; report-flows and big-tech researchers). The Online Fraud Charter asks for a report route "within two clicks" ([gov.uk](https://www.gov.uk/government/publications/online-fraud-charter-2023/online-fraud-charter-2023-accessible)). There are no opinion chips such as "rude" or "price too high": chips describe what the seller said, so they can be checked and are hard to use as punishment.

**Signposting at the point of reporting.** After a `payment_first` or `link_or_fb_delivery` report, the sheet shows a short, neutral box (wording is the owner's):
- Don't pay before you see the item.
- Keep to Facebook's messages.
- You can report the listing to Facebook too.
- If you have paid, call your bank now and report it to Report Fraud (reportfraud.police.uk, 0300 123 2040), which replaced Action Fraud in December 2025 ([City of London Police](https://www.cityoflondon.police.uk/news/city-of-london/news/2026/january/report-fraud-launches/)). Check the primary page before shipping this copy.

This is the Online Fraud Charter's "at the point of reporting". Nabvy itself never contacts Facebook, sellers, banks or the police about a report.

### 3.2 How reports count

**Eligibility.** A report that fails any check is stored with weight 0 and used for calibration only:
- verified email;
- active standing;
- account at least **30 days** old (established);
- an open record inside the 5-minute to 14-day window;
- within the rate limits;
- not caught in a burst hold;
- not on the tester list. Tester reports are for calibration only: the team is not independent.

**Weight.** Each eligible report's weight is `w = age factor × accuracy factor`, capped at 1.0.
- **Age factor:** 1.0 for accounts at least 30 days old. Younger accounts are not established (`docs/decisions.md:158`, "Reports count only from distinct, established accounts"): their reports carry weight 0 for levels, are stored, and go to the review queue and calibration. They never count towards `single` or `multiple`. 30 days is a starting value until the owner answers catalogue question 43 (`SP/atomic/modules.md:2282`).
- **Accuracy factor:** `2 × (upheld + 1) / (upheld + not_upheld + 2)`, capped at 1. This is a Beta-prior reputation, after Jøsang and Ismail's Beta reputation system ([Semantic Scholar](https://www.semanticscholar.org/paper/The-Beta-Reputation-System-Ismail-J%C3%B8sang/2c9736ba3ffcfec14a3cce61ae7592c05498f505)).
  - A new reporter starts at 1.0.
  - Accuracy can only lower the weight, never raise it above 1.0, so there are no "super reporters" whose accounts would be worth buying or taking over.
  - Example: 0 upheld and 3 not upheld gives 0.4.
- **Upheld** means a reviewer confirmed the report, or a later listing signal of the same family backed it (L1 for `handover`, L4 for `location`, L2 for `payment`, L3 for `link`). P, L5 and other users' reports never uphold a report: a rival's second account, or the low price every bargain has, must not keep a false report at full weight. **Not upheld** means a reviewer rejected it or a correction removed it. A listing disappearing is never confirmation (`docs/decisions.md:16`).
- **Paying status adds no weight.** Money must not buy influence over warnings.

**One person counts once.**
- There is one report per user per listing (a unique key). One report may carry several reasons, because a seller can say both "postage only" and "bank transfer first".
- A report can be edited for 24 hours and withdrawn at any time. Withdrawing removes its weight, and the evidence is recomputed.
- Accounts that `account-integrity` links as one person (the same email hash or card fingerprint; `SP/atomic/modules.md:1402-1416`) count once. For counting reports, `accountIntegrity.linkedGroupOf()` also links accounts that share a device cookie (`devices.device_key_hash`) or were active on the same network hash on 2 or more days in the last 30 (`activity_buckets.network_hash`; `SP/sharing/account-sharing.md:478,480`). A linked group counts once, at the **lowest** weight in the group. A household on one network is therefore one reporter, which is the conservative side. `seller-reply-reports` asks through `accountIntegrity.linkedGroupOf(userIds)` and never reads the keys. Basis: free accounts have no card, so different email addresses would otherwise never be linked.

**Levels per listing and family.** For family *f*:
- **S_f** is the sum of the weights of independent people reporting *f*;
- **C** is the summed weight of "Nothing odd" counter-reports on the same listing.

| Level | Condition | Meaning |
| --- | --- | --- |
| `none` | S_f < 1.0 | Not counted. A single sub-threshold report goes to the review queue |
| `single` | 1.0 ≤ S_f < 2.0 | One established person |
| `multiple` | S_f ≥ 2.0 from at least 2 independent people | Several independent people |

**Counter-reports never lower a level.** When C > 0 on a listing that meets a report path, the candidate is held for review even when the path is `on` (hold reason `counter_report`), and a reviewer decides. C is still recorded for calibration. Basis: the seller knows exactly which listing to defend, so one aged sock account would otherwise cancel a report one for one; and "Nothing odd" does not contradict "the seller told me postage only", because a seller can tell different buyers different things.

A `collection_elsewhere` report counts only where its distance band is at least 50 km from *that* listing's own display place, and only as its second answer allows (§3.1).

**Spreading across a copy-advert cluster** (`docs/decisions.md:156`):
- It uses the L5 membership (§2.2): confirmed clusters read from `copy_advert.v_members` and S5 text-copy pairs (`SP/atomic/copy-advert.md:405,171`). The possible original (L5 notes) never receives spread reports. It never spreads across look-alikes, relist groups or seller keys: relists would show history across listing IDs (`docs/decisions.md:14`; see "How long reports count" for owner decision 24), and seller keys stay internal (`docs/decisions.md:12`).
- In live modes it spreads only while `copy-advert` is `on`. In shadow it is computed for calibration only. When copy-advert is off, a report counts only on its own listing (`SP/atomic/copy-advert.md:113`).
- Each person counts once per cluster per family, and the same levels apply at cluster level.
- **Location reports are re-evaluated for each member.** "Collection in Manchester", reported on the Isle of Wight copy, counts on the Isle of Wight and Chichester copies but not on the Manchester copy, where it agrees with the listing.
- On a copy, the evidence says "the same advert in another town", never which town (§4.3).

**How long reports count.** A report counts while its listing is live. A text edit by the seller does not remove it: the report is about what the seller said. When the listing is gone, its evidence is archived, and retention follows owner decision 15.

**Delete and relist.** Reports count per listing ID, so a scammer who deletes and reposts after the first report starts again from zero; listing signals come back on the repost, report evidence does not. Owner decision 24: carry counted reports across a `relist-merge` group whose basis is a matching description (`SP/atomic/modules.md:732`), for 30 days, and show them as ordinary report bullets on the current listing, never as "relisted", "earlier listing" or with a date. Default until the owner decides, following `docs/decisions.md:14` (the conservative option): carried reports are not shown and do not complete a path. They put the new listing at the top of `v_review_queue`, and in `reviewed` mode the reviewer can see them. `seller-reply-reports` reads `relist_merge.v_groups` (soft) for this.

### 3.3 Abuse resistance

The main threat in a deal app is a **rival buyer flagging a real bargain** to scare others off it. The other threats are the seller's own sock accounts countering genuine reports, brigades, bots, and grudges.

| Control | Starting value | Basis |
| --- | --- | --- |
| A mark never hides a listing, never holds an alert and never changes who is alerted; the only wait is the gem-candidate evaluation of §2.1, which happens whatever its result | Always | `alert-router` never holds an alert because of a label (`SP/atomic/modules.md:914`; catalogue question 16, `:2255`). A mark buys a rival no delay in other users' alerts, but it can deter other buyers, so report paths need evidence a rival cannot supply alone |
| A single report never marks, and a report needs a second, independent piece of evidence that is not the price | Paths in §4.1 | `docs/decisions.md:158` ("need a threshold before a report-based mark shows"). Reporting volume does not decide at TikTok or YouTube, and Community Notes needs agreement across raters (report-flows researcher). Every bargain has P, so P is never the second piece for a report (§4.1) |
| Report-only marks on a gem candidate (P `yes`) always need a reviewer's approval, whatever the path's mode | Always | A gem is exactly what a rival buyer targets (`docs/decisions.md:171`) |
| Interaction gate, account age (30 days), verified email | §3.1–3.2 | The benchmark platforms take feedback only after a real interaction (Airbnb, Vinted, Uber); `docs/decisions.md:158` counts only established accounts |
| One report per user per listing; one person once per cluster; linked accounts once, at the lowest weight, including a shared device cookie or network | §3.2 | The acceptable use policy's linked-accounts rule (`docs/policies/acceptable-use.md`, LR-33) |
| Rate limits | 5 reports an hour and 15 a day per user; the public mistake form 5 an hour per IP, behind Turnstile | Build-pack feedback is 60 a minute (`docs/engineering.md:67`), far too loose for reports. A buyer messages a handful of sellers a day (**estimate**). The limit is recalibrated to the 99th percentile of honest reporters' daily counts |
| Silent over-limit | Same confirmation, weight 0, and a signal to `account-integrity` | Reasons behind enforcement stay internal (`docs/decisions.md:117-121`) |
| Burst hold | 3 or more reports on one listing or cluster within 24 hours, from accounts of any age: that evidence is held for review | Starting value. Spacing reports more than an hour apart must not dodge it. Meta removes mass-reporting networks (report-flows researcher) |
| Burst hold on gem candidates | 2 or more reports on a gem candidate within 6 hours, whatever the accounts' age: held for review | Starting value. Two flippers hunting the same product are two independent aged accounts, and a gem is what they compete for |
| Report-then-buy | A report whose author marks the same listing "bought" in `listing-feedback` within 7 days has its weight removed and its outcome set to `unknown`, never `not_upheld`. It is not an abuse signal. The `item` family is exempt, because "not as described" can legitimately follow a purchase | A rival avoids this by never tapping "bought", so it catches only honest users, such as a reporter who later negotiated collection and bought; it must not penalise them. It needs an internal view of `bought` verdicts from `listing-feedback` (§6) |
| Counter-reports pass the same gates and never lower a level | Same gates and weights; a counter-report on a listing that meets a report path holds the candidate for review (§3.2) | The seller's socks cannot cancel genuine reports |
| Banned accounts | On `account.standing-changed` to banned, that account's reports are voided and the evidence is recomputed | `docs/decisions.md:110-115` |
| Free text never counts and is never shown | Always | Output-guard checks it (§8) |

**What remains.** Two or more independent, aged accounts reporting the same listing (the burst-hold rows hold some of these, and a reviewer approves any report-only mark on a gem), and one report on a listing that also has a non-price listing signal. A single report plus the low price goes to a reviewer (rule B-P, §4.1). The accounts' accuracy falls once reviews go against them.

### 3.4 Feedback to the reporter

**Confirmation, at once** (draft wording):
- Live: "Saved. If other buyers report the same, or our checks agree, other buyers will see a warning. You can see it under Your reports."
- Shadow, seen only by testers, because no one else sees the report UI in shadow (§5.1): "Saved. Warnings from reports are being tested and are not shown to other buyers yet."

**"Your reports"** is `app.v_seller_reply_reports_mine`: the user's own rows only, under row-level security. It shows one of these statuses:
- **Saved**;
- **Helping warn other buyers**, when the report is part of a shown mark;
- **Not shown to others**. This one status covers too few reports, weight 0, a burst hold and over-limit, deliberately with no distinction between them;
- **Warning removed after a check**;
- **Withdrawn**.

**Withdraw** is available at any time. Facebook, likewise, lets a reporter cancel a report from the Support Inbox ([Facebook help](https://www.facebook.com/help/195906499396292)).

**Never shown to the reporter:** weights, thresholds, eligibility, other reporters, or anything about the seller.

**No push notification on a status change** by default (owner decision 22). eBay gives only a receipt; Facebook shows a status in the Support Inbox (big-tech researcher).

---

## 4. The mark

### 4.1 When it shows

The mark shows when any one of three documented paths holds. Each path needs **two independent pieces of evidence**. Paths are yes or no: nothing is summed into a score. A fourth rule, B-P, only queues a candidate for a reviewer.

| Path | Rule ID | Condition | Blocked by a counter-signal? | Typical case |
| --- | --- | --- | --- | --- |
| **A. Two listing signals** | `tgtbt.listing-pair@1` | At least two different qualifying listing signals among L1–L5 and P, at least one of which is L1–L5. So price plus nothing, or price plus a supporting signal, never marks. **L4 counts only together with L1, L2 or L3**: L4 with P, or L4 with L5, never marks, because a description that names the real town is disclosure, and it is `listing-location`'s autofill case (`SP/location/listing-location.md:335`; `docs/decisions.md:146`). When L1 is `yes`, L2 counts only as the L2 notes allow (§2.2) | X1: no pair (the only pair it would block, L4 + P, does not qualify). X2: any pair that includes L1 | "Postage only, PayPal friends and family only" (L1 + L2); "Facebook delivery" far below similar asks (L3 + P); copies 250 miles apart far below similar asks (L5 + P); "Item is in Manchester, courier only once paid" on an Isle of Wight page (L4 + L1) |
| **B. A report plus a listing signal** | `tgtbt.report-plus-listing@1` | Report evidence at level `single` or above in family *f*, plus one qualifying listing signal of a different kind from L1–L5. **P never counts in path B**: every bargain has P, and a bargain is exactly what a rival buyer targets, so a report plus P is still one person's word (rule B-P). The same fact twice does not count: a `handover` report plus L1, or a `location` report plus L4. A location report whose place is "Didn't say", or whose second answer is "Didn't ask", counts here only | No | The owner's Chichester case: one established buyer's "postage only" report on a listing whose copies sit in distant towns (L5), or whose text asks for friends-and-family payment (L2) |
| **B-P. A report plus the price (review only)** | `tgtbt.report-plus-price@1` | A `single` report plus P, with no other qualifying listing signal. It goes to `v_review_queue` at top priority and shows only after a reviewer approves it. The reviewer approves only when at least one supporting signal (W1–W4) is also present and the report-path checks of §5.5 pass. **This rule never moves to `on`** (owner decision 25) | No | One established buyer reports "collection in Manchester" on an Isle of Wight listing far below 14 similar asks whose text says "working away, can't meet" (W1) |
| **C. Reports from independent people** | `tgtbt.reports-only@1` | Level `multiple` in one family; or level `single` in two different families from two different people. A `location` family at `multiple` counts only from "No" answers to "Could you still see it and pay when you collect there?" (§3.1); otherwise path C needs a second family from a different person. On a gem candidate (P `yes`), a path C mark always needs a reviewer's approval (§3.3) | No | The owner's Isle of Wight case: two buyers report "collection in Manchester" and could not see it and pay there, or one reports Manchester and another reports a request to pay first |

**Never enough on their own:**
- the price position alone;
- copies alone (that is `copy-advert`'s own "likely spam" flag);
- one report alone;
- one report plus the low price (rule B-P goes to a reviewer);
- the text naming a distant town plus the low price or copies (L4 + P, L4 + L5);
- supporting signals W1–W4;
- seller-level signals of any kind (`docs/decisions.md:12`);
- photo matches;
- AI-only location conflicts, until they are measured.

**The mark goes away** when its inputs no longer satisfy any path: a report is withdrawn or voided, a correction applies, or a price group drops below n=10. It is recomputed on each input event (§6.6). Report-driven additions reach users in two fixed daily batches (§6.6, owner decision 27); removals are immediate. A reviewer's "remove" correction wins over recomputation until the evidence changes, and a reviewer's "keep" survives later edits.

**Text signals are sticky within one listing ID.** Once L1, L2, L3 or L4 is `yes` on any `full_verified` version, it stays `yes` for that listing's life (history within one listing ID is allowed, `docs/decisions.md:14`). After a mark has shown or a report has counted, an edit that removes a signal or adds X1 sends the listing to `v_review_queue`. The mark stays until a reviewer clears it, and its bullet ends "(since edited)", with no date. Basis: otherwise a scammer sheds a mark by deleting "postage only" or adding "viewing welcome", and in `reviewed` mode each edit would reset the approval (§6.3).

**Degrading.** When an input module is off, its signals are `unknown` and paths that need them cannot fire:
- with `asking-price-position` off there is no P;
- with `seller-reply-reports` off only path A remains;
- with `listing-location` off there is no L1 or L4 (catalogue rule 11, `SP/atomic/modules.md:96-106`).

**The owner's two examples, traced through the rules:**

| Case | Evidence | Result |
| --- | --- | --- |
| Isle of Wight listing, text silent; one buyer (30+ days old, clean record) reports "collection is in Manchester" | Location `single`, about 195 miles (**estimate**) | No mark. Review queue |
| … and a second, independent buyer reports the same; both answer "No" to "Could you still see it and pay when you collect there?" | Location `multiple` from "No" answers | **Path C** |
| … or, with one report only, the listing is also far below 14 similar asks | Location `single` + P | No mark. Review queue, raised priority (rule B-P; shown only if a reviewer approves) |
| Chichester listing, text silent; two buyers report "postage only"; the listing's `shippingOffered` is false; neither says they offered PayPal Goods and Services or card | Handover `multiple` | **Path C** |
| Chichester listing whose text says "Postage only. PayPal friends and family only, before sending." | L1 + L2 (friends and family) | **Path A** |
| Chichester listing whose text says "Postage only. Payment by bank transfer before sending" | L1; L2 folded into L1 | No mark. Honest private sellers who post write exactly this |
| Isle of Wight listing whose text says "Collection from Manchester only, cash on collection" | L4 + X1 | No mark. L4 needs L1, L2 or L3, and it is probably an autofilled location. `listing-location` shows its "Location differs" chip |

### 4.2 The label wording

The owner's phrase joined with the brief's "Suspected …:" rule is already decided in outline (`docs/decisions.md:158`). The owner confirms the final text. Proposals:

| | Option A (recommended; matches `docs/decisions.md:158`) | Option B (big-tech question form) | Option C (the price decides the words) |
| --- | --- | --- | --- |
| Chip on card and marker tooltip | **Suspected too good to be true** | **Too good to be true?** | **Suspected too good to be true** when P = `yes` is among the evidence; otherwise **Suspected risky sale** |
| Panel heading | **Suspected too good to be true:** followed by the bullets | **Too good to be true?** then "Why we flagged this:" followed by the bullets | The chip's words with a colon, followed by the bullets. Without P, the panel adds "Collection or payment may not work as the advert suggests." |
| Line under the bullets | "This is a warning based on the listing and, where stated, on what buyers who messaged the seller told us. It is not a finding about the seller, who may have a good reason." | Same | Same |
| Safety line | "Before you pay, see the item in person and pay when you collect." | Same | Same |
| Link | "Report a mistake" | Same | Same |

- **Option A** follows the decision text and the "every label starts 'Suspected'" check (`SP/atomic/modules.md:800,1051`).
- **Option B** follows the phrasing Gumtree, Autotrader and Meta guidance use ("If it sounds too good to be true, it probably is"), and Autotrader's hedged "This could be due to a number of factors" (big-tech researcher). It drops the brief's "Suspected …:" form that `docs/decisions.md:13,158` adopt, so choosing it needs the owner to amend that decision, and then the catalogue's "every label starts Suspected" rule and the output-guard check (`SP/atomic/modules.md:800,1051`).
- **Option C** answers a problem with A and B. No recorded price group reaches n≥10 (§1.1, rank 5), so P is `unknown` on almost every listing today, and most marks will come from postage, payment, location or report evidence, including on listings priced at or above the usual ask. "Too good to be true" on an ordinarily priced listing makes a price judgement nobody made, and "Suspected" does not fix it: row 13, £2,000 in Chichester at the test hunt's centre, has P `unknown`. Both option C forms start with "Suspected", so output-guard is unchanged. It is one label type with two chip texts, chosen by whether P = `yes` is in the evidence. The owner chooses the wording (decision 1).

**Never used:** "scam", "scammer", "fraud", "fake", "the seller is …", "worth", "fair", "value", "market price", exclamation marks or urgency. These follow the copy rules (`docs/web-app.md:48-50`), `docs/compliance.md:37` and `docs/decisions.md:13,15`.

### 4.3 Evidence bullets

`app.v_suspected_labels` carries evidence as **codes with parameters**, never as finished text. The web app and `notifier` render them from one owner-approved template file. Output-guard can then check every parameter.

| Code | Draft template | Parameters and their sources |
| --- | --- | --- |
| `postage_only_text` | "The description says postage or courier only." | — (L1) |
| `pay_first_text` | "The description asks for payment before you see the item ({kind})." | kind from a fixed list (L2) |
| `platform_claim_text` | "The description offers delivery or payment through a link or 'Facebook delivery'." | — (L3) |
| `location_far` | "Listed in {listedIn}; the description places the item in {textSays}, about {miles} miles away." | gazetteer labels and a rounded distance from `listing_location.v_resolved` (L4) |
| `distant_copies` | At or above `flagMinTowns`: "The same advert appears in {towns} towns up to about {miles} miles apart in the last 30 days." Below it: "The same advert also appears in another town about {miles} miles away in the last 30 days." | `copy_advert.v_listing_copy_facts` (L5) |
| `far_below_asks` | "Asking {price}; {higherCount} of {n} current UK asks for {groupLabel} in the last 30 days are higher." | `asking_price_position.v_positions`, only at n≥10; `groupLabel` from that view, never the fixed text "same model and condition" (P) |
| `report` + `location` | "{Buyers} who messaged the seller {say/says} they were told collection is somewhere else, more than 30 miles from {listedIn} where it is listed." Only when at least 3 independent people gave the same place: "{Buyers} who messaged the seller say they were told collection is in {place}, about {miles} miles from {listedIn} where it is listed." | `seller_reply_reports.v_listing_evidence` |
| `report` + `handover` | "{Buyers} who messaged the seller {say/says} they were told it is postage or courier only." | as above |
| `report` + `payment` | "{Buyers} who messaged the seller {say/says} they were asked to pay before seeing the item." Only when at least 3 independent people gave the same kind, " ({kind})" is added | as above |
| `report` + `link` | "{Buyers} who messaged the seller {say/says} they were sent a payment or delivery link." | as above |
| `report` + `item` | "{Buyers} who saw the item {say/says} it was not as described." | as above; only counted reports (§3.1 check) |
| via a copy | Prefix: "On the same advert in another town, …" | `via_copy` from the evidence view |
| since edited | Suffix on a sticky text signal whose text was edited away: " (since edited)" | `sinceEdited` on the evidence item (§4.1) |

**Rules for bullets:**
- At most **3 bullets**: listing facts first, then reports. Any further bullets sit behind "and 2 more".
- **{Buyers}** is "A buyer" for one person, "Buyers" for 2–9, and the exact number only at 10 or more. A seller knows who messaged them, so a small count or a time could point to the reporter. The draft terms already promise "We never show who made a report" (`docs/policies/terms.md:257`).
- **No canary values.** {place}, {miles} and {kind} from reports are shown only when at least 3 independent people gave the same value. Otherwise a scammer with a free Nabvy account could tell each buyer a different town or payment method and watch which one appears, which would identify the reporter. The timing is also blurred: report-driven evidence reaches users in two fixed daily batches (§6.6, owner decision 27).
- Towns, areas and Facebook page names only, taken from the gazetteer or the page, never from seller text (`docs/decisions.md:20`; `SP/location/listing-location.md:368-381`).
- Miles are whole and preceded by "about" (listing-location decision 2, `SP/location/listing-location.md:1023`). "More than 30 miles" is the 50 km count threshold rounded down (50 km is about 31 miles).
- No dates or times, no quotes, no free text, no other listing's town or link, no cluster ID and no score.

### 4.4 Report a mistake

**Entry points:**
- the "Report a mistake" link on every mark: in-app, one tap to a sheet;
- a public form at `nabvy.com/report-a-mistake`, because a seller may not be a Nabvy user (`docs/policies/terms.md:347`). It asks for the listing link, what is wrong, and an optional email for a reply. It sits behind Turnstile, limited to 5 an hour per IP.

**Reasons** (report-flows researcher):
- "The seller confirmed collection where the advert says";
- "I bought or collected it and it was as described";
- "The low price is explained in the advert";
- "The seller offered collection or viewing, just in another town";
- "The seller posts with buyer protection (PayPal Goods and Services or card)";
- "I am the seller";
- "Something else".

**Routing:**
- A signed-in user with an open record who picks one of the first two reasons files an `as_listed` counter-report in `seller-reply-reports`, with the same gates and weights. It never lowers a level; it holds the candidate for review (§3.2).
- Everything else becomes a correction request in `suspected-labels`, queued in `review-console`. Correction requests on a shown mark have a target of **4 working hours** (starting value). Basis: a wrong mark must not outlast the listing, and the recorded listings were 16.6–33.7 hours old when found (`docs/fb-actor-reference.md:227`), while good deals disappear first (`fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:283-285`). Requests on marks not yet shown keep a target of 2 working days.
- A seller's claim stays unverified, because `seller-accounts` is Later and gated (`SP/atomic/modules.md:1586-1600`). An unverified claim goes to review and the mark stays.
- Objection or erasure by a seller is not a correction. It goes to `seller-rights` and `listing-suppression` (`SP/atomic/modules.md:1019-1048`).

**Reviewer outcomes:**
- keep;
- remove one report family's evidence;
- remove the mark;
- remove a listing signal (for example, a place misread).

Outcomes go through `suspectedLabels.applyCorrection()` and `sellerReplyReports.resolve()`. They are audited in `audit-log`, mark contributing reports upheld, not upheld or unknown, and are exported as fixtures (`SP/atomic/modules.md:1111-1129`).

**Reply to the requester:** one line, "We checked the warning and removed it" or "… and kept it". Nothing about reporters.

### 4.5 Where it appears

| Surface | How it appears |
| --- | --- |
| **Deal card** | A chip next to the price row: "Suspected too good to be true". Tapping it opens the panel with the bullets, the line under them, the safety line and "Report a mistake". The asking-price position shows as usual. Beside it: "What did the seller say?" (§3.1) |
| **Alerts** (Telegram, push, email) | Telegram and push: a first line after the title, "Suspected too good to be true", then the first two bullets and "Why?" (a link to the panel). Email: only the chip and a "Why?" link to the live panel, never the bullets, because a sent email cannot be corrected (§4.6). Telegram buttons: Open on Facebook, What did the seller say?, Report a mistake. `notifier` renders only rows from `app.v_suspected_labels` (`SP/atomic/modules.md:942-956`) |
| **Map marker** | Same position as any listing: the town or area centroid, never moved (`docs/decisions.md:142`). A distinct style: an outlined marker with a small warning glyph in a neutral amber, never red, with the accessible label "Suspected too good to be true". Cluster bubbles are unchanged |
| **Feed filter "Hide suspected"** | A toggle in the filters, **off by default**. It hides listings with a shown mark from the feed and map, with a visible count ("3 hidden") and a "show" link, like the noise filter (catalogue question 17). The preference lives in `want-manager` (`SP/atomic/modules.md:852-866`) and `spec-match` applies it, as it does "hide likely spam". A separate opt-in, "Don't alert me about suspected listings", is also off by default (§4.6). Shadow candidates are never hidden |
| **Top picks and "while hunting we also found"** | A listing that meets path A is not promoted, **even in shadow** (owner decision 7). A report-path candidate (B, B-P or C) stops promotion only once its mark is approved in `reviewed` mode, or shown with its path `on`. Until then it is promoted as usual and queued for review at raised priority, so unreviewed reports never demote a gem. Gem candidates with little to check are also not promoted (§2.1). Every such listing stays in normal results and alerts. `docs/decisions.md:171` asks for this check before promotion. Not promoting shows nothing about the listing |
| **Not shown in** | Public pages, SEO pages, the public part of Nabvy Daily, and, by default, Business exports, feeds and the public API (owner decision 18) |

### 4.6 Alerts for marked listings

**Recommended default: alerts are still sent, with the mark shown in them.** The owner decides (decision 4).

Why:
- **Alerts are never held for a label.** The catalogue already says `alert-router` never holds or suppresses an alert because of a label (`SP/atomic/modules.md:914`; question 16). The gem-candidate evaluation of §2.1 is a wait for the check, not a hold: the alert goes whatever the result.
- **A mark is a warning, not a finding.** Holding the alert would decide for the user, and silence is never a "no".
- **Holding alerts would arm flaggers.** If a mark held alerts, a rival's reports would buy them time on a bargain.
- **Listing-location made the same call.** It sends alerts on conflicting listings, with the chip in the alert (`SP/location/listing-location.md:1029`).

Options for the owner:
- (a) the default: send with the mark;
- (b) send marked listings to the digest only;
- (c) hold them.
The user can opt out through "Don't alert me about suspected listings".

**A mark that appears after an alert was sent.** The default is no follow-up push. The mark shows on the card, in "Opened listings" and in the user's alert feed (owner decision 5). This is conservative: fewer messages and no alarm pushed.

**A mark that is removed after an alert was sent.** A wrong mark must not outlast its correction in copies users already hold. When a mark is removed, `notifier` edits the Telegram alerts that carried it to drop the mark (Telegram Bot API `editMessageText`, https://core.telegram.org/bots/api#editmessagetext). The in-app alert feed shows marks live from `app.v_suspected_labels`. Email alerts carry only the chip and a "Why?" link to the live panel, never the bullets (§4.5).

---

## 5. Shadow mode and calibration

### 5.1 What runs in shadow

- `suspected-labels` evaluates every judged listing and writes one `evaluations` row per listing version. Each row holds every signal as `yes`, `no` or `unknown`, and the paths met. Where a path is met, it also writes a `candidates` row with its would-show evidence.
- `app.v_suspected_labels` returns no `too_good_to_be_true` rows (catalogue rule 11).
- `seller-reply-reports` shows the report bar, sheet and "Your reports" only to accounts in its `testers` table, and records their reports as tester reports; no other user sees the report UI in shadow. Testers see the shadow confirmation.
- Nothing a user sees changes, with one exception: path A candidates are kept out of top picks and by-catch suggestions (§4.5), if the owner accepts it (decision 7). Report-path candidates are not, until a reviewer approves them.

### 5.2 What is logged

| What | Where | Why |
| --- | --- | --- |
| Signal states per listing version, including `unknown` (text not `full_verified`, n<10, input module off), X2, `x1_contradicted`, and the listing's `shippingOffered` and checkout flags | `suspected_labels.evaluations` | Recall analysis, and how often each input is missing |
| P in full: `signals.P` = `{ state, ratio, rank, n, group }` | `suspected_labels.evaluations` | Before go-live, shadow calibration tests cuts of 0.6, 0.7 and 0.8 against the reviewer labels, so scams priced just above the cut are seen |
| Candidates per path with the evidence codes and parameters | `suspected_labels.candidates` | Precision per path |
| Reviewer labels | `suspected_labels.reviews` | Ground truth |
| Reports: reason, detail, eligibility, weight, distance band, whether the listing's own fields contradict the report, and time from T0 to the report | `seller_reply_reports.reports`, `report_reasons` | Report calibration |
| Daily rates | `suspected_labels.v_shadow_metrics`, `seller_reply_reports.v_shadow_metrics` → `ops-metrics` | Candidates per 1,000 judged listings per path; each signal's rate; unknown rates; reports per opened listing; reason mix; share of postage reports on no-shipping listings; share of location reports at 50 km or more; counter-report rate; share of weight-0 reports by cause; would-have-been-alerted-with-mark count |

### 5.3 Labelling during the rtx3090 test hunt

The test hunt is the first end-to-end acceptance run (`docs/decisions.md:136`; task 1.10, `SP/atomic/actor-integration.md:419,448`).

**Who labels:** two team reviewers in `review-console`, each working alone. Where they disagree, the label is `unclear`.

**What they label:**
- every candidate on any path;
- every listing with any report;
- every P-only listing: far below similar asks and nothing else. These are the gem-or-scam boundary;
- a random 10% sample of all other judged listings, to estimate false negatives.

**Labels:** `likely_scam`, `likely_genuine` or `unclear`. Each is decided from the listing's own text and fields plus any reports:
- never from seller-level data, following `listing-location`'s rule for its own labels (`SP/location/listing-location.md:179-198`);
- never from a listing disappearing (`docs/decisions.md:16`);
- **for a path B, B-P or C candidate, never from the reports that formed it.** Nabvy never sees the chat (`docs/decisions.md:154`), so a reviewer could otherwise only confirm that the reports exist, and measured precision would look high whether they are true or not. `likely_scam` needs evidence that arrived independently of them: a later report from a different person in a different family, an edit that adds postage-only or pay-first text, or a report of a lost payment (through "Something else" or a correction request). `likely_genuine` applies when the listing's own text contradicts the reports. Otherwise the label is `unclear`. Path C precision is computed only on candidates with such independent evidence.

**The team as users.** Team members report only what sellers really said when they genuinely contact sellers as part of the hunt. There is no scripted or pretend messaging to "test" sellers, and no TSB-style probe (owner decision 16). Nabvy never contacts sellers (`docs/compliance.md:36`).

**Positives will be rare.**
- The recorded page had 0 of 20.
- TSB's 34 of 100 came from categories chosen for scams, after engaging sellers, so it does not transfer.
- **Estimate:** one newest-first "gaming pc" page near Chichester held about 28 new listings a day (20 listings over 17.1 hours; report-flows researcher). An "rtx3090" term is narrower.
- If prevalence is 1–5% (an **assumption**; not measured), 30 positives need roughly 600–3,000 judged listings (real-data researcher's arithmetic).

**Real positives from the owner.** The owner's two real cases could be captured as listing rows if the owner gives their links. They would go through `pasted-link-lookup` and the shared details queue (owner decision 17). Until then, positives in unit tests are synthetic and marked as such (§8), and never counted in calibration.

### 5.4 Precision targets

These are starting values from binomial arithmetic, not measurements. They are confirmed after the first 300 labelled listings.

| Measure | Target | Basis |
| --- | --- | --- |
| Precision of each path's candidates: `likely_scam` ÷ (`likely_scam` + `likely_genuine`); `unclear` reported separately | ≥ 90% on at least 30 reviewed cases | 27 of 30 has a Wilson 95% lower bound of about 0.74 (this session's calculation). The listing-location `conflicting` target is also 90% (`SP/location/listing-location.md:983`) |
| False marks on labelled genuine listings, per path | 0 in at least 300, so ≤ 1% at 95% | Rule of three: 3/300 (real-data researcher) |
| Hard-negative suite (§8) | 0 marks, always | Fixture-first (`CLAUDE.md`, "Fixture-first") |
| Privacy stage: every evidence parameter passes the output rules | 100%, always | `docs/decisions.md:20,30-34` |
| Recall of labelled `likely_scam` listings | Reported; no target | Listing-only recall is expected to be low (§1.2) |

### 5.5 Switch-on criteria

The TGTBT label type has a mode **per path**, held in `suspected_labels.rules`: `shadow`, `reviewed` or `on`. Every change is the owner's action, audited through `switches` and `audit-log`.

1. **Shadow → reviewed.** In `reviewed` a person approves each mark in `review-console` before it shows, with a target of 1 working day. Reviewed marks are live but checked. A path moves to `reviewed` when all of these hold:
   - the owner has approved the wording (decisions 1–3);
   - the hard-negative suite gives 0 marks;
   - the rtx3090 test hunt (task 1.10) has ended, and its labelled listings show no false mark on the path;
   - `seller-reply-reports`' abuse tests pass;
   - output-guard is green;
   - legal-review items 13, 22 and LR-02, and the new items in §11, are listed. A review runs only if the owner requests it; whether go-live waits for one is owner decision 13 (`docs/decisions.md:188`).
   - **Reviewer checks for report paths.** In `reviewed` mode, a reviewer approves a path B, B-P or C mark only after checking three things: the reporters are not linked, they did not all report within 60 minutes, and nothing in the listing's text contradicts the reports. That the reports exist is not a reason to approve. A B-P mark also needs a supporting signal (W1–W4, §4.1).
2. **Reviewed → on.** All of these hold:
   - at least 30 reviewed marks on the path at ≥ 90% approval;
   - the path meets the false-mark target of §5.4 (0 in at least 300 labelled genuine listings, counting marks rejected in reviewed mode);
   - no mark on the path removed by a correction in the last 14 days (starting value).
   - **Path C needs public users and independent evidence.** The team is not independent, so path C stays `reviewed` until 30 reviewed cases come from public users. Path C moves to `on` only on 30 cases with the independent evidence of §5.3. The test hunt can calibrate paths A and B and the 50 km cut only (report-flows researcher).
   - **B-P never moves to `on`.** Report-only marks on a gem candidate always need a reviewer's approval, whatever the path's mode (§3.3).
3. **Automatic demotion.** A path whose rolling precision over its last 30 reviewed or corrected marks falls below 80% goes back to `reviewed`. The owner is told through `ops-alerts`. This follows the rollout gates in the account-sharing design (4.3l, `SP/sharing/account-sharing.md:810`).

At the end of the test hunt, each path that passes step 1 goes live in `reviewed` mode, where a person approves every mark before it shows (`docs/decisions.md:166`). A path without 30 reviewed marks stays in `reviewed`, never in shadow.

---

## 6. Atomic modules and contracts

### 6.1 Who does what

| Module | Status | What it gives the mark | Change this design asks for |
| --- | --- | --- | --- |
| `listing-location` | Designed (`SP/location/listing-location.md`) | L1 through its handover flags (`postage_only_text`, `courier_only_text`, `delivery_only_text`); L4 (`conflicting`, `conflict_km_band`); display places and labels for report distances | Its §5.7, plus the digit-for-letter map on the L1 phrases (§2.2). Reader grant for `seller-reply-reports` on `v_resolved`, added by `listing-location`'s own session |
| `location` | Catalogue card | The town picker's places; `distanceKm()` | Reader grant for `seller-reply-reports` (`v_places`, `nearestDisplayPlace()`; task 1.2f), added by `location`'s own session |
| `copy-advert` | Designed (`SP/atomic/copy-advert.md`) | L5 (`v_listing_copy_facts`); report spreading (`v_members`) | A new column `text_copy_spread_km` in `v_listing_copy_facts` (§2.2, L5); detection stays in `copy-advert`. Reader grant for `seller-reply-reports` on `v_members` (soft). Both by `copy-advert`'s own session |
| `asking-price-index`, `asking-price-position` | Catalogue cards | Rank, n, median and the group label for P | A display label per group in `v_positions` (`groupLabel`), if it is not already there |
| `listing-assessment`, `parts-record` | Catalogue cards (`SP/atomic/modules.md:670-699`) | `confirmed_parts`, `gpu_state`, inclusion statuses and conflicts for P's parts check (§2.2) | Reader grant for `suspected-labels` (soft) |
| `relist-merge` | Catalogue card (`SP/atomic/modules.md:730-744`) | `v_groups` for carried reports (owner decision 24) | Reader grant for `seller-reply-reports` (soft) |
| `warning-signs` | Catalogue card (`SP/atomic/modules.md:775-789`) | L2, L3, W1–W4, X1, X2 and P as facts | New fact codes and `low_ask_explained` reasons (§6.5). `deposit_request` becomes `pay_first_text` with its exclusions |
| `noise-filter` | Catalogue card | Excludes wanted, swap, service and buy-in adverts from judging and from the report sheet | None |
| `listing-suppression` | Catalogue card | Fails closed | None |
| **`seller-reply-reports`** | Catalogue placeholder, filled in here (§6.2) | Report evidence per listing and family | — |
| `suspected-labels` | Catalogue card, extended (§6.3) | Hosts the label type, paths, modes, candidates, corrections and calibration | Its `reports` table moves to `seller-reply-reports`, and it gains `correction_requests`, `evaluations`, `reviews` and `approvals` |
| `account-integrity` | Catalogue card | `linkedGroupOf()`, including shared device cookies and networks; report-abuse rules (§7) | A new exported function and new rules (task 4.3p) |
| `listing-feedback` | Catalogue card | `bought` verdicts for report-then-buy | A new internal view, `v_bought_for_reports` (user, listing, at), granted only to `seller-reply-reports` (task 1.7s) |
| `notifier` | Catalogue card | Owns `/go/<token>` and records opens (T7); renders the mark and the buttons; Telegram callbacks call the report procedure | Card and pasted-link opens on `/go/<token>`; buttons and templates; Telegram edits when a mark is removed (task 1.7o) |
| `want-manager` | Catalogue card | Stores "Hide suspected" and "Don't alert me about suspected listings" | New preference keys (task 1.7p) |
| `spec-match` | Catalogue card | Applies "Hide suspected" | Reads `app.v_suspected_labels` (soft) (task 1.7q) |
| `alert-router` | Catalogue card | Waits for the evaluation row on gem candidates (§2.1); never holds an alert because of a label. It applies the user's opt-out only if the owner adopts it | Soft read of the preference; the gem-candidate wait (task 1.7r) |
| `review-console` | Catalogue card | Queues for approvals, correction requests, sub-threshold reports, burst and counter-report holds, carried relist reports and calibration labels | Task 4.5b |
| `output-guard` | Catalogue card | New checks (§8.5) | Task 1.7n |
| `ops-metrics` | Catalogue card | Reads both shadow-metric views | Reader only |

**What this design does not build**, because another module owns it:
- the `/go/` route and the record of opens (`notifier`);
- place or handover phrase matching (`listing-location`);
- clustering (`copy-advert`);
- price statistics (`asking-price-*`);
- distance maths and gazetteers (`location`);
- account linking (`account-integrity`);
- the "likely spam" flag (`copy-advert`);
- following or storing links (nobody).

### 6.2 The module: `seller-reply-reports` (the catalogue's placeholder, filled in)

The catalogue already has a module for this job, `seller-reply-reports`, as a placeholder card waiting for this draft (`SP/atomic/modules.md:1004-1018`); the audit gives it task 1.7j (`SP/atomic/changes.md:74`). This specification replaces that card, so there is one module, one contract file and one set of events. Its one job is what buyers report **the seller replied** after contact. That separates it from "report a mistake" (corrections, in `suspected-labels` and `copy-advert`) and from `listing-feedback` (private verdicts). The report-flows researcher proposed the same module as `listing-reports`. It stays separate from `suspected-labels` because report intake holds user data (row-level security, purge on deletion), has its own abuse controls, and must be switchable off alone if it is abused, while listing-signal marks carry on (`docs/decisions.md:62-66`). It publishes `v_listing_evidence` in place of the placeholder's counts view. Replacing the card, and the `other` chip's free text, are owner decision 14; the report codes and what counts as an established account are catalogue question 43 (`SP/atomic/modules.md:2282`).

**Card (catalogue format):**
- **Purpose:** take one-tap reports of what a seller said to a buyer; check each against the listing; weight it; count each person once; spread it across confirmed copies; publish evidence per listing and family.
- **Does / does not:**
  - Does:
    - answers `canReport()` for the UI, reading `notifier`'s open record for the gate;
    - takes and edits reports and lets users withdraw them;
    - computes eligibility and weight, and the levels per family, including the location distance per member;
    - holds bursts and counter-reported candidates, and removes the weight of report-then-buy reports;
    - publishes evidence;
    - publishes internal reporter signals for `account-integrity`;
    - purges a user's rows on account deletion.
  - Does not:
    - label anything, or decide a mark (that is `suspected-labels`);
    - own a route or record opens (that is `notifier`);
    - move a listing's location (`SP/location/listing-location.md:1031`);
    - store links;
    - show free text;
    - contact anyone;
    - use seller data.
- **Inputs:**
  - calls: `canReport()`, `submit()`, `edit()`, `withdraw()`, `resolve()`;
  - events: `notifier.opened`, `copy-advert.clustered`, `listing-location.changed`, `listing-feedback.recorded`, `account.standing-changed`, `account.deleted`;
  - views and functions:
    - `notifier`'s open view (`v_alert_open_context`, task 4.3g, `SP/sharing/account-sharing.md:569`), read for the 5-minute to 14-day gate;
    - `listing_location.v_resolved`;
    - `location.v_places`, `distanceKm()`;
    - `detail_evidence.v_current` (`shippingOffered`, `messagingEnabled`, checkout flags);
    - `copy_advert.v_members` and `v_listing_copy_facts` (the L5 membership);
    - `relist_merge.v_groups` (owner decision 24);
    - `warning_signs.v_facts` and the `parts-record` view, for the `not_as_described` check (§3.1);
    - `noise_filter.v_classifications`;
    - `listing_suppression.v_suppressed`;
    - `listing_feedback.v_bought_for_reports`;
    - `account.isActive()`, `v_profiles` (account age, email verified);
    - `accountIntegrity.linkedGroupOf()`.
- **Outputs:**
  - `seller-reply-reports.recorded` (report IDs);
  - `seller-reply-reports.evidence-changed` (listing IDs);
  - `seller-reply-reports.resolved` (report IDs);
  - signals to `account-integrity` through the internal view `v_reporter_signals`.
- **Owns** (schema `seller_reply_reports`; row-level security on every table with a user ID):

| Table | Key columns | Unique |
| --- | --- | --- |
| `reports` | id uuidv7, source, source_listing_id, reporter_user_id, card_hash, evidence_hash, open_via (from `notifier`'s open record), first_opened_at, eligibility, weight_at_submit numeric(3,2), status, outcome `upheld \| not_upheld \| void \| unknown` (null until known), outcome_by `review \| corroboration \| correction \| report_then_buy \| ban`, listing_shipping_offered, listing_checkout_enabled, listing_messaging_enabled, note_text (reserved; null until owner decision 14 allows free text), tester bool, rule_version, created_at, updated_at, withdrawn_at | `(source, source_listing_id, reporter_user_id)` |
| `report_reasons` | report_id, reason, detail (nullable enum), second_answer (nullable enum: `yes \| no \| didnt_ask` for `collection_elsewhere`; the payment answer for `postage_only`), reported_place_id (town level, location only), distance_band `<10 \| 10–25 \| 25–50 \| 50–100 \| 100+ \| unknown`, counts `any_path \| path_b_only \| none` | `(report_id, reason)` |
| `reporter_stats` | user_id, upheld, not_upheld, voided, last_report_at | `(user_id)` |
| `listing_evidence` | source, source_listing_id, family, scope `own \| copy`, persons int, weight_sum, counter_weight, level `none \| single \| multiple`, place_id and distance_band (location only, seen from this listing), held bool, inputs_hash, rule_version, as_of, t1_fetched_at, done_at | `(source, source_listing_id, family, rule_version)` |
| `holds` | source, scope_key (a listing or a cluster), reason `burst \| gem_burst \| counter_report`, opened_at, released_at, released_by, audit_id | `(scope_key, opened_at)` |
| `testers` | user_id, added_by, audit_id, added_at | `(user_id)` |

- **Views:**

| View | Class | Readers | Columns |
| --- | --- | --- | --- |
| `v_listing_evidence` | Internal | `suspected-labels`, `ops-metrics`, `review-console` | listing, family, scope, persons_band (`one \| several \| exact ≥10`), level, place label, distance band and kind (each only when at least 3 independent people gave the same value, §4.3), held and hold reason, carried_from_relist bool (never shown, owner decision 24), rule_version, as_of. **No user IDs, no free text** |
| `v_review_items` | Internal | `review-console` | report ID, listing, reasons, details and second answers, note_text (null in version 1), eligibility, weight, status. No user ID |
| `v_shadow_metrics` | Internal | `ops-metrics` | the daily rates of §5.2 |
| `v_reporter_signals` | Internal, granted only to `account-integrity` and the admin path | `account-integrity`; the review console's admin path | user_id, reports in the last 24 hours and 30 days, not_upheld, voided, over-limit count, burst involvement. No report-then-buy count (not an abuse signal, §3.3). No seller data, so not a `restricted_` view (catalogue rule 5, `SP/atomic/modules.md:46-47`) |
| `app.v_seller_reply_reports_mine` | User-facing, `security_invoker` | `nabvy_app` | listing_id, reasons (codes), status, created_at, withdrawable. The user's own rows only |

- **Contracts:** §6.4.
- **Depends on:** `switches`, `audit-log`, `auth`, `account`, `listing-ingest`, `detail-evidence`, `listing-location`, `location`, `noise-filter`, `listing-suppression`, `notifier`; soft: `copy-advert`, `relist-merge`, `warning-signs`, `parts-record`, `listing-feedback`, `account-integrity`.
- **When off:** no report buttons or sheet; evidence views and `app.v_seller_reply_reports_mine` return no rows (catalogue rule 11, `SP/atomic/modules.md:96-106`); marks use listing signals only (path A).
- **Shadow:** everything is recorded and computed; `v_listing_evidence` has rows for `suspected-labels`' shadow; the report bar, sheet and "Your reports" are shown only to accounts in `testers`, and `app.v_seller_reply_reports_mine` returns rows to testers only, added as a documented exception in catalogue rule 11.
- **Tests:** §8.
- **Priority and phase:** MVP, shadow first (`docs/decisions.md:154-166`).
- **Retention:** owner decision 15. Default:
  - the reporter link and note are kept while the listing is live and for 90 days after it is gone or its case is closed;
  - after that only an anonymous contribution is kept (family, listing, weight at the time, date), so a mark already shown does not flip;
  - account deletion purges the reporter link, notes and stats within 24 hours (`docs/security.md:11`);
  - `erase(listingIds)` deletes every report on erased listings.

### 6.3 Changes to `suspected-labels` for this label type

**Label type:** `too_good_to_be_true`, with rules `tgtbt.listing-pair`, `tgtbt.report-plus-listing`, `tgtbt.report-plus-price` and `tgtbt.reports-only`, each at version 1 with its own mode. `tgtbt.report-plus-price` takes only `shadow` or `reviewed`, never `on`.

**Tables** (schema `suspected_labels`; the catalogue's `rules`, `candidates`, `labels` and `corrections` stay; `reports` leaves):

| Table | Key columns | Unique |
| --- | --- | --- |
| `rules` (rows added) | label_type, rule_id, version, thresholds jsonb, mode `shadow \| reviewed \| on`, changed_by, audit_id | `(rule_id, version)` |
| `evaluations` (new) | source, source_listing_id, evidence_hash, card_hash, inputs_hash, rule_version, signals jsonb (`{ L1: 'yes'\|'no'\|'unknown', … }`), paths_met text[], t1_fetched_at, done_at | `(source, source_listing_id, evidence_hash, card_hash, inputs_hash, rule_version)` |
| `candidates` | id, source, source_listing_id, label_type, rule_id, rule_version, evidence jsonb (`SuspectedLabelsTgtbtEvidenceItem[]`), would_show, held_reason (nullable: `counter_report`, `gem_report_only`, `edited_after_shown`), created_at, cleared_at | `(source, source_listing_id, rule_id, rule_version, inputs_hash)` |
| `approvals` (new) | candidate_id, decision `approve \| reject`, evidence_codes text[], by, at, audit_id | `(candidate_id)` |
| `labels` | source, source_listing_id, label_type, candidate_id, evidence, shown_at, removed_at, removed_reason | `(source, source_listing_id, label_type)` where not removed |
| `correction_requests` (new) | id, source, source_listing_id, label_id, requester_kind `user \| seller_unverified \| public`, requester_user_id (nullable), contact_email (encrypted, nullable), reason, text (≤ 1,000), status, due_at, decided_by, decided_at, internal_note | `(id)` |
| `reviews` (new; calibration) | source, source_listing_id, evidence_hash, reviewer, label `likely_scam \| likely_genuine \| unclear`, sample `candidate \| reported \| p_only \| random`, at | `(source_listing_id, evidence_hash, reviewer)` |

**Views:**
- `v_candidates` and `v_review_queue` (internal): candidates awaiting approval (B-P and gem report-only candidates at top priority), correction requests (shown marks first, §4.4), sub-threshold reported listings, held evidence, edits after a mark showed, and new listings with carried relist reports (owner decision 24).
- `v_calibration` (internal): candidates joined with reviews.
- `v_shadow_metrics` (internal).
- `app.v_suspected_labels` (user-facing), with the columns listing_id, label_type, evidence (a jsonb array of codes and parameters), shown_at and report_mistake_path. For this label type it returns rows only when all of these hold:
  - the module switch is `on`;
  - the candidate's path is `on`, or `reviewed` with an approval;
  - a held candidate (a counter-report, a report-only candidate on a gem, or an edit after the mark showed) has an approval, whatever the path's mode;
  - the label is not removed;
  - the listing is not suppressed and `listing-suppression` is on (catalogue rule 5, `SP/atomic/modules.md:48`).

**Approvals carry over.** Each description edit makes new `warning-signs` facts, a new `inputs_hash` and a new candidate. An approval carries over to a new candidate on the same listing and path when the new evidence codes equal or include the approved ones (`approvals.evidence_codes`). Only a lost code needs a new approval. Otherwise a scammer who edits daily would never be shown in `reviewed` mode.

**Events:** `suspected-labels.changed` (listing IDs; existing).

**Consumes:** `warning-signs.found`, `listing-location.changed`, `copy-advert.clustered`, `asking-price-position.positioned`, `seller-reply-reports.evidence-changed`, `noise-filter.classified`, `detail-evidence.changed`.

**Functions:**
- `applyCorrection()` (existing);
- `requestCorrection(input)` (new);
- `approve(candidateIds, decision)` (new, admin);
- `erase(listingIds)`.

**Switch:** the module switch as in catalogue rule 11, plus the per-path mode above. Turning the label type off is done by setting every path to `shadow`, or by switching the module off. Other label types are unaffected by the first.

### 6.4 Zod types

```ts
// packages/contracts/src/modules/seller-reply-reports.ts
import { z } from 'zod'
import { Source } from '../core/enums'
import { defineEvents } from '../core/events'
import { UuidV7 } from '../core/ids'
import { ListingStub } from '../core/listing-stub'
import { IsoTimestamp } from '../core/time'

export const SellerReplyReportsReason = z.enum([
  'collection_elsewhere', 'postage_only', 'payment_first', 'link_or_fb_delivery', 'not_as_described', 'other', 'as_listed',
])
export const SellerReplyReportsFamily = z.enum(['location', 'handover', 'payment', 'link', 'item'])
export const SellerReplyReportsPaymentKind = z.enum(['bank_transfer', 'friends_and_family', 'deposit', 'voucher_gift_or_crypto', 'other'])
export const SellerReplyReportsLinkKind = z.enum(['payment_link', 'delivery_link', 'facebook_delivery'])
export const SellerReplyReportsItemKind = z.enum(['different_model', 'photos_not_this_item', 'faulty_or_missing_parts', 'other'])
/** "Could you still see it and pay when you collect there?" `yes` never counts; `didnt_ask` counts only in path B. */
export const SellerReplyReportsCollectionAnswer = z.enum(['yes', 'no', 'didnt_ask'])
/** "How did they want paying?" on a postage-only report. `protected` (PayPal Goods and Services or card) never counts. */
export const SellerReplyReportsPostagePayment = z.enum(['bank_transfer', 'friends_and_family', 'protected', 'didnt_say'])
/** A `location` display place ID: town, area or Facebook page. Never a postcode or street. */
export const SellerReplyReportsPlaceId = z.string().min(1).max(64)
/** Derived from the core stub, never typed twice (`packages/contracts/src/core/listing-stub.ts:23`). */
export const SellerReplyReportsListingId = ListingStub.shape.sourceListingId

export const SellerReplyReportsReasonInput = z.discriminatedUnion('reason', [
  z.strictObject({
    reason: z.literal('collection_elsewhere'),
    placeId: SellerReplyReportsPlaceId.nullable(),                 // null = "Didn't say"
    canSeeAndPay: SellerReplyReportsCollectionAnswer.nullable(),   // null = not answered, treated as `didnt_ask`
  }),
  z.strictObject({ reason: z.literal('postage_only'), paidHow: SellerReplyReportsPostagePayment.nullable() }),
  z.strictObject({ reason: z.literal('payment_first'), kind: SellerReplyReportsPaymentKind.nullable() }),
  z.strictObject({ reason: z.literal('link_or_fb_delivery'), kind: SellerReplyReportsLinkKind.nullable() }),
  z.strictObject({ reason: z.literal('not_as_described'), kind: SellerReplyReportsItemKind.nullable() }),
  // No free text in version 1 (owner decision 14; the catalogue placeholder's "No free text").
  // If the owner allows it, a `note` (≤ 280 characters, links refused: `.note_has_link`) is added here.
  z.strictObject({ reason: z.literal('other') }),
  z.strictObject({ reason: z.literal('as_listed') }),
])

export const SellerReplyReportsSubmitInput = z.strictObject({
  source: Source,
  listingId: SellerReplyReportsListingId,
  reasons: z.array(SellerReplyReportsReasonInput).min(1).max(6),
}).superRefine((v, ctx) => {
  const codes = v.reasons.map((r) => r.reason)
  if (new Set(codes).size !== codes.length) ctx.addIssue({ code: 'custom', message: 'seller-reply-reports.duplicate_reason' })
  if (codes.includes('as_listed') && codes.length > 1) ctx.addIssue({ code: 'custom', message: 'seller-reply-reports.as_listed_alone' })
})
export const SellerReplyReportsWithdrawInput = z.strictObject({ reportId: UuidV7 })

/** Shown to the reporter. Deliberately coarse: `not_shown` covers every internal cause. */
export const SellerReplyReportsStatus = z.enum(['saved', 'helping_warn', 'not_shown', 'removed_after_check', 'withdrawn'])
/** Internal only; never in a user-facing view (output-guard). */
export const SellerReplyReportsEligibility = z.enum([
  'eligible', 'no_open', 'too_soon', 'too_late', 'email_unverified', 'not_active', 'too_new',
  'rate_limited', 'burst_hold', 'tester', 'messaging_off', 'noise', 'suppressed',
])
export const SellerReplyReportsLevel = z.enum(['none', 'single', 'multiple'])
export const SellerReplyReportsOutcome = z.enum(['upheld', 'not_upheld', 'void', 'unknown'])
export const SellerReplyReportsResolveInput = z.strictObject({
  reportIds: z.array(UuidV7).min(1).max(500),
  outcome: SellerReplyReportsOutcome,
  by: z.enum(['review', 'corroboration', 'correction', 'report_then_buy', 'ban']),
})
// View row types (v_listing_evidence, app.v_seller_reply_reports_mine) are derived from the Drizzle
// view definitions with drizzle-zod and re-exported here, never typed twice (catalogue rule 3).

const ListingIds = z.array(z.string()).min(1).max(500)
export const sellerReplyReportsEvents = defineEvents('seller-reply-reports', {
  'seller-reply-reports.recorded': { 1: z.strictObject({ source: Source, reportIds: z.array(UuidV7).min(1).max(500), recordedAt: IsoTimestamp }) },
  'seller-reply-reports.evidence-changed': { 1: z.strictObject({ source: Source, listingIds: ListingIds, changedAt: IsoTimestamp }) },
  'seller-reply-reports.resolved': { 1: z.strictObject({ reportIds: z.array(UuidV7).min(1).max(500), resolvedAt: IsoTimestamp }) },
})
// Error codes (errors.ts): seller-reply-reports.not_eligible, .rate_limited (never returned to the
// user as such: the procedure answers "saved"), .duplicate_reason, .as_listed_alone,
// .edit_window_closed, .not_found; .note_has_link is reserved for owner decision 14
```

```ts
// packages/contracts/src/modules/suspected-labels.ts (additions for this label type)
import { z } from 'zod'
import { Currency } from '../core/money'
import { Source } from '../core/enums'
import { ListingStub } from '../core/listing-stub'
import { SellerReplyReportsFamily, SellerReplyReportsPaymentKind, SellerReplyReportsLinkKind, SellerReplyReportsItemKind } from './seller-reply-reports'

export const SuspectedLabelsType = z.enum(['scam', 'trade_seller', 'flipper', 'too_good_to_be_true'])
export const SuspectedLabelsMode = z.enum(['shadow', 'reviewed', 'on'])
/** `report_plus_price` (rule B-P) is review-only: its mode is never `on`. */
export const SuspectedLabelsTgtbtPath = z.enum(['listing_pair', 'report_plus_listing', 'report_plus_price', 'reports_only'])
export const SuspectedLabelsTgtbtSignal = z.enum(['postage_only', 'pay_first', 'platform_claim', 'location_far', 'distant_copies', 'far_below_asks'])
export const SuspectedLabelsTgtbtSupport = z.enum(['away_story', 'off_platform_contact', 'thin_text', 'urgency'])
export const SuspectedLabelsSignalState = z.enum(['yes', 'no', 'unknown'])

const TownLabel = z.string().min(1).max(80)          // gazetteer or Facebook page name; never seller text
const AboutMiles = z.int().min(1).max(1000)          // whole miles, shown with "about"
const Buyers = z.union([z.literal('one'), z.literal('several'), z.int().min(10)]) // no exact count under 10

const GroupLabel = z.string().min(1).max(80)         // from asking_price_position.v_positions, never fixed text
const SinceEdited = z.boolean()                       // sticky text signal whose text was edited away (§4.1)

export const SuspectedLabelsTgtbtEvidenceItem = z.discriminatedUnion('code', [
  z.strictObject({ code: z.literal('postage_only_text'), sinceEdited: SinceEdited }),
  z.strictObject({ code: z.literal('pay_first_text'), kind: SellerReplyReportsPaymentKind.nullable(), sinceEdited: SinceEdited }),
  z.strictObject({ code: z.literal('platform_claim_text'), sinceEdited: SinceEdited }),
  z.strictObject({ code: z.literal('location_far'), listedIn: TownLabel, textSays: TownLabel, miles: AboutMiles, sinceEdited: SinceEdited }),
  z.strictObject({ code: z.literal('distant_copies'), towns: z.int().min(2), miles: AboutMiles, windowDays: z.literal(30) }),
  z.strictObject({
    code: z.literal('far_below_asks'), askMinor: z.int().min(1), currency: Currency,
    higherCount: z.int().min(1), n: z.int().min(10), groupLabel: GroupLabel,
  }),
  z.strictObject({
    code: z.literal('report'), family: SellerReplyReportsFamily, buyers: Buyers, viaCopy: z.boolean(),
    // place, miles and kind are non-null only when at least 3 independent people gave the same value (§4.3)
    place: TownLabel.nullable(), miles: AboutMiles.nullable(), listedIn: TownLabel.nullable(),
    kind: z.union([SellerReplyReportsPaymentKind, SellerReplyReportsLinkKind, SellerReplyReportsItemKind]).nullable(),
  }),
])
export const SuspectedLabelsTgtbtEvidence = z.array(SuspectedLabelsTgtbtEvidenceItem).min(2).max(8) // never fewer than two pieces

// The catalogue card's shared contract stays one union keyed by label type (`SP/atomic/modules.md:790-804`);
// this spec adds only its own member. The other members belong to their label types' specs.
export const SuspectedLabelsEvidence = z.discriminatedUnion('labelType', [
  z.strictObject({ labelType: z.literal('too_good_to_be_true'), items: SuspectedLabelsTgtbtEvidence }),
  // …members for 'scam', 'trade_seller' and 'flipper'
])

export const SuspectedLabelsCorrectionReason = z.enum([
  'seller_confirmed_as_listed', 'bought_as_described', 'low_price_explained',
  'collection_offered_elsewhere', 'protected_payment_offered', 'i_am_the_seller', 'other',
])
export const SuspectedLabelsCorrectionRequestInput = z.strictObject({
  source: Source,
  listingId: ListingStub.shape.sourceListingId,
  reason: SuspectedLabelsCorrectionReason,
  text: z.string().trim().max(1000).optional(),
  contactEmail: z.email().optional(), // public form only; encrypted at rest; deleted 30 days after closing
})
export const SuspectedLabelsApproveInput = z.strictObject({ candidateIds: z.array(z.uuid()).min(1).max(100), decision: z.enum(['approve', 'reject']) })
// SuspectedLabelsLabelRow (app.v_suspected_labels) is derived from the Drizzle view with drizzle-zod.
```

### 6.5 Additions to `warning-signs`

New `WarningSignsFactCode` values, with the rule owned by `warning-signs`:

| Code | Signal | Shown to users as a neutral fact? |
| --- | --- | --- |
| `pay_first_text` (replaces `deposit_request`) | L2 | Question 18 of the catalogue (`SP/atomic/modules.md:2257`). Proposed: yes, as "The advert asks for payment before viewing" |
| `platform_claim_text` | L3 | Proposed: internal only until calibrated |
| `off_platform_contact_text` | W2 | Internal only |
| `away_story_text` | W1 | Internal only |
| `urgency_text` | W4 | Internal only |
| `thin_text` | W3 | Proposed: yes, as a neutral fact in the owner's wording. Draft: "Very short description. Ask the seller for details before you travel or pay." Adverts that rely on photos otherwise pass silently (§1.2) |
| `viewing_offered_text`, `payment_on_collection_text` | X1 | Internal only |
| `protected_payment_text` | X2 | Internal only |

- The existing `ask_far_below_similar` and `low_ask_explained` facts give P. `low_ask_explained` gains a `reason`: `not_working`, `for_parts`, `named_fault`, `box_only`, `core_part_missing`, `part_not_included` (material state, which P honours), or `swap_or_trade`, `offers`, `cosmetic` (recorded, never honoured by P; §2.2 P notes). `part_not_included` comes from `parts-record` inclusion statuses (`SP/atomic/modules.md:675`).
- Each fact carries a rule ID, a version and its evidence quote, redacted and internal (`SP/atomic/modules.md:777`).
- Postage-only is **not** re-detected here: `warning-signs` republishes `listing-location`'s handover flag as the neutral fact "Postage only; no collection offered", citing that module's rule ID.

### 6.6 Events, idempotency, batches and stamps

- **Keys.** Both modules are cross-listing stages (catalogue rule 8, `SP/atomic/modules.md:68-77`).
  - The `seller-reply-reports` aggregator's key is `source + sourceListingId + sha256(sorted eligible report IDs and weights, counter weights, the cluster's member_set_hash, rule_version)`.
  - `suspected-labels`' evaluation key is `source + sourceListingId + evidenceHash + cardHash + inputs_hash`. `inputs_hash` covers the `warning-signs` fact versions, the `listing-location` resolution version, the copy cluster's `member_set_hash`, the index group's `as_of`, the report evidence's `as_of`, and the rule version.
  - Replays write nothing new.
- **Submitting** is idempotent through the unique key `(source, source_listing_id, reporter_user_id)`.
- **Batches.** Handlers take arrays of up to 500 listing IDs (`CLAUDE.md`; catalogue rule 9). Submit is per user action, then aggregated in batches.
- **Stamps.** Both modules are outside the T0–T7 chain. Each stores the T1 of its input and its own `done_at`, so its lag is measurable (catalogue rule 10, `SP/atomic/modules.md:94`).
- **Events are thin:** identifiers and times only (`CLAUDE.md`).
- **Publishing times (owner decision 27).** Report-driven evidence changes reach `app.v_suspected_labels` in two fixed daily batches (07:00 and 19:00 UK time), so the moment a mark appears does not point to the buyer who just messaged. Listing-signal changes stay immediate, and removals of any kind are immediate. Default until the owner decides: the batches.

### 6.7 Configuration (starting values, each with its basis)

`packages/config/src/modules/seller-reply-reports.ts`:

| Key | Value | Basis |
| --- | --- | --- |
| `minMinutesAfterOpen`, `maxDaysAfterOpen` | 5, 14 | §3.1 |
| `minAccountAgeDays` | 30 | §3.2; `docs/decisions.md:158` |
| `ratePerHour`, `ratePerDay` | 5, 15 | §3.3 |
| `burstCount`, `burstWindowHours` | 3, 24 (any account age) | §3.3 |
| `gemBurstCount`, `gemBurstWindowHours` | 2, 6 | §3.3 |
| `linkedNetworkMinDays`, `linkedNetworkWindowDays` | 2, 30 | §3.2 |
| `editWindowHours`, `reportThenBuyDays` | 24, 7 | §3.3 |
| `collectionElsewhereMinKm` | 50 | §2.2 L4 |
| `singleLevelMinWeight`, `multipleLevelMinWeight` | 1.0, 2.0 | §3.2 |
| `exactCountFrom` | 10 | §4.3; `docs/decisions.md:15` (aggregates at n≥10) |
| `reportedValueMinPeople` | 3 | §4.3 (place, miles and kind from reports) |
| `relistCarryDays` | 30 | §3.2; owner decision 24 |
| `retentionDaysAfterClose` | 90 | owner decision 15 |

`packages/config/src/modules/suspected-labels.ts` (label type `too_good_to_be_true`):

| Key | Value | Basis |
| --- | --- | --- |
| `locationFarBands` | `['50–100', '100+']` | §2.2 L4 |
| `distantCopiesMinSpreadKm`, `distantCopiesMinTowns` | 100, 2 | §2.2 L5; `SP/atomic/copy-advert.md:269` |
| `farBelowAskRatio`, `farBelowMinN` | 0.6, 10 (0.7 and 0.8 tested in shadow) | §2.2 P |
| `maxEvidenceBullets` | 3 | §4.3 |
| `gemEvaluationWaitSeconds` | 120 | §2.1; `docs/decisions.md:237` |
| `recheckAfterHours` | `[6, 24]` | §2.1 |
| `reportBatchTimesUk` | `['07:00', '19:00']` | §6.6; owner decision 27 |
| `correctionTargetShownWorkingHours`, `correctionTargetNotShownWorkingDays` | 4, 2 | §4.4 |
| `reviewedToOnMinCases`, `reviewedToOnMinPrecision`, `demoteBelowPrecision`, `demoteWindowCases` | 30, 0.9, 0.8, 30 | §5.4–5.5 |
| `pathModes` | all `shadow`; `report_plus_price` never `on` | `docs/decisions.md:166`; §4.1 |

`packages/config/src/modules/warning-signs.ts`: `thinTextMaxChars` 40 (§2.3); the phrase lists with their clause-level exclusions; `negationWindowWords` 5; the digit-for-letter map and the abbreviation list (§2.2, L2 notes).

---

## 7. The internal-only enforcement link

Everything in this section is internal. It is never shown or told to any user in any form (`docs/decisions.md:117-121`), and output-guard fails a build that leaks it.

**Listing review.** `review-console` gets these queues:
- listings with a sub-threshold report: a single report and no corroboration;
- B-P candidates and report-only candidates on gems, at top priority;
- `other` reports;
- burst, gem-burst and counter-report holds;
- listings edited after a mark showed or a report counted (§4.1);
- new listings with carried relist reports (owner decision 24);
- correction requests, marks already shown first (§4.4);
- in `reviewed` mode, candidates awaiting approval.

Reviewer outcomes set each report's `upheld` or `not_upheld`, which feeds reporter accuracy (§3.2). Repeated reports on one listing raise its place in the queue; they never mark it by themselves.

**Seller-level review, internal only and not built by default.**
- The owner keeps seller data for scam detection (`docs/decisions.md:30`).
- Seller-level signals may inform internal review only, never what users see (`docs/decisions.md:12,166`).
- If the owner approves such a use (catalogue question 38, `SP/atomic/modules.md:2277`) and `seller-key` exists (question 9, `:2248`), a restricted view `suspected_labels.restricted_seller_rollup` (catalogue rule 5, `SP/atomic/modules.md:47`), with `suspected-labels` added to rule 6's seller-data allowlist by the owner's answer to question 38, could count shown marks and upheld reports per internal seller key. It would only prioritise the review queue.
- It would never change a mark, a ranking, an alert or any user-facing output. Nothing in it would be derived into a listing-level signal.
- Default: not built until the owner answers catalogue questions 9 and 38. A DPIA for it is listed in `docs/legal-review.md` (§11, item 18) and runs only if the owner asks (`docs/decisions.md:188`). Only 3 of 20 rows carry a seller at all (`docs/fb-actor-reference.md:297`).

**Actions against abusive reporters**, under "Fair use, suspension and bans" (`docs/decisions.md:110-129`):
- **Rules, in `account-integrity`, shadow first** (task 4.3p):
  - a high not-upheld rate over at least 5 resolved reports;
  - repeated rate-limit hits;
  - bursts from linked accounts;
  - correction-request spam from one account.
  - Report-then-buy is not an abuse signal (§3.3).
  - Thresholds are the owner's to approve (catalogue question 37, `SP/atomic/modules.md:2276`).
- **Steps, least first:**
  1. weight 0 on future reports, recorded as an `account-integrity` `limit` action, with the owner's short notice naming the Fair Use Policy (`docs/decisions.md:121`);
  2. reporting disabled, a feature limit short of suspension (`docs/decisions.md:127`);
  3. a fair-use suspension or ban.
  These follow the acceptable use policy's 9.1–9.2 on false reports and misuse of report routes (`docs/policies/acceptable-use.md:87-88`).
- **Each action** is written through `account.setStanding()` with an internal reason, the evidence and an audit row.
- **The user sees only** the short notice that names the policy, and may ask for a review within 30 days (`docs/decisions.md:121`).
- **Linked accounts** are detected by `account-integrity` (email hash, card fingerprint, and, for counting reports, a shared device cookie or network), which is also how "one person counts once" works (§3.2).

**No action against sellers.** Nabvy has no seller accounts and takes no step against a seller. The mark attaches to a listing. Nabvy passes nothing to Facebook, banks or the police: users are signposted to report there themselves (§3.1). Sharing scam signals with banks or Meta, as Meta's FIRE exchange with UK banks does (big-tech researcher), is an owner and legal point, not built.

**The asking-price index.** Marked listings are not excluded from `asking-price-index` in version 1. Excluding them would feed the mark back into its own price input. This is revisited after calibration (owner decision 23).

---

## 8. Fixtures and tests

Layout follows catalogue rule 16 (`SP/atomic/modules.md:129-153`): `services/<module>/test/fixtures/<stage>.fixtures.ts`, `pass-rates.json`, and `cases/<case-id>/{input,expected}.json` with `notes.md`. Recorded cases point at `RUN/` and listing IDs. Synthetic cases carry `"synthetic": true` and name the row they were built from. Synthetic positives are **never** counted in calibration.

### 8.1 Hard negatives (expected: no mark)

Recorded rows first, then synthetic honest-seller cases built from them.

| Case | Row and line | Why it is hard | Expected |
| --- | --- | --- | --- |
| `hn-bank-transfer-on-pickup` | 1, `RUN/dataset.json:139` | "bank transfer" at handover; template leftovers; "Fixed / ONO" | L2 no (excluded); X1 yes; no mark |
| `hn-abroad-but-test-welcome` | 3, `:874` | A scam backstory next to "Collection only - welcome to test" | W1 yes; X1 yes; no mark |
| `hn-cheap-faulty` | 4, `:1173` | A cheap ask explained by a fault | P no (explained); no mark |
| `hn-local-delivery-trade` | 11, `:3722` | Text adds delivery; trade "we buy" boilerplate | L1 no; no mark |
| `hn-local-delivery-17` | 17, `:5779` | "Can deliver locally or collection" | L1 no; no mark |
| `hn-district-in-city` | 14, `:4807` | "E1 (Whitechapel)" inside London; "cash on pickup" | L4 no; X1 yes; no mark |
| `hn-no-scammers-at-sign` | 18, `:6135` | "No Scammers"; "@ BACK PANEL" | W2 no; no mark |
| `hn-service-advert` | 20, `:6713` | A £25 service advert | Not judged (noise); no sheet |
| `hn-same-title-different` | 7, 9 and 19 | Three "Gaming pc" titles at different prices, towns and texts (`SP/atomic/modules.md:725`) | L5 no; no mark |
| `hn-structural-conflicts` | all 20 | Every row carries an actor `locationDetails` conflict (`docs/fb-actor-reference.md:233`) | Never read as L4; no mark |
| `hn-whole-run` | all 20 | The whole run | 0 marks, 0 candidates |
| `hn-gem-one-report` | synthetic, from row 13 | P yes (n=14, lowest ask) and one full-weight report in any family | No mark (a B-P candidate at the top of the review queue) |
| `hn-postage-bank-transfer` | synthetic, from row 13 | "Postage only, tracked. Payment by bank transfer before sending." An honest private seller who posts | L1 yes; L2 folded into L1; no mark |
| `hn-postage-goods-and-services` | synthetic, from row 13 | "Postage only, PayPal Goods and Services" | L1 yes; X2; no mark |
| `hn-moved-cheap` | synthetic, from row 13 | Description adds "Just moved to Leeds."; P yes | L4 yes; no mark |
| `hn-autofill-cheap` | synthetic, from row 13, field on an Isle of Wight page | "Item is in Manchester"; P yes | L4 yes; no mark |
| `hn-gpu-removed` | synthetic, from row 3 | "RTX 3090 build, GPU removed, rest of the PC £450" | P unknown; no mark |
| `hn-gpu-not-included` | `fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:180` | "RTX 4090 not included" | P unknown; no mark |

### 8.2 Synthetic positives (unit tests only)

| Case | Built from | Change | Expected |
| --- | --- | --- | --- |
| `sp-postage-and-pay-first` | row 13 (Chichester, `:4453`) | Description: "Postage only. PayPal friends and family only, before sending." | L1, L2 (friends and family) → path A |
| `sp-f-and-f-despite-viewing` | row 3 | Row 3's text ("welcome to test") plus "Postage only, PayPal friends and family before sending" | L1, L2 (friends and family), X1 → path A; `x1_contradicted` logged |
| `sp-fb-delivery-far-below` | row 3 | Text "Facebook delivery available, secure payment link"; a synthetic index group n=14 with the ask lowest, parts check passed | L3, P → path A (X1, if kept, is logged as `x1_contradicted`) |
| `sp-iow-text-manchester-pay` | row 13, location set to an Isle of Wight page | Text "Item is in Manchester. Courier only, once paid." ("courier" without "only" would not set `courier_only_text`, `SP/location/listing-location.md:163`) | L4 (100+), L1; L2 folded into L1 → path A |
| `sp-iow-silent-two-reports` | the same Isle of Wight listing, text silent | Two reporters, 30+ days old, independent: `collection_elsewhere` Manchester, both answering "No" | Location `multiple` → path C |
| `sp-iow-one-report-far-below` | as above | One reporter; P yes | No mark; review queue (B-P, top priority) |
| `sp-iow-one-report-far-below-away` | as above | One reporter; P yes; W1 "working away" | B-P candidate; shown only after a reviewer approves it (`reviewed` mode) |
| `sp-chichester-postage-reports` | row 13 | Two `postage_only` reports, neither answering "PayPal Goods and Services or card"; `shippingOffered` false | Path C |
| `sp-copies-far-below` | row 5 | A 6-member cluster, spread 400 km; P yes; this listing not the possible original | L5, P → path A |
| `sp-text-copies-price-1-apart` | row 5 | The same description at prices £1 apart in 3 towns 200 km apart | L5 yes (S5 text-copy pair); with P yes → path A |
| `sp-clone-original-exempt` | row 5 | A genuine listing cloned 2 days after Nabvy first fetched it, into 5 towns | Original exempt from L5 and from spread reports; clones L5 |
| `sp-report-spreads-per-member` | a 3-member cluster (Isle of Wight, Chichester, Manchester) | One Manchester report ("No") on the Isle of Wight copy, plus L2 on all | Counts on the Isle of Wight and Chichester copies; not on the Manchester copy |
| `sp-two-families-two-people` | row 13 | Person 1 `postage_only`; person 2 `payment_first` | Path C |

### 8.3 Synthetic negatives and boundaries

| Case | Expected |
| --- | --- |
| Postage-only text on a listing with `shippingOffered` true | L1 no; a postage report is not counted |
| "Courier only" on a listing with `shippingOffered` false | L1 yes |
| "Collection or post" | L1 no |
| "p0stage 0nly" | L1 yes (digit-for-letter map) |
| "No deposit needed" | L2 no |
| "Collection from Chichester. Bank transfer only, no cash." | L2 no (no before-cue; bank transfer is not risky at any time) |
| "£100 deposit by bank transfer to hold, rest on collection" | L2 yes (`deposit`); X1 no |
| "Can't do in person, bank transfer before I post" | L2 yes (negated exclusion) |
| "No deposit games, bank transfer before I post" | L2 yes ("no deposit" excludes only `kind = deposit`) |
| "F n F", "PPFF", "B/T", "BACS" in a payment clause asking to pay first | L2 yes, each |
| "BT" in "Belfast BT1" with no payment clause | L2 no |
| Far below similar asks, nothing else | No mark (price alone) |
| Far below similar asks with "swaps considered" | P yes (swap wording never explains a low ask) |
| Own condition group n=4; pooled used groups n=14 | P `unknown` (default of owner decision 26) |
| Far below similar asks and thin text | No mark (support does not qualify); the gem candidate is not promoted (§2.1) but stays in results and alerts |
| Gem candidate in an alert | `alert-router` waits up to 2 minutes for the evaluation row, then sends whatever the result |
| Distant copies alone | No mark (the copy flag only) |
| A single report, full weight | No mark; review queue |
| Two reports from linked accounts | Counted once → `single` → no mark alone |
| Two 30-day accounts sharing a device cookie | Counted once |
| A report from a 29-day-old account | Weight 0; stored for review and calibration |
| Four 2-day-old unlinked accounts reporting 61 minutes apart | Level `none` |
| A report 2 minutes after the open, or with no open | Weight 0 |
| 3 reports within 24 hours from 45-day-old accounts | Held; no mark until released |
| 2 reports on a gem candidate within 6 hours from 60-day-old accounts | Held for review |
| Report then "bought" within 7 days | Weight removed; outcome `unknown`, never `not_upheld`; the `item` family exempt |
| `as_listed` counter weight ≥ report weight | Level unchanged; candidate held for review (`counter_report`) |
| A `collection_elsewhere` report at 30 km | Not counted; an internal hint only; location unchanged |
| Two "Yes" `collection_elsewhere` reports at 150 km | Not counted; no mark |
| Two "No" `collection_elsewhere` reports at 150 km | Path C |
| Row 4 with two `faulty_or_missing_parts` reports | Not counted (the fault is in the advert); no mark |
| Two reports naming Manchester | Bullet reads "somewhere else, more than 30 miles from …"; Manchester not named |
| Three independent reports naming Manchester | Bullet names Manchester |
| An edit that removes "postage only" after a mark showed | L1 stays `yes`; review queue; the bullet ends "(since edited)" |
| A new candidate whose evidence codes include the approved ones | Approval carries over |
| A delete-and-repost with a matching description after one counted report | Carried report not shown and completes no path; the new listing tops the review queue |
| Trade boilerplate "We buy and part-exchange, 7-day warranty on all purchases" on a priced sale with L1 and L2 (friends and family) | Judged; path A |
| L4 decided by AI only | Not counted until the AI lane is measured |
| `listing-location` off | L1 and L4 `unknown`; no path relies on them |
| `seller-reply-reports` off | Only path A; no sheet |
| Text `partial` | Text signals `unknown`, never `no` |
| An `other` report carrying any free text | Refused by the contract (strict object; owner decision 14) |
| A banned reporter | Reports voided; evidence recomputed |

### 8.4 Stages and pass rates

| Module | Stage | Cases | Rule |
| --- | --- | --- | --- |
| `warning-signs` | `tgtbt-facts` | The phrase cases for L2 (exclusions, negation, obfuscated spellings, the L1 fold), L3, W1–W4, X1 and X2, and the `low_ask_explained` reasons, including rows 1, 3, 4, 14 and 18 | Does not fall below the recorded rate |
| `seller-reply-reports` | `gate`, `aggregate`, `spread` | §8.2–8.3 report cases | Does not fall below the recorded rate |
| `suspected-labels` | `tgtbt-combine` | §8.1–8.3 | Hard negatives at 100%, always |
| `suspected-labels` | `tgtbt-evidence` | Evidence items render to the approved templates; each parameter comes from its source | Does not fall below the recorded rate |
| both | `privacy` | Every user-facing row | **100%, always**; `--accept-drop` never accepted |

### 8.5 Module tests (catalogue rule 16) and output-guard

**`seller-reply-reports` tests:**
- one report per user per listing;
- edit window;
- withdraw removes the weight;
- the weight formula at its boundaries (29 / 30 days);
- linked accounts count once, at the lowest weight, including a shared device cookie or network;
- the burst hold (24 hours, any age) and the gem burst hold;
- the counter-report hold, and that counter-reports never lower a level;
- report-then-buy sets outcome `unknown`;
- the second answers ("Yes", "No", "Didn't ask"; the postage payment answer) and the `not_as_described` check;
- carried relist reports are never shown and complete no path (default of owner decision 24);
- a banned reporter's reports are voided;
- the per-member location distance, and the possible original never receives spread reports;
- no sheet when `messagingEnabled` is false;
- in shadow, no user-facing evidence rows, and the report UI and "Your reports" for testers only;
- when off, `app.v_seller_reply_reports_mine` returns no rows;
- the aggregator is idempotent on replay;
- account deletion purges within 24 hours;
- `erase()`;
- `v_reporter_signals` is granted only to `account-integrity` and the admin role.

**`suspected-labels` tests:**
- each path at its boundary;
- X1 blocks no path A pair; X2 blocks path A pairs with L1; L4 counts only with L1, L2 or L3;
- P never counts in path B; B-P candidates show only with an approval and never move to `on`;
- report-only candidates on gems, and counter-reported candidates, show only with an approval in any mode;
- sticky text signals and "(since edited)"; approvals carry over when codes are kept;
- the P parts check and material-state explanations;
- an evidence array always has at least 2 items;
- per-path modes: `reviewed` shows only approved candidates;
- report-driven additions publish only in the daily batches; removals are immediate;
- demotion;
- a correction wins over recompute; a reviewer's "keep" survives edits;
- the app view is empty in shadow and when `listing-suppression` is off.

**`notifier` tests** (task 1.7o): Telegram callbacks call the same report procedure; a removed mark is edited out of sent Telegram alerts; email alerts carry no bullets.

**New output-guard checks** (`SP/atomic/modules.md:1049-1065`), which fail CI:
- the label starts with "Suspected" (option B, if chosen, needs `docs/decisions.md:158` amended first, §4.2);
- no mark with fewer than 2 evidence items;
- no report count under 10, and no dates or times of reports;
- no report-derived place, distance or kind with fewer than 3 agreeing reporters;
- no report free text and no reporter-derived field in any `app` view except the reporter's own;
- no weight, eligibility, rate limit, hold or enforcement state in any user-facing output (`docs/decisions.md:129`);
- no seller field;
- no other listing's town, ID or link;
- no cluster key;
- no place finer than a town, area or district;
- none of "worth", "fair", "value", "market price", "scam", "scammer", "fraud" or "fake" in a rendered `too_good_to_be_true` chip, evidence bullet or panel line. The §3.1 signposting box is exempt for the proper name "Report Fraud", and other label types keep their own approved wording ("Suspected scam" is allowed, `docs/decisions.md:13`);
- no user-facing text that relies on `shippingOffered` or the checkout flag (§2.1);
- no numeric score.

**Playwright** (task 4.1m):
- the chip and panel;
- the sheet appears only after a `notifier` `/go/<token>` open and 5 minutes;
- one tap saves;
- "Your reports" shows statuses;
- "Hide suspected" hides shown marks with a visible count;
- the map marker style sits at the town centroid.

---

## 9. Owner decisions needed

Each item has a default, used in shadow until the owner decides. Each goes to `docs/questions.md`. Where the default is the conservative option, it shows less, keeps less or marks less.

| # | Decision | Default |
| --- | --- | --- |
| 1 | Label wording: option A "Suspected too good to be true:"; option B "Too good to be true?"; or option C, "Suspected too good to be true:" only when P = `yes` is among the evidence and otherwise "Suspected risky sale:" followed by the facts, with the panel line "Collection or payment may not work as the advert suggests." Both option C forms start with "Suspected", so output-guard is unchanged (§4.2) | A (B needs `docs/decisions.md:158` amended), shown only in shadow and on founder-only screens until approved. The owner chooses the wording |
| 2 | Evidence templates (§4.3), the line under the bullets and the safety line | The drafts, unapproved and unshown |
| 3 | Report chip wording, including the second questions ("Could you still see it and pay when you collect there?", "How did they want paying?") and the `payment_first` small print, and whether to include "Nothing odd" as a counter-report. Codes and "established" are also catalogue question 43 (`SP/atomic/modules.md:2282`) | The drafts; include "Nothing odd" (it never lowers a level; it holds a candidate for review, and gives a calibration denominator) |
| 4 | Alerts for marked listings | Sent, with the mark shown; an opt-in "Don't alert me about suspected listings", off by default |
| 5 | A follow-up message when a mark appears after an alert | None; card and feed only. A removed mark is edited out of sent Telegram alerts (§4.6) |
| 6 | The "Hide suspected" filter | Off by default; a visible count; feed and map only |
| 7 | Keep listings that meet path A, even in shadow, out of top picks and by-catch suggestions (`docs/decisions.md:171`); report-path candidates only once approved in `reviewed` mode or shown with their path `on` | Yes, promotion only; they stay in results and alerts |
| 8 | Thresholds: 50 km, 100 km spread, 0.6 × median at n≥10, account age (30 days; catalogue question 43), weights, rate limits, burst holds, 5 minutes to 14 days, 3 agreeing reporters for a named place or kind, the 2-minute gem wait, the 4-working-hour correction target | Starting values, calibrated in shadow |
| 9 | "Two independent pieces of evidence" as the rule for every path, the price never the second piece for a report, and a single report never marks | Yes |
| 10 | Does paying status add report weight? | No; card fingerprints, device cookies and networks only to spot one person behind several accounts |
| 11 | Report-then-buy removes a report's weight (except "not as described") without counting against the reporter | Yes; outcome `unknown` |
| 12 | Staged go-live per path (shadow, reviewed, on) and the targets of §5.4–5.5 | Yes |
| 13 | Does go-live wait for a legal review of the wording (items 13 and 22, LR-02)? | The owner decides when flipping a path; the review runs only if requested (`docs/decisions.md:188`) |
| 14 | This specification replaces the catalogue's `seller-reply-reports` placeholder card; the `other` chip's free text | Replace the card; `other` saved without free text (the placeholder's "No free text", which keeps less) until the owner decides |
| 15 | Retention of reports, notes and correction requests | 90 days after the listing is gone or the case is closed, then anonymous; account deletion purges within 24 hours; contact emails deleted 30 days after closing; request records kept 12 months (`docs/compliance.md:9`) |
| 16 | The team's reports during the test hunt | Only from genuine contact as buyers; no scripted or pretend messaging of sellers |
| 17 | The owner's two real example listings as fixtures | Ask the owner for the links; synthetic cases until then |
| 18 | The mark in Business exports, feeds and the public API | Left out |
| 19 | An internal seller-level rollup for review priority (§7) | Not built (needs `seller-key` and the owner's answers to catalogue questions 9 and 38) |
| 20 | Photo fingerprints as a signal | Left out of version 1 (`docs/decisions.md:23`; `docs/questions.md`, `stock_photo`) |
| 21 | Signposting text after payment or link reports (Report Fraud, the user's bank, reporting to Facebook) | Shown, in the owner's wording, after the primary pages are checked |
| 22 | A push notification when a report's status changes | None; status in the app only |
| 23 | Exclude marked listings from the asking-price index | No in version 1 |
| 24 | Carry counted reports across a `relist-merge` group whose basis is a matching description, for 30 days, and show them as ordinary report bullets on the current listing, never as "relisted", "earlier listing" or with a date (§3.2) | Not shown and completing no path, following `docs/decisions.md:14`; they put the new listing at the top of `v_review_queue`, and in `reviewed` mode the reviewer can see them |
| 25 | Rule B-P: may one report plus the low price ever show a mark? The critics disagreed: one wanted it never to mark (every bargain has P, and a rival targets bargains), the other wanted it shown after review. The trade-off is warning buyers about a real scam that only one buyer has reported, against a rival or a misunderstanding marking an honest bargain (§4.1) | Shown only after a reviewer approves it, only with a supporting signal (W1–W4) and the report-path checks of §5.5, and never automatically. The more conservative alternative is review queue only, never shown |
| 26 | When the listing's own condition group has n < 10, compute P against the pooled used groups for the same item and context at n≥10, worded "the same model, used" (§2.2 P notes) | No: `docs/decisions.md:15` says "same spec and condition", so P stays `unknown` |
| 27 | Publish report-driven evidence changes in two fixed daily batches (07:00 and 19:00 UK time), so a mark's timing does not point to one buyer (§6.6) | Yes; listing-signal changes and all removals stay immediate |

---

## 10. Backlog tasks

**IDs.** These extend build-pack tasks with letter suffixes, as `docs/backlog.md` does, and avoid every ID the drafts hold as of 11:58:
- **1.7** is "Risk screener v0", which `warning-signs` and `suspected-labels` replace (`docs/backlog.md:29`). `copy-advert` holds 1.7a–1.7d (`SP/atomic/copy-advert.md:650-653`). The audit `SP/atomic/changes.md:22,74,102,109,112` gives 1.7e to `noise-filter`, 1.7f to `warning-signs`, 1.7g to `suspected-labels`, 1.7i to `demand-signals` and 1.7j to `seller-reply-reports`, and reserves 1.7h. This design therefore specifies **1.7j** (the module it fills in) and takes **1.7k–1.7s** for the rest. The IDs 1.7e–1.7n proposed before that audit would now collide.
- UI work extends **4.1**. 4.1a–4.1l are held by the search, map and routes design (`SP/geo/search-map-routes.md:1047-1071`), which also names an optional 4.1n (`:463`); 4.1c is also held by `listing-location`; the audit gives 4.1d and 4.1e to `listing-feedback` and `pickup-routes` (`SP/atomic/changes.md:29`). This design takes **4.1m**.
- `account-integrity` holds 4.3c–4.3o in the account-sharing design (`SP/sharing/account-sharing.md:801-813`), so this design takes **4.3p**.
- Review-console work takes **4.5b** (4.5a is SEO price pages).
- The rtx3090 acceptance run is task **1.10** (`SP/atomic/actor-integration.md:419,448`).

**Standing items.** Every task's definition of done also includes:
- types in `packages/contracts/src/modules/<module>.ts` and the schema in `packages/db`;
- fixture tests;
- lint and typecheck clean;
- the module README in the catalogue template, with thresholds and their basis;
- `pnpm db:dry-run` green;
- a branch `task/<id>-<module>` with one pull request;
- the coordinator's progress row (`docs/decisions.md:76-77`).

| ID | Task | Depends on | Definition of done (beyond the standing items) |
| --- | --- | --- | --- |
| **1.7j** | `seller-reply-reports`: core in shadow (the catalogue placeholder, specified by §6.2) | 0.2, 0.3, 1.9a, 1.9b, 1.3a, 1.3c, 1.5l, 1.2f; `notifier`'s open record (4.3g); soft: 1.7a (`copy-advert`), `relist-merge`, `listing-feedback` (1.7s), `account-integrity` (4.3c, 4.3p) | Scaffold with `pnpm new:module seller-reply-reports`. The tables, views, events and functions of §6.2; the gate on `notifier`'s open record, weights, levels, second answers, per-member location distance, burst and counter-report holds, report-then-buy, carried relist reports, bans and withdrawal. Stages `gate`, `aggregate`, `spread` and `privacy` pass. The idempotency, switch and db tests pass. The `v_reporter_signals` grants are tested. Reader grants on `listing_location.v_resolved`, `location.v_places` and `copy_advert.v_members` are added by those modules' own sessions. Works with synthetic users until auth lands. Ships `shadow` |
| **1.7k** | `warning-signs`: the "too good to be true" text facts, in shadow | The `warning-signs` core task (1.7f in `SP/atomic/changes.md:109`; if none exists when this starts, 1.7k scaffolds the module); 1.3c (`detail-evidence`); 1.5l (`listing-location`, for the republished handover fact) | Codes of §6.5 with rule IDs, versions and clause-level exclusions; `deposit_request` replaced by `pay_first_text`; the L2 notes (negation, obfuscated spellings, the L1 fold); X2; the `low_ask_explained` reasons. Stage `tgtbt-facts` passes. Rows 1, 3, 4, 14 and 18 give the §8.1 results. Text on `partial` or `missing` descriptions gives `unknown`. Ships `shadow` |
| **1.7l** | `suspected-labels`: the `too_good_to_be_true` type in shadow | The `suspected-labels` core task (1.7g in `SP/atomic/changes.md:112`); 1.7k, 1.7j, 1.5l, 1.7a; the `asking-price-position` task; `listing-assessment` and `parts-record` (soft) | Rules and modes of §6.3, including B-P as review-only; `evaluations`, `candidates`, `approvals` (with carry-over), `correction_requests` and `reviews`; the paths; X1 and X2; the P parts check; sticky text signals; the rechecks at +6 h and +24 h; the degrade rules; `v_candidates`, `v_review_queue`, `v_calibration` and `v_shadow_metrics`; the app view empty. Every §8.1–8.3 case passes; hard negatives at 100%. Evidence items validate against `SuspectedLabelsTgtbtEvidence`. Ships every path in `shadow` |
| **1.7m** | Shadow calibration on the rtx3090 hunt | 1.7l; 1.10 (the hunt running); 4.5b (labelling UI) | Every test-hunt listing in the §5.3 samples labelled by two reviewers (the 300-listing bound is completed in `reviewed` mode), with report-path candidates labelled without the reports that formed them. A calibration report in the `suspected-labels` README: per-path counts, precision with Wilson intervals, the false-mark bound, signal and unknown rates, P at cuts 0.6, 0.7 and 0.8, the report metrics of §5.2, and thresholds recalibrated with their new basis (as rule version 2 if changed). Labelled cases added as fixtures, and `pass-rates.json` recorded. Recommendations for owner decisions 1–13 and 24–27. Ends with the owner's go-live decision for each path (1.7n) |
| **1.7n** | Go-live: user-facing mark, report a mistake, reviewed mode | 1.7m; owner decisions 1–4, 12 and 13 recorded in `docs/decisions.md`; `output-guard`; `listing-suppression` on; the `app` schema (coordinator) | `app.v_suspected_labels` rows for this type under the §6.3 conditions; `approve()`; `requestCorrection()` in-app and from the public form, with the 4-working-hour target for shown marks; the daily report batches; the demotion job; the output-guard checks of §8.5 added and passing, with deliberately bad fixtures failing them. Each path moves `shadow → reviewed` only by the owner's audited action once §5.5 holds |
| **1.7o** | `notifier`: `/go/<token>` for card and pasted-link opens; mark, report and "Report a mistake" buttons; Telegram callbacks call the report procedure; Telegram edits when a mark is removed; email alerts without bullets | 1.8, 4.3g, 1.7l | Renders only `app.v_suspected_labels` rows; callbacks validated with the contracts; the `notifier` tests of §8.5; one PR in `services/notifier` |
| **1.7p** | `want-manager`: "Hide suspected" and "Don't alert me about suspected listings" preference keys | 1.7l | One PR in `services/want-manager` |
| **1.7q** | `spec-match`: apply "Hide suspected" from `app.v_suspected_labels` | 1.7p | One PR in `services/spec-match` |
| **1.7r** | `alert-router`: read the alert opt-out (only if owner decision 4 adopts it) and the gem-candidate wait of §2.1 | 1.7l, 1.7p | One PR in `services/alert-router` |
| **1.7s** | `listing-feedback`: the view of `bought` verdicts for report-then-buy | the `listing-feedback` core task | `v_bought_for_reports` (user, listing, at) granted only to `seller-reply-reports`; db test on the grant |
| **4.1m** | Web UI for the mark and reports (web app only) | 4.1, 4.1c; 1.7j, 1.7l, 1.7o | The report bar, driven by `notifier`'s open record, and the one-tap sheet (§3.1) with its second questions, small print and signposting; "Your reports" with withdraw; the chip and panel; "Report a mistake" in-app and at `nabvy.com/report-a-mistake` with Turnstile; the map marker style; the "Hide suspected" filter UI. The Playwright checks of §8.5 pass. All procedures validate with the contracts, check the session and call module functions inside `withUser` (`CLAUDE.md`) |
| **4.3p** | `account-integrity`: report-abuse rules and linked groups | 4.3c, 4.3d, 4.3i, 4.3j; 1.7j | `linkedGroupOf(userIds)` returning opaque group IDs, never keys, including a shared device cookie or network (§3.2). The report-abuse rules of §7, versioned, in `shadow`. The steps weight-0 (a `limit` action with the notice), reporting disabled, then fair-use suspension. The notice carries the policy name only. Synthetic accounts cover each rule at its boundary. Nothing acts until the owner approves thresholds (catalogue question 37) |
| **4.5b** | `review-console`: queues for "too good to be true" | 4.5; 1.7j, 1.7l | Queues for approvals (reviewed mode; B-P and gem report-only candidates at top priority), correction requests (4-working-hour target on shown marks, 2 working days otherwise), sub-threshold reports, `other` reports, burst and counter-report holds, edits after a mark showed, and carried relist reports. The report-path approval checks of §5.5. The two-reviewer calibration labelling of §5.3, blind to each other. Outcomes call `applyCorrection()`, `approve()` and `resolve()`, are audited and export fixtures. Reporter identity only through the admin-only path, with reads logged (catalogue question 10) |

---

## 11. Items for legal review

These are listed only, with no analysis and no review run (`docs/decisions.md:188`). They are additions to `docs/legal-review.md` from its next free number, 23. The coordinator renumbers them if the `listing-location` items land first (`SP/location/listing-location.md:1068-1083`). Items 13 and 22 and LR-02 already cover the core points.

1. Showing "Suspected too good to be true" with evidence on identifiable listings, and option A against option B wording (extends item 13 and LR-02).
2. Counting users' reports towards a mark other users see, shown as attributed claims ("a buyer who messaged the seller says …") (extends item 22).
3. Storing reports that allege a seller asked for money first or misled buyers, including free-text notes if owner decision 14 allows them; the brief's point on criminal-offence data.
4. Showing a mark automatically, with no human review, once a path is `on`.
5. Silently giving weight 0 to, voiding or holding users' reports, and not telling reporters why.
6. Answering a seller's or a reporter's request for a copy of personal data where it covers reports (compare LR-32).
7. The public report-a-mistake form for non-users, including storing and keeping a contact email.
8. Retention of report rows, reporter links, notes and correction requests.
9. Treating linked accounts (email hash, card fingerprint, shared device cookie or network) as one reporter (compare LR-33 and item 21).
10. Account actions for false or abusive reports under the acceptable use policy 9.1–9.2.
11. Signposting users to Report Fraud, their bank and Facebook's reporting tools.
12. Stating what a listing's description offers ("postage or courier only", "Facebook delivery") as evidence in a mark.
13. Leaving listings that meet path A, even in shadow, and approved report-path candidates, out of top picks and by-catch suggestions.
14. Handling of reports and correction requests, including if Irish users are added.
15. Any future sharing of mark or report data with banks, Meta or the police.
16. Including or leaving out the mark in Business exports, feeds and the public API.
17. The team's reports about real sellers during the test hunt.
18. A DPIA for any internal seller-level rollup of marks and reports (§7).
19. Carrying reports across a relist group to the current listing (owner decision 24).

---

### Sources read for this design

- **Nabvy documents:**
  - `CLAUDE.md`;
  - `docs/decisions.md` (whole; key lines 12–23, 30–36, 58–80, 110–129, 131–142, 144–171, 181–188);
  - `docs/backlog.md`, `docs/questions.md`, `docs/legal-review.md`;
  - `docs/web-app.md:28-50`, `docs/engineering.md:65-67`, `docs/security.md:1-30`, `docs/compliance.md:34-37`;
  - `docs/packs/gpu-pc.md:36-49`;
  - `docs/policies/terms.md:55,250-264,345-350`, `docs/policies/acceptable-use.md:83-88`;
  - `docs/fb-actor-reference.md` §3 (lines 204–368);
  - `packages/contracts/src/core/*.ts`.
- **The recorded run:** `RUN/dataset.json`, the rows cited above.
- **Drafts in `SP/`:**
  - the catalogue `atomic/modules.md` (rules 1–16; cards `location`, `parts-record`, `listing-assessment`, `noise-filter`, `copy-advert`, `relist-merge`, `asking-price-*`, `warning-signs`, `suspected-labels`, `want-manager`, `spec-match`, `alert-router`, `notifier`, `listing-feedback`, `seller-reply-reports`, `listing-suppression`, `seller-rights`, `output-guard`, `review-console`, `account-integrity`, `seller-accounts`; open questions);
  - `atomic/copy-advert.md`;
  - `atomic/actor-integration.md:419,448`;
  - `atomic/changes.md:22,29,74,102-114` (the audit's task IDs);
  - `geo/search-map-routes.md:463,1047-1071` (task IDs);
  - `location/listing-location.md`;
  - `sharing/account-sharing.md:260,478-480,569,801-813`.
- **Actor brief files:** `fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:140-142,180`; `fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:283-285`.
- **The researchers' and critics' outputs:**
  - `tgtbt/baserates.mjs` and `tgtbt/baserates.json`;
  - `tgtbt/scam-patterns-queries.sql`;
  - `tgtbt/report-flows-queries.sql`;
  - their findings as passed to this session.
  Their read-only SELECTs on `apify_gateway.items` (jobs 6 and 15, the same 20 listings) matched the fixture counts, and the critics' SELECTs give the `shippingOffered`, checkout, postage, bank-transfer and swap counts cited in §2. This session ran no queries of its own.
- **Web sources:** as cited inline. The researchers could not fetch most primary pages (UK Finance, Which?, Action Fraud, Citizens Advice, Facebook, eBay and Gumtree were blocked). Those facts come from search summaries of the cited URLs, and quotes are paraphrases. Check each primary page before any wording shown to users.
