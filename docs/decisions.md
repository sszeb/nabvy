# Decisions and constraints

These are standing rules. Change them only with a human decision recorded here.

## Precedence: the Facebook actor brief

**Owner's decision, 2026-09-24.** Where this build pack conflicts with the Facebook actor brief in `sebtimize/fb-scrap-engine` (`docs/HANDOFF.md`, sections "Rules" and "The app: what we want it to do, and what the data allows", and the designs they link; reading list and rules in `docs/fb-actor-sources.md`), the brief wins because it is more up to date. The brief's `docs/APP_INTEGRATION_GUIDE.md` and `docs/design/COPY_ADVERT_SPAM.md` do not exist yet; Nabvy writes its own integration plan and copy-advert design either way ("The actor is a tool" below). The build-pack documents affected below are rewritten to match before task 0.2 (contracts) starts. Until then, read the build pack through this table.

| Topic | Build pack says | Brief says (wins) |
| --- | --- | --- |
| Seller data | Never store seller names or profile links; hash public seller IDs before storage (`CLAUDE.md`). Raw provider responses kept 30 days as snapshots (`CLAUDE.md`, `docs/modules.md`) | Keep seller data for internal use only, in a restricted private schema the Data API cannot reach. Never show seller identity (names, IDs, pictures, account links) or anything derived that identifies a seller. The internal seller key would be an HMAC of the ID with a secret held outside the database, built only after the DPIA (`SELLER_DATA.md` §3.2). Raw snapshots hold the actor's seller fields, so they count as part of that restricted store. Minimisation still applies: no measured use needs names or pictures (`SELLER_DATA.md` §5). *Superseded for storage by "Actor data kept in full" below: everything is kept; only what users see is restricted.* |
| Seller-derived flags | Risk flags `new_seller`, `reused_photos` and `stock_photo` are computed from seller hashes (`docs/packs/gpu-pc.md`, `docs/modules.md`) | Public tables never hold a seller key or any flag derived from seller keys; fraud signals are listing-level only (`SELLER_DATA.md` §3.7, §5) |
| Labels and scores | Risk flags are signals, never accusations; wording avoids calling a seller a scammer (`docs/compliance.md`). A numeric risk score (0..1) reduces the deal score (`docs/contracts.md`, `docs/valuation.md`) | "Suspected scam", "suspected trade seller", "suspected flipper" and similar are allowed, each worded as a suspicion, shown with its evidence, from a documented rule with calibrated thresholds, with a report and correction route, never revealing seller identity. Scam labels run in shadow mode first; wording gets legal review before launch. Other warning signs are neutral facts. "No scam scores"; never show an unexplained score (`HANDOFF.md`) |
| Price-drop watch | Not in version 1 (`docs/decisions.md`, Product) | Build first: price history within one listing ID only. Relists are merged silently; never show history across listing IDs, "relisted" or "seen before" |
| Price wording | Fair-value range; `ask_based` valuations from asks (`docs/valuation.md`) | Never present asking prices as sale prices or as what something is "worth" or "fair". Show asking-price position (same spec and condition). The brief is inconsistent on thresholds: `HANDOFF.md` and the `SELLER_DATA.md` CI rule say n≥10 only; `PARTS_INTELLIGENCE.md` also allows "thin" at 5–9. Until the owner decides, the conservative reading applies: shown only at n≥10 (see `docs/questions.md`) |
| Sale signals | Vanished listings are sale signals; lifecycle feeds sell-through and days-to-sell (`docs/architecture.md`, `docs/valuation.md`) | A listing that disappears may not have sold. Opt-in sold prices reported by users are the only route to sale prices (`PARTS_INTELLIGENCE.md` §3, §4) |
| Part-out maths | Part-out maths is a version-1 feature (`docs/decisions.md`, Product) | A part-out or flip calculator comes later, once standalone part prices exist; an asks-based sum is not a part-out margin (`HANDOFF.md`, `PARTS_INTELLIGENCE.md` §2, §3) |
| Cadence and tiers | Tiers are sold by cadence: Standard 5-minute, Pro and Business 1-minute (`docs/decisions.md`, Pricing) | T2 sets the cadence; no faster checks or "instant" tier are sold until T2 reports (`HANDOFF.md`, `PARTS_INTELLIGENCE.md` §3) |
| Region and currency | UK; GBP only (`docs/operations.md`) | UK and Ireland. Irish asks form their own EUR groups, never converted into GBP ones *For the beta: UK only, Ireland skipped (owner, 2026-09-24; "Beta coverage and Apify budget" below).* |
| Location precision | Coordinates stored to 100 m; a deals map with pins (`docs/compliance.md`, `docs/dashboards.md`) | Show locations no finer than town or distance (`SELLER_DATA.md` §5) |
| Per-user work | Scan mode's on-demand fetch includes Facebook asks via Apify per scan (`docs/scan-mode.md`) | Never run Facebook fetches or AI per user. Pasted links join the shared, deduplicated details queue |
| Search planning | One watch per marketplace, category and 40 km cell, H3 resolution 4 (`docs/architecture.md`, `docs/engineering.md`) | Per region: a verified centre `cityId` × a few terms, never per user (seed: `city-pages.seed.json`, 771 city IDs, 5 verified centres). Newest-first checks, default-order catch-up, daily sweeps; the app chooses which IDs get details and sends them as `listingIds` batches; the actor never filters or judges |
| Photos | Photo fingerprint and embedding per listing; Storage for listing photos (`docs/engineering.md`, `docs/architecture.md`) | Photo review only when the text is silent; photos fetched through Apify; bytes deleted after review; never serve photos from our own storage |
| Resale of listing data | Business tier: export, channel feeds and a public deals API (`docs/decisions.md`, Pricing; backlog 5.3, 5.4a) | Avoid any resale of listings, descriptions or photos; sale or sharing with third parties waits for legal advice (`PARTS_INTELLIGENCE.md` §3, §6) *The legal-advice gate was lifted by the owner on 2026-09-24 ("Legal gates lifted" below).* |
| Legal gates | Facebook alerts reach paying users only after a UK legal review (`docs/compliance.md`) | Do not charge before legal advice (Meta's terms, database right, copyright, UK GDPR). An LIA and a DPIA come before further collection, not only before launch; get the legal view before collecting seller data at scale (`PARTS_INTELLIGENCE.md` §6, `SELLER_DATA.md` §5) *Lifted by the owner on 2026-09-24 ("Legal gates lifted" below); the points stay listed in `docs/legal-review.md`.* |
| Apify token | `APIFY_TOKEN` in the pipeline's platform vault (`docs/secrets.md`) | A Supabase Edge Function secret; never in code or chat. Only actor `YfdUav3sZ2BgEf8rh`, never `JR2fdK8Nj6OLCwKkP`. It is the Edge Function secret `APIFY_TOKEN` on `fbapfy`, read only by the `apify-gateway` Edge Function (`supabase/README.md`) |
| Noise and wanted adverts | Wanted, laptop and accessory words are title excludes at the gate (`nabvy/docs/packs/gpu-pc.md:12`); screen flags are shown, never used to hide silently (`nabvy/docs/architecture.md:66`) | A free noise filter hides wanted, swap and "I buy" adverts, keyword stuffing, laptops and mention-only hits (`fb-scrap-engine/docs/HANDOFF.md:171-173`). Meanwhile hidden with a visible count and a "show hidden" switch (`modules.md` question 17) |
| Detail selection | A pack title gate chooses candidates; details in batches of 20–50 (`nabvy/docs/backlog.md:25`) | Every new ID in area or shipped, whatever its price or title, gets details; batches of up to about 200 (`fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:67-68,108-109,164-166`) |
| Content hash | `contentHash` = sha256 of title, price and thumbnail URL (`nabvy/docs/engineering.md:35`) | Interpretation is versioned by an evidence hash from an allowlist (title, description, attributes, detail sections, condition, category); price, availability and location stay out, or 88% of repeat sightings would re-run AI (`fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:127-131`; `fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:249`) |
| Copies and relists in counts and alerts | Dedupe per user, listing and cross-post group (`nabvy/docs/modules.md:72`); no rule for copies or relists in price data | Each copy-advert cluster and each relisted item counts once in asking-price bands and gets one alert; relist alerts are dropped silently (`fb-scrap-engine/docs/design/SELLER_DATA.md:95-97,145-146`) |
| Matching wants | Hunts match product keys (`nabvy/docs/contracts.md:93-99`; `nabvy/docs/modules.md:69-72`) | Spec search and alerts match parts inside PCs, from the description too; silence is never a "no" ("GPU not stated — ask the seller") (`fb-scrap-engine/docs/HANDOFF.md:168-170`) |
| New listings and coverage | A high-water mark per watch detects new listings (`nabvy/docs/backlog.md:24`) | The app detects new IDs itself; a degraded search is rerun and never read as "nothing new"; photo-only positives go to the digest (`fb-scrap-engine/docs/HANDOFF.md:146-147`; `fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:181-182,189-192`) |

## Actor data kept in full

**Owner's decision, 2026-09-24.** Keep all the data the actor returns: nothing is removed, redacted or stripped at ingest, including seller names, IDs and pictures and the full listing text. It is needed for scam detection and other internal analysis, and developers see the full data at all times. The one rule is that **end users of the app are never shown seller identity**. The simplest way to meet it:

- users only read through the app's API and its `v_` views;
- those views select an explicit allowlist of fields, and seller fields are never on it;
- a CI test on user-facing output enforces this when the web app arrives.

This replaces minimisation and stripping wherever the build pack or the brief call for them (`CLAUDE.md` "No personal data beyond need"; `SELLER_DATA.md` §5; `PARTS_INTELLIGENCE.md` on stripping descriptions). It does not change what users may see (Precedence table above). How long raw data is kept has not been set; it is kept until the owner decides otherwise.

**Storage shape (plan for task 0.3):** each actor row is stored whole as `jsonb`, so no field is lost even when the actor adds new ones. The fields Nabvy filters and sorts on also get real columns (listing ID, price, currency, title, listed time, town, coordinates, availability, category, description status).

Not a conflict in price: the brief's money section (Plus at about £4.99 a month) is labelled "inputs, not decisions", so the price points below stand until the owner decides otherwise. What each tier promises in cadence is a conflict (row "Cadence and tiers").

New work from the brief, to be placed in the backlog with Nabvy's own integration plan ("The actor is a tool" below): a parts record per listing (listing kind; every part quoted from the listing with its inclusion status; rules first from `part-patterns.json`, AI only for gaps, once per listing, shared by every user); spec search and alerts, where silence is never a "no" ("GPU not stated — ask the seller"); a free noise filter (wanted, swap and "I buy" adverts, keyword stuffing, laptops, mention-only hits); the copy-advert spam flag; suspected-behaviour labels; asking-price position; the price-drop watch; demand signals (first-party wants plus wanted adverts, cells under 5 suppressed); seller objection and erasure with a suppression list keyed by a hash of the listing ID (before launch); CI tests that fail if user-facing output carries seller fields, contact details, suppressed listings or aggregates under the display threshold (`SELLER_DATA.md` §3, §5).

## The actor is a tool; Nabvy owns the rest

**Owner's decision, 2026-09-24.** The Facebook actor is a plain fetch tool: it runs searches and fetches listing details, and nothing more. Everything else is Nabvy's to design and build: copy-advert spam detection, the parts record, noise filtering, suspected-behaviour labels, asking-price position, the price-drop watch, scam signals, alerts and the rest. Nabvy writes its own integration plan and copy-advert spam design (in progress, `docs/progress.md`). The actor repo's `docs/APP_INTEGRATION_GUIDE.md` and `docs/design/COPY_ADVERT_SPAM.md` are on the owner's reading list but not written yet (checked at `f177a44`); they are checked for until they land, and anything useful in them is folded into Nabvy's own plans.

**Only the listed actor files are read** (owner, 2026-09-24). The owner asked for the actor's documents to be used "as knowledge to help you in developing the app as a whole", and then limited that to the files in the owner's reading list, `docs/fb-actor-sources.md`; the actor repository is a separate project and the rest of it is not scanned. In scope:
- `HANDOFF.md`, sections "Rules" and "The app: what we want it to do, and what the data allows" only;
- the designs `PARTS_INTELLIGENCE.md`, `CONTAINER_LISTINGS.md` and `SELLER_DATA.md`;
- the data files `city-pages.seed.json` and `part-patterns.json`;
- `app/route-health.js` and `test/route-health.test.js`;
- `.actor/input_schema.json`;
- the optional references `SCALE_PLAN.md`, `MONETISATION_INPUTS.md`, `EVIDENCE_LEDGER.md` and `README.md`.

What these files teach informs the whole app, not only the calls to the actor. The Precedence table above still decides conflicts; knowledge that points at a product decision (pricing, tiers, categories, user-facing wording) goes to `docs/questions.md` rather than being decided.

## Atomic modules

**Owner's decision, 2026-09-24.** Each function of the app is a stand-alone atomic module, starting with copy-advert spam detection; the other functions (the parts record, the noise filter, suspected-behaviour labels, asking-price position, the price-drop watch and the rest) are treated the same way. Working definition, until the owner amends it:

- **One job.** A module does one function, lives in `services/<module>/` with the shape in `CLAUDE.md`, and has its own `README.md`, fixtures and tests.
- **Own data.** It owns its tables; no other module writes them. Others read its output only through its `v_` views or its exported functions.
- **Contracts only.** Its types live in `packages/contracts` under its own name. It talks to other modules only through those contracts and thin events; it never imports another module's internals and never calls another module over HTTP.
- **Stands alone.** It can be built, tested, switched off and replaced on its own. When it is off, the modules that read its output carry on without it.
- **Pipeline rules.** Handlers take batches, are idempotent (key `source + sourceListingId + contentHash`) and stamp their T-timestamps.

The build pack's larger modules (`docs/modules.md`) are split to match; the module catalogue that does this is in progress (`docs/progress.md`).

**How modules are built** (owner, 2026-09-24): foundation first, then parallel waves.
1. **Foundation, one session.** One session lays what every module builds on. It started on 2026-09-24 before the catalogue was approved, on the owner's instruction to run wave 0 in parallel ("start as many sessions as needed"). It builds only shared machinery that does not depend on the module list:
   - per-module contract files and database-schema namespaces in `packages/contracts` and `packages/db`;
   - an event registry with one file per module;
   - a scaffold script for the module shape;
   - the rule that a module session touches only its own folder, contract file and migration file.
2. **Waves.** Every module whose inputs and owner decisions are ready starts at the same time, each in its own session, on its own branch `task/<id>-<module>`, with one pull request per module. Each module is built and tested against fixtures. Migrations are tested only on a local throwaway Postgres (`pnpm db:dry-run`); the coordinator applies them to Supabase soon after the merge, module and gateway migrations alike, reading `docs/security.md` first; the reviewer never touches Supabase, and its merge wakes the coordinator; the coordinator's two-hour sweep also checks the ledger and `list_migrations` (owner, 2026-09-24). A module waiting on an owner decision or a legal gate waits for a later wave.
3. **One coordinator session.** It writes each module session's brief, checks each pull request for consistency with the contracts, and keeps `docs/progress.md` itself, so that branches do not conflict over it. It updates the file in a sweep every two hours.
4. **One reviewer session reviews, approves and merges every pull request** (owner, 2026-09-24, for the production MVP). It merges only when its review passes and CI is green on the exact commit it reviewed. GitHub does not let an account approve its own pull request, and every session acts as the owner's account, so the approval is recorded as a review comment whose verdict reads "Approved". It never pushes to a pull request's branch; the authoring session fixes what the review finds. A pull request that needs an owner decision (pricing, tiers, categories, wording shown to users) waits for the owner.

For module work this replaces `CLAUDE.md`'s "one task at a time".

## MVP scope and pipeline runtime

**Owner's decisions, 2026-09-24.**
- **Scope.** The production MVP for this push is a **public beta with full functionality and one source: Facebook Marketplace through Nabvy's actor**. eBay, CeX, Gumtree and the other sources come later. Features that the build pack fed from other sources work from Facebook data alone. For example, price information is the asking-price position from Facebook asks (the Precedence row "Price wording"), with no eBay sold prices or CeX prices. The legal gates are lifted ("Legal gates lifted" below): the operational instruction is a fully working production app.
- **Frontend.** A modern, professional design, in the spirit of the Apify console, eBay and ChatGPT:
  - an app shell with a left sidebar;
  - clean listing cards with the price up front;
  - a calm, spacious layout with a prominent search box;
  - light and dark themes.

  Built on the build pack's stack (Next.js, Tailwind, shadcn/ui); the owner lets the build choose the look.
- **Charging from launch** (owner's explicit override, 2026-09-24). Billing is built and live at the public beta launch. This overrides the brief's "do not charge before legal advice" (Precedence row "Legal gates") on the owner's instruction. The rest of that row was lifted too ("Legal gates lifted" below). Plans and prices are those under "Pricing and cadence" below. What each tier promises in cadence stays open until T2 reports (Precedence row "Cadence and tiers"), so plans are not sold on speed meanwhile.
- **Listing photos.** Not shown in the web app until legal advice says they may be (owner, 2026-09-24). This is the owner's own product decision, not one of the lifted legal gates. Cards show a neutral placeholder and an "Open on Facebook" link; a feature flag, off by default, lets photos be switched on later without a redesign.
- **Scan mode uses vision AI per scan** (owner's explicit override, 2026-09-24). Photo recognition runs a model call per scan, capped per user by `SCAN_SPEND_CAP_MINOR`. This overrides the brief's "never run AI per user" (Precedence row "Per-user work") for scan recognition only. Facebook fetches are still never run per user: pasted links join the shared, deduplicated details queue.
- **No refunds** (owner, 2026-09-24). A strict no-refunds policy replaces the 14-day money-back. Nothing is refunded at the customer's request:
  - subscriptions, including a trial that has converted, annual plans and extra areas;
  - usage top-ups, boosts and exports.

  How it is built:
  - **Cancellation.** Customers can cancel at any time in the billing portal. It takes effect at the end of the paid period, and access continues until then.
  - **Plan changes.** Downgrades are scheduled for the period end, so no credit arises. Upgrades take effect at once and charge the difference.
  - **Disclosure.** The pricing page, Checkout and the terms state "Payments are non-refundable" before purchase.
  - **Start now at Checkout** (owner, 2026-09-24, as big tech does). Checkout has one required tick, "Start my plan now", for subscriptions, trials and top-ups. It is stored with the payment.
  - **No refund button** anywhere, for users or admins.
  - **Chargebacks** are recorded, and they reverse any affiliate commission.
  - **Failed actions.** A metered action that fails returns its usage credits (a ledger reversal, not a refund of money).

  Worded and paired as big tech does ("Policies and conduct match big tech" below). Points a lawyer may want to look at are listed in `docs/legal-review.md`.
- **Fair use, suspension and bans** (owner, 2026-09-24). Nabvy publishes a Fair Use Policy alongside its terms and acceptable use policy. At its discretion, Nabvy may suspend an account temporarily or ban it permanently when it notices abuse, including:
  - a breach of the terms, the acceptable use policy or the fair use policy;
  - fraud or chargeback abuse;
  - a risk to other users, to sellers or to the service.

  Paid amounts are not refunded on a ban, under "No refunds". A banned person may not open a new account.

  **Automatic, autonomous and internal** (owner, 2026-09-24). Enforcement is automatic: the system applies throttles, limits, suspensions and bans itself from its rules, with no human needed to act. Everything behind a decision stays internal and is never shown or told to any user, in any form:
  - no reasons, evidence, rule names, signals or scores;
  - nothing in the app, email, notifications, API, exports or support replies.

  The user receives only a short notice that names the policy the step was taken under and nothing more (owner, 2026-09-24, as big tech does), for example "Your account has been suspended under our Fair Use Policy." The notice offers a review route: the user may ask for a review within **30 days**, a person looks internally, and the reply says only whether the decision stands, changed or was lifted. Developers and admins see everything. Points a lawyer may want to look at are listed in `docs/legal-review.md`.

  The product enforces it:
  - an account status (active, suspended until a date, banned) checked on every signed-in request and by every job that acts for a user;
  - automatic enforcement by the account-integrity module, each action with an internal reason, evidence and audit row;
  - internal admin tools to review, override and lift, also audited;
  - throttling and hunt or alert limits as fair-use steps short of suspension;
  - checks against ban evasion (the same email or payment card; listed in `docs/legal-review.md`);
  - a CI test that fails if any user-facing output carries an enforcement reason, rule, signal or score.
- **Beta coverage and Apify budget** (owner, 2026-09-24).
  - **Nothing runs unless a user asks** (owner, 2026-09-24): "we are not running anything unless requested by the actual user." Collection is driven only by users' active hunts.
    - A hunt (product and area) maps to the nearest search centre on a national UK grid, with Ireland skipped for now.
    - While at least one active hunt needs a centre and term, the system runs that shared search. When no hunt needs it, nothing runs.
    - Searches stay per region, never per user (Precedence row "Per-user work"): one search for a centre and term serves every hunt that maps to it.
    - Areas and products nobody hunts cost nothing.
  - **The one exception: our own test hunt.** The owner's team tests the app on a real hunt for **"rtx3090"**. Its area is Chichester, the verified centre the actor's own tests used (confirmed by the owner, 2026-09-24). This hunt is the first end-to-end acceptance test of the pipeline: search, ingest, parts and noise filtering, copy-advert detection, asking-price position, and an alert delivered.
  - **The grid.** Centres are Facebook city pages about 80–100 km apart covering Great Britain and Northern Ireland, taken from `city-pages.seed.json`. A centre is confirmed by a cheap verification run the first time a hunt needs it. Prices are GBP only.
  - **Budget.** The gateway enforces an Apify spend cap of **$150 a month**, as a ceiling. The gateway's cap today is a lifetime total ($5.50 for testing), so it becomes a monthly cap, reset each calendar month, with the same worst-case reservations.
  - **Cadence within the budget.** The spend governor shares the monthly budget among the centres and terms that active hunts need, favouring paying subscribers. On the actor's evidence, about $3.20 a month per term per centre buys a newest-first check every 30 minutes ($0.0022 a check × 48 a day × 30 days, computed from fb-scrap-engine/docs/EVIDENCE_LEDGER.md:319; `docs/fb-actor-reference.md` §12). This is an estimate, refined once the actor's T2 results and measured spend are in.
- **Search, map and pickup features** (owner, 2026-09-24). Design in progress; each is an atomic module or a web feature.
  - **Filters and sorting like eBay:** nearest distance, cheapest, newest, best asking-price position and the other eBay equivalents, plus price range, condition, collection or delivery, and radius.
  - **A map view like Airbnb's:** listings as price markers on a map beside the list, panning and zooming to search. Markers show approximate location only, at town or area level, clustered where dense. A marker is placed at the town or area's centroid, never at the listing's own coordinates and never at jittered real coordinates. A CI test enforces this. This follows the Precedence row "Location precision" and Airbnb's own practice of an approximate area.
  - **A distance limit with "worth the trip" hints:** users see only items within the distance they choose. The app may also hint at good deals slightly further away, when the saving outweighs the extra travel.
  - **Where an item really is** (owner, 2026-09-24). A listing's location field is not trusted on its own:
    - the location may be missing, with the real one only in the description (for example "collection from Bognor");
    - the seller may have picked the wrong one, for example an autofilled postcode typed earlier that day.

    Nabvy resolves each listing's pickup location from every signal it has, in the same way it finds an "RTX 3090" in the description of a listing titled "gaming PC":
    - the location field;
    - place names and postcodes in the title and description;
    - conflicts between them.

    Rules come first; AI runs at most once per listing version, shared by all users, only where rules cannot decide. What users see stays at town or area level, marked as approximate when it is uncertain. A full postcode or street in a description may be used internally, but only the town or area derived from it may reach a `v_` view or user-facing output; the location-precision CI test covers this. Model output is validated against a Zod schema before use. Distance filters, the map and hints use the resolved location.
  - **"Too good to be true"** (owner, 2026-09-24). Listings that look like scams are marked "too good to be true". The owner's examples: a listing placed on the Isle of Wight whose seller then says collection is in Manchester, and a listing in Chichester whose seller then says postage only. Nabvy never sees conversations with sellers, so the mark comes from two sources:
    - **Listing signals:** a price far below comparable asks (at n>=10); the listing's location conflicting with the location in its text (the "Where an item really is" resolution); "postage only", "courier only" or "delivery only" in a listing offered for collection; risky payment requests; and copies of the same advert across distant places (copy-advert).
    - **User reports:** after messaging a seller, a user can report in one tap what the seller said, for example that collection was elsewhere, that it was postage only, or that they asked for a bank transfer or deposit. The report counts towards the mark that other users see on that listing and on its copies.

    The label reads "Suspected too good to be true:" followed by the facts. This joins the owner's phrase with the brief's "Suspected ...:" rule; the owner confirms the final text. Reports count only from distinct, established accounts, are rate-limited, need a threshold before a report-based mark shows, and never reveal who reported. The mark attaches to the listing, never to the seller.

    It follows the Precedence row "Labels and scores":
    - worded as a suspicion and shown with its evidence;
    - from documented rules with thresholds calibrated on real data;
    - with a way to report a mistake;
    - no numeric score shown.

    Seller-level signals stay internal (Precedence row "Seller-derived flags"). It runs in shadow mode during the rtx3090 test hunt to set its thresholds, then goes live.
  - **Every listing is reused** (owner, 2026-09-24). A run returns far more than the product it searched for. For example, an "rtx3090" search also returns RTX 2080s, 3070s and whole PCs. All of it goes into one shared pool:
    - each listing is stored once and identified from its title and description (the parts record), whichever hunt triggered the run;
    - every listing adds to the asking-price picture for its own product;
    - every listing is matched against every user's hunts, not only the hunt that triggered the run;
    - a listing far below its own product's comparable asks (asking-price position, n>=10) is a gem candidate. It is checked against the "Too good to be true" rules, and may be given a detail fetch to confirm it, before it is shown as a top pick, to users hunting that product, or as a similar alternative ("while hunting your RTX 3090 we also found ...").

    Reuse costs no extra Apify spend: no search runs for by-catch alone.
  - **Pickup route planning:** the user records each pickup they have arranged with a seller (where, and the agreed time or window). The app plans an optimal route to collect the whole haul in one day. The addresses and times come from the user, stay private to that user, and are never taken from listing data or shown to anyone else. They are stored under row-level security in the owning module's schema, appear in no `v_` view, and fall under the retention question.
- **Legal gates lifted** (owner, 2026-09-24): "Lift the gates. The operational instruction is to have the production app fully working as intended." The gates are:
  - further data collection through Apify no longer waits for an LIA and a DPIA. Nabvy never deals with Facebook directly: it uses third-party data that comes from Apify runs (owner, 2026-09-24);
  - sharing or reselling listing data no longer waits for legal advice, so the build pack's Business features (export, channel feeds, public API) are back in the plan;
  - alerts built from that data go to every user, paying or not.

  Collection runs as the product needs, within the Apify spend cap the owner sets. The points stay listed in `docs/legal-review.md`. The owner's own product decisions are unchanged, for example listing photos stay off until the owner decides otherwise.
- **Policies and conduct match big tech** (owner, 2026-09-24): "Any and all policies and conduct just match to the big tech. I'm sure their policies and terms were vetted by legal professionals already." For every policy and every piece of conduct toward users, Nabvy takes the position that leading consumer tech companies share in their UK-facing terms and practice, written in Nabvy's own words. Examples:
  - terms, refunds, cancellation and trials;
  - fair use, acceptable use and account sharing;
  - suspension, bans, notices and appeals;
  - privacy and cookie notices.

  The benchmark is Netflix, Spotify, Disney+ and YouTube for subscriptions; Google, Apple, Microsoft and Meta for accounts and enforcement; OpenAI, Anthropic, Canva, Midjourney and Adobe for SaaS and AI; and Apify and Supabase for platform-style clauses. The owner's specific decisions above hold. Where big tech pairs them with a standard element, Nabvy includes it too, for example "except where required by law" on refunds, a generic appeal or contact route that reveals nothing, and trial-end reminders.
- **Legal review on request only** (owner, 2026-09-24): "Run everything as instructed and only write to a document what needs a legal review but do not run any legal reviews or checks until requested." Nabvy is built as the owner instructs. Points that may need a lawyer are listed, without analysis, in `docs/legal-review.md`. No legal research, review or check is run until the owner asks for one.
- **Pipeline runtime.** **Trigger.dev** runs the pipeline modules, as the build pack planned. Apify is still called only through the Supabase `apify-gateway` Edge Function: pipeline tasks queue gateway jobs in the database and read the collected rows back. This answers the runtime question in `docs/questions.md`.

## Product

- **Audience and first category:** Nabvy is for anyone in the UK who buys second-hand to resell or to get a good deal; it is not limited to tech flippers. The first category pack is GPUs and gaming PCs, chosen for clean product keys and strong price data; the first design partners are tech flippers. Other categories arrive as category packs (data, not code), in this order of intent: consoles and controllers, phones, laptops and PC parts, collectables, then cars. DVDs are out: CeX pays a penny for them and demand is falling.
- **Two entry points:** alerts on new online listings, and scan mode for items in front of the user.
- **Five version-1 features:** checked deal alerts with part-out maths; speed at parity with an honest freshness stamp; risk screening on every alert; hunts by postcode and radius with sensible defaults; one-tap action (open listing, prepared message, checklist, then "bought for" and "sold for" capture). *(Part-out maths is superseded by the Precedence row "Part-out maths"; for this push, the scope is "MVP scope and pipeline runtime" above.)*
- **Not in version 1:** listing to any marketplace other than eBay; price-drop tracking; CRM; AI negotiation; auto-messaging sellers; native apps; DVDs. *(Price-drop tracking is superseded: the Precedence row "Price-drop watch" makes it build-first.)*
- **Brand:** Nabvy. Domains: nabvy.com (marketing site, canonical), nabvy.co.uk (redirect), nabvy.app (the PWA); dibvy.com, dibvy.co.uk, dibvy.app redirect to Nabvy. DNS on Cloudflare; email hello@nabvy.com on Google Workspace.

## Data access

- **APIs first, Apify for the rest, no scrapers of our own.** eBay through its official APIs (Browse for live listings and image search; Marketplace Insights for sold prices when approved; Sell APIs for listing drafts with the user's OAuth consent). CeX through its web API at low volume, cached and capped, with a licensing request to CeX and CeXDB in progress. Facebook Marketplace, Gumtree and later Vinted through third-party Apify actors behind the provider adapter contract, two actors per marketplace with fail-over and spend caps; managed APIs such as ScrapeCreators only as a fallback. *(Superseded for Facebook: one actor only, `YfdUav3sZ2BgEf8rh`, no fallback, CLAUDE.md and the Precedence row "Apify token". For this push Facebook is the only source.)*
- **Facebook go-live gate:** Facebook alerts are not exposed to paying users until a UK legal review of using provider-collected data (database right, UK GDPR) is complete. A per-provider kill switch exists from day one. *(Lifted by the owner on 2026-09-24: "Legal gates lifted" above.)*
- **eBay Partner Network:** eBay alert clicks carry the EPN campaign ID; affiliate links are disclosed in the app.

## Platform

- **Database:** Supabase (existing project `fbapfy`, eu-west-1, Postgres 17), used as managed Postgres plus Storage, Queues and pg_cron. One database for every shape of data (relational, time series by partition, PostGIS, pgvector, pg_trgm, shallow graphs by recursive CTE). No graph database now; revisit only if fraud-ring or similar-item queries need more than three hops or exceed 500 ms p95 (then Apache AGE or Kuzu, Postgres staying the source of truth). Dashboards read from views and materialised views only. Switch only if the database line passes about $400 a month and a rival is materially cheaper for the same load.
- **Pipeline runtime:** Trigger.dev, with Supabase Queues plus Edge Functions as the fallback. *(Confirmed by the owner on 2026-09-24: "MVP scope and pipeline runtime" above.)*
- **Authentication and authorisation:** Better Auth (MIT) with its Drizzle adapter on the Supabase Postgres database: magic-link email, Google sign-in, admin plugin for roles, captcha plugin with Cloudflare Turnstile, Stripe plugin for subscriptions. Supabase Auth, PostgREST and supabase-js are not used for application data; the browser never talks to the database. All data access runs server-side through Drizzle inside a transaction that sets the current user, and row-level security policies read that setting as a second layer.
- **How parts talk to each other:** three boundaries, three mechanisms. *Module to module* is in-process: modules are packages in one deployable that call each other's exported functions and publish thin events through Trigger.dev and Supabase Queues; there is no HTTP between modules. *Browser to server* is one typed procedure layer built with oRPC (MIT): every procedure validates input with the contracts schemas, checks the session, and calls a module function inside `withUser`; server actions are allowed only for plain form submits and must call the same procedures. *Outside world* is HTTP: webhooks in (Stripe, Telegram, Dub) as route handlers, and a versioned public REST API generated from the same oRPC router with OpenAPI for Business-tier customers, bots and AI tools. Microservices are ruled out until a module needs to scale or deploy independently, which the contracts make possible without a rewrite.
- **Language:** TypeScript end to end. Python only if valuation later needs libraries TypeScript lacks.
- **Models:** Vercel AI SDK with Zod structured outputs. Claude Haiku 4.5 by default; Claude Sonnet 5 for listings above a value threshold or below a confidence threshold (thresholds set from measured data, see `docs/valuation.md`); a vision-capable model for photos in scan mode. Batch pricing for backfills; prompt caching for pack instructions.
- **Snapshots:** raw provider responses in Supabase Storage for 30 days. *(Superseded: raw actor data is kept in full and its retention is not yet set, "Actor data kept in full" above.)*

## Pricing and cadence

- **Pricing model ("watch and check"):** two kinds of value, priced two ways. *Watching* (live alerts on areas at a cadence) is a flat subscription entitlement because its cost is shared across everyone in a cell. *Checking* (scans, live on-demand lookups across all sources, similar-item searches, boosts, exports) is metered usage in pounds, like Apify's prepaid usage: every plan includes a monthly usage allowance, then pay-as-you-go top-ups, with a lower unit price on higher plans. Every feature is available on every tier, including Free; tiers differ only in areas, cadence and usage allowance.
- **Tiers:** Free (£0.50 usage a month with full data enrichment, live eBay alerts funded by affiliate commission, Nabvy Daily as the delivery of other sources, no live paid-source areas); Standard £9/month or £90/year (one 40 km area at 5-minute cadence, £10 usage included, top-ups at list price); Pro £29/month or £290/year (three areas, 1-minute cadence, £35 usage included, top-ups 10% below list); Business £99/month or £990/year (ten areas, 1-minute cadence, export and channel feeds, £120 usage included, top-ups 20% below list). Extra area £4/month on any paid plan. Top-up packs £5, £10, £25; unused included usage expires monthly, purchased usage does not. *(What each tier promises in cadence waits for T2, Precedence row "Cadence and tiers"; for this push Facebook is the only source, so eBay items do not apply.)*
- **Trial:** when a Free user reaches the cap the app offers a 7-day Standard trial with a card and £3 of bonus usage valid for the trial; one trial per account; converts to Standard unless cancelled. An Apify-style entry plan (£1 a month billed £6 for six months with a bonus usage balance) is a later experiment, not a launch feature.
- **Usage list prices (pence, set at roughly two to three times measured cost; reviewed after week one):** scan with cached data 2; scan or lookup with a live check across all sources 15; similar-item search 10; 24-hour product boost 149; 7-day boost 499; export 50. Prices are shown before every metered action.
- **Cadence rule:** a cell runs at the fastest cadence whose monthly provider cost stays under 60% of that cell's subscription revenue, checked daily; 5 minutes is the default; an hourly nationwide sweep is the floor. Everyone in a cell gets the cell's cadence, and the app says so. Speed is a property of the cell, never an artificial delay.
- **Revenue rules:** annual plans at ten months' price; design partners on lifetime Pro; £5 usage credit to both sides per paying referral; no refunds (owner, 2026-09-24; "No refunds" under "MVP scope and pipeline runtime"). Prices include UK VAT (Stripe Tax).
- **Free-tier limits:** 3 active hunts, £0.50 usage a month, eBay alerts live, other sources as a daily digest.
- **Marketing machinery from day one:** lifecycle messaging on PostHog Workflows triggered by first-party events (abandoned checkout and onboarding, activation, cap reached, trial, failed payment, win-back, weekly review); Nabvy Daily, a daily brief with local hot deals, the user's product price moves and a UK market recap (plus regional CeX comparisons where we hold data), sent by email and channel post with a public indexable web version; transactional email on Resend with templates in the repository; SEO price pages generated from the Price Book; waitlist before launch; marketing consent by unticked box or soft opt-in with one-click unsubscribe and a preference centre. No separate marketing suite. Details in `docs/marketing.md`.
- **Affiliate and creator programme from day one of the public beta,** run on Dub Partners (open source): 30% of net subscription revenue for 12 months, 10% on usage top-ups, tiers to 35% and 40% by active referred subscribers, 90-day last-click cookie, codes attribute without a click, £5 usage credit to the referred user, 30-day hold with chargeback clawback, monthly payouts with a £20 minimum, mandatory ad disclosure. Details in `docs/affiliates.md`.

## Build order

- **Build order:** Facebook Marketplace first, using the existing Nabvy Apify actor as the provider (it is ready); then eBay through the official API; then scan mode; then Gumtree; then the web app, billing and public beta. Facebook alerts stay private (the founder and design partners only) until the legal gate clears; the gate was lifted by the owner on 2026-09-24 ("Legal gates lifted"). *(Superseded for this push by "MVP scope and pipeline runtime" above: a full-featured public beta on Facebook only.)*

## Success metrics

| Metric | Role | Target |
| --- | --- | --- |
| Verified profitable flips attributed to alerts, per month | North star | Grows month on month from the first paid week |
| Alert precision (share of alerts users mark as a real deal) | Guardrail | ≥50% in beta, rising to 70% |
| Median freshness per source (listed to delivered) | Guardrail | Within 2 minutes of the source's measured floor on the fast tier |
| Cost per delivered alert | Guardrail | Under £0.05 |
| Week-4 retention of paying users | Guardrail | ≥40% |

## Quote masks shown to users (owner, 2026-09-24)

The owner approved the wording `quote-redaction` shows in place of contact details: `[phone redacted]`, `[email redacted]`, `[handle redacted]`, `[link redacted]`, and a full postcode cut to its outward half plus `[redacted]` (for example `PO19 [redacted]`). Approved as "Approve and carry on" on PR #17.

## Watching is metered, prices are dynamic (owner, 2026-09-24)

The owner, after missing a £350 RTX 3090 Ti in Redhill that sold within hours:
- **Radius.** The user sets each want's radius freely and can change it at any time; there is no fixed cap (the owner would drive up to about three hours, and Redhill from Chichester is well inside that). A wider radius covers more areas, so its estimated credits rise and the want screen shows the new estimate before saving. Nabvy never changes the radius itself; from its own data it only hints, for example "Widen to 45 mi to see 12 more matching deals this week", with one tap to accept.
- **Deal hot spots on the map.** The map can show where deals concentrate: a heat layer built only from town display points (never a listing's coordinates, per "Location precision"), weighted by how many clean, matching listings ask below their comparable median, over a chosen period. Hot spots just outside the user's ring feed the "widen your radius" hint.
- **Speed is the user's choice and is paid for.** Each want has a check interval the user picks (for example 1, 5, 15 or 60 minutes) and a delivery speed (Instant, Batched, Daily digest). The app shows the estimated monthly cost in credits before saving and suggests a top-up when the balance will not cover it. This replaces the flat "watching" entitlement in "Pricing and cadence" for check speed; tiers become included credit and bundle discounts.
- **Always profitable.** Every price is measured cost times a margin, with a floor that refuses any price, bundle or offer below cost plus the minimum margin.
- **Bundles.** Credit bundles with volume discounts, in the style of Claude's and ChatGPT's usage packs, scaled to Nabvy's costs.
- **Dynamic pricing.** An admin page (`pricing-console`) with sliders for margins, bundles and discounts, and per-user or per-segment offers and promotions.
- **Precedence.** How fast Facebook can actually be checked still follows the actor brief and test T2; the price of a faster interval follows from its measured cost.

## Free tier: bursts under a lifetime cap (owner, 2026-09-24, 16:50)

The owner, on the free tier ("hook them right away, blown away, then a couple more tries"):
- **One keyword.** A free account has one want (keyword and area) at a time. It can be changed only when the next window opens, after the 72-hour reset.
- **Bursts, not a steady trickle.** Up to three 8-hour windows, each starting fast and slowing down, with 72 hours between windows. Once the windows are used the account stays on the daily digest and "Missed deals". The exact shape of each burst is the coordinator's to trim (owner: "you do trim it how you find best"), inside the cap below.
- **Hard cap: £2 per free account, lifetime,** measured in attributed provider and model cost (the account's share of each check it caused, lone cost where no one else funds the area). At the cap the burst stops mid-window and the account falls to the digest; nothing runs at a loss.
- **Guardrails against burner accounts** (the owner's example: 20,000 bots opening accounts): a global free-burst pool per day, week and month, revenue-linked with a floor, beyond which new bursts wait for the next period or run only where a paid watcher already funds the area; sign-up limits per IP, device and email domain; a card check (never charged, one card per account) before windows two and three; a per-area anomaly stop; and a kill switch for free bursts. All in `account-integrity`, `spend-governor` and `switches`.
- **Everything adjustable at run time.** Every number above (window count, window length, reset hours, burst shape, per-account lifetime cap, per-user, per-week and per-month caps, the pools, the sign-up limits) is a versioned policy row the owner edits from the admin console, audited, applied within a minute, never a constant in code. Usage is recorded per account so the owner can run the numbers and change the policy at any time.

Coordinator's shape, 16:50, within the cap (1.31p per lone check, measured): window one runs 1 minute for 20 minutes, 5 minutes for 100 minutes, 15 minutes for 2 hours, then hourly (52 checks, 68p lone); windows two and three run 1 minute for 10 minutes, 5 minutes for 50 minutes, 15 minutes for 2 hours, then hourly (33 checks, 43p each). Three windows cost £1.54 lone plus about 10p of model calls, under the £2 cap with room for retries; where a paid watcher already funds the area the burst costs nothing extra. The free-burst pool starts at £20 a day and 5% of the previous month's net revenue, whichever is higher. These are the initial policy values, not owner decisions.

## Hard daily, weekly and monthly spend caps (owner, 2026-09-24, 17:00)

- **Caps stop spending by themselves.** A daily, weekly or monthly cap reached is an automatic stop of all paid calls (Apify, model calls, other paid sources), not a notice to an admin. Example: a £10 daily cap means the day's bill is at most £10 plus the run-off, and never more than £11.
- **The run-off is bounded, not hoped for.** The stop is checked synchronously before every paid submit, against reserved plus settled cost (never on a schedule alone); every run reserves its capped cost before it starts (a per-run cost cap in the actor input); concurrency is capped; so the overrun is at most the reservations in flight at the moment the cap is hit, which the caps are set to keep under 10%.
- **Caps are policy rows** (spend-governor budgets), editable at run time, audited, with periods of day, week and month, on top of the gateway's own monthly hard cap and Apify's platform limit as second and third fences.

## Sign-up throttle and surge stop (owner, 2026-09-24, 17:05)

- **Sign-ups are throttled globally.** Policy rows set how many new accounts may join per minute, hour and day, on top of the per-IP, device and email-domain limits. Beyond the rate, new sign-ups join a queue and are admitted in order ("we are letting people in gradually"), never refused outright.
- **Free bursts are admitted, not fired.** A new free account's first window starts when the admission scheduler admits it, normally within seconds, under a surge in order at a policy-set rate. Spend rate is therefore bounded by the admission rate times the burst cost, and stopping admission stops the spend at once.
- **Thresholds start low.** Initial breaker and admission thresholds are set for a surge of 100 accounts or fewer, not thousands; they are raised from measured traffic, never guessed (owner, 17:08).
- **Queue at the edge first.** Sign-up queueing and bot filtering run in front of the app where possible: Cloudflare Turnstile on sign-up, Cloudflare rate-limiting rules and Bot Fight Mode on the sign-up and search routes, and Cloudflare Waiting Room on the sign-up page if the plan allows it (owner: prefer an existing Cloudflare or open-source tool over building one). The admission queue in `account-integrity` remains the authority: the edge slows a flood, the queue decides who is admitted.
- **Sign-up farming and resource extraction are identified and stopped from day one** (owner, 17:07): the threat model covers both as their own sections, with detection signals, an automatic response ladder and fixtures, not only cost bounds.
- **Abuse audit from day one.** A written threat model of cost and abuse exploits (burner accounts, sign-up floods, free-burst farming, credit and referral gaming, card-check bypass, Telegram and webhook replay, Apify cost amplification, account sharing) with a test plan, adversarially checked, before the free tier opens (owner, 17:08).
- **Surge stop.** Circuit breakers in the synchronous spend gate trip on any of: sign-ups per minute, paid submits per minute, submits from accounts younger than a policy-set age, or cost per minute, each a policy row. A trip sets `hold-new` immediately for free bursts and new accounts (paid watchers keep their funded cadence while under the caps), pauses admission, and alerts the founder. It resets only by an admin, with an audit row. The owner's case: 1,000 bots creating accounts and searching at once trip the breaker within the first minute, so the spend is at most the reservations in flight.

## Free-tier limits, paid users and the daily cap (owner, 2026-09-24, 17:20 and 17:25)

Said by the owner to the 4.3t threat-model session and relayed to the coordinator at 18:20; recorded here verbatim as the owner's decision.

1. On the free pool (17:20): "We do limit the free tier obviously the paid users are welcome to sign up any time at all times - same for upgrading from free to paid plan."
2. On scans and paid calls (17:25): "You figure this out that we cap max individual user £2 a day so if a daily cap is £20 spend we can either have 10 users who runs their usage dry or a few who does but then a couple which goes slow etc And remember these caps have to be adjustable from admin panel. And the admin panel have to be hardened and adversarial security audit run."

What this means for the build (PR #39, `docs/design/abuse-threat-model.md`):
- **Only the free tier is limited.** Paid sign-ups and upgrades from free to paid are never queued, throttled or held, at any time.
- **£2 a day per free account**, counting every paid action (checks, scans, pasted links, model calls), as a policy row editable from the admin panel. The owner clarified at 18:24: "Free tier only. Obviously". Paid accounts have no daily cap; they are bounded by their credits and by the global daily, weekly and monthly caps.
- **The pool drains gracefully.** As a daily pool (the example: £20) runs down, the remaining accounts slow rather than stop at once.
- **The admin panel is hardened and adversarially audited** before it is exposed (`docs/design/admin-hardening.md`; backlog 4.3af to 4.3ah; the admin gate 4.3af blocks the web deploy 0.5a).

## Cadence slider and the app's look (owner, 2026-09-24, 17:12)

- **One control for speed.** Each want's check interval is set with a slider modelled on Claude Code's "Effort" control: 1-minute checks at the top as the "ultracode" equivalent, 4 hours at the bottom as the slow pace, with the intermediate steps between. It should be interesting and good-looking in the way that control is.
- **Look like Claude and ChatGPT.** The app's overall look stays close to Claude and ChatGPT: easy to read, calm, never tiring on the eyes. This refines "a calm, spacious layout" under "MVP scope and pipeline runtime".
- The control's design is in `docs/design/cadence-slider.md` (coordinator, from a two-designer panel with a critic); wording shown to users in it is provisional until the owner approves it.

## Paid ladder (owner, 2026-09-24, 17:35)

The owner, on coordinator 5's recalculation of the ladder (17:00: Starter 3 h base to 1 h with credits, Pro 2 h base, Max 1 h base to 1 min, with Pro's floor at 5 minutes recommended):
- **Pro starts at 30 minutes and bundles credits to power up.** Pro's base cadence is 30 minutes, and the plan comes with credits so a user can buy faster checks on a want, down to the plan's floor.
- **Base and floor for every tier are the coordinator's to set** ("I will let you figure out all the base floor").
- **Every value is adjustable from the admin panel.** Base cadence, floor, bundle size, price, top-up rate, unit prices, area and want counts, per tier: versioned policy rows in `pricing-console`, edited from the admin console, audited, applied without a deploy, never a constant in code. The floor rule ("Always profitable") still refuses any value that sells below cost plus the minimum margin.
- **Cloudflare stays on the free plan** until the production app is ready; the owner pays and upgrades then. Waiting Room is out until that upgrade; Turnstile, rate-limiting rules and Bot Fight Mode are on every plan and stay.
- **Slider wording is the coordinator's to settle** and can change later.

This changes "Speed is a property of the cell, never an artificial delay" under "Pricing and cadence": a want's cadence is now capped by its plan's base, or by the floor it has bought credits for, and that cap is a paid entitlement. Below the cap, delivered speed still follows the 60% rule per area ("delivered where the area funds it"); plans are marketed as "up to" their cadence.

Coordinator 6's ladder, 17:40, on the slider's steps (initial policy values, not owner decisions; prices are the placeholders from `docs/design/pricing-model.md` until the owner confirms them):

| Tier | Monthly | Base cadence (included for the plan's areas, funded by the fee) | Floor (fastest a want can buy with credits) | Bundled credits (starting point; `pricing-console` sizes them against the 60% rule with the base funded by the fee) |
|---|---|---|---|---|
| Free | £0 | bursts, as decided at 16:50 | none | none |
| Starter | £12 | 2 h | 1 h | 1,200 |
| Pro | £29 | 30 min (owner) | 5 min | 6,000 |
| Max | £99 | 15 min | 1 min | 24,000 |
| Business | from £299 | 15 min | 1 min, round the clock | 80,000 |

## Open questions a human must answer

- Model escalation thresholds, after the first week of measured extraction quality and cost.
- eBay Marketplace Insights, Partner Network and Sell API approvals.
- CeX or CeXDB licensing outcome.
- UK legal review outcome for provider-collected Facebook and Gumtree data.
