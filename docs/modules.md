# Module specifications

Each module is a package under `services/<name>/` with the shape in `CLAUDE.md`. "Owns" lists tables only this module writes. "Tests" are fixture-based unless stated. Types and events are defined in `docs/contracts.md`.

## hunt-manager
- **Purpose:** store what each user hunts and their delivery preferences.
- **Inputs:** web app forms. **Outputs:** `hunt.changed`.
- **Owns:** `hunts`, `user_preferences`.
- **Logic:** postcode → lat/lng via postcodes.io at save time; default hunt from a postcode and a pack (radius 40 km, min deal score 60, collection and posted, channel Telegram).
- **Tests:** postcode resolution; default hunt generation; row-level security (a user cannot read another user's hunts).

## crawl-planner
- **Purpose:** turn hunts into crawl units and schedule watches.
- **Inputs:** `hunt.changed`, `entitlement.changed`, `provider.paused`. **Outputs:** `crawl.due`.
- **Owns:** `crawl_units`, `cells`, `crawl_runs`.
- **Logic:** cells are fixed 40 km circles seeded for the UK (about 100); a hunt activates the cells its radius touches; unit = source × pack category × cell; cadence from the cadence rule in `docs/decisions.md` using entitlements of subscribers in the cell and the unit's `spentTodayMinor`; one Trigger.dev scheduled task per cadence class (60, 120, 300, 3600 s) emits `crawl.due` with all due units; hourly sweep of every active cell at 3600 s.
- **Tests:** cell activation from a hunt; cadence selection given subscribers and spend; budget exhaustion slows cadence rather than stopping.

## source-adapters
- **Purpose:** call providers through the `ProviderAdapter` interface, meter cost, report health, emit.
- **Inputs:** `crawl.due`, `detail.requested`, `recheck.due`, on-demand calls from recognition. **Outputs:** `listings.observed`, `details.fetched`.
- **Owns:** `provider_calls`, `snapshots`.
- **Adapters (v1):** `apify-facebook-nabvy` (our actor), `apify-facebook-fallback` (a store actor), `ebay-browse`, `ebay-insights` (when approved), `ebay-sell` (used by inventory-resale), `cex-web`, `apify-gumtree`.
- **Logic:** primary then secondary on error or health breach; every response snapshotted (gzip JSON, 30-day expiry); stubs normalised to `Listing` with `listedAtPrecision`; sellers hashed at the adapter boundary; per-provider daily cap → `provider.paused`.
- **Tests:** normalisation from recorded raw responses per adapter; fail-over; cap enforcement; seller hashing (no raw ID leaves the adapter).

## listing-registry
- **Purpose:** one identity per listing; new/changed/gone; cross-posts; embeddings; lifecycle rechecks.
- **Inputs:** `listings.observed`, `details.fetched`, recheck results. **Outputs:** `listing.new`, `listing.changed`, `listing.gone`, `recheck.due`.
- **Owns:** `listings`, `listing_details`, `listing_embeddings`, `listing_links`, `recheck_schedule`.
- **Logic:** upsert on `(source, sourceListingId)`; `contentHash` change → `listing.changed`; a listing is never marked gone by absence from a watch, only by a recheck; rechecks scheduled at +6 h, +24 h, +72 h for candidates and alerted listings; photo fingerprint (perceptual hash) and image embedding written when details arrive; cross-post link when fingerprint distance is small and title similarity is high across sources.
- **Tests:** dedupe across two cells; change detection; recheck scheduling; cross-post linking on fixture pairs.

## recognition
- **Purpose:** identify what the user scanned.
- **Inputs:** `scan.submitted`. **Outputs:** `product.identified`.
- **Owns:** `scan_events`.
- **Logic:** barcode → product dictionary (EAN) → CeX box ID; else vision model with the recognition output contract; candidates below 0.8 confidence require user confirmation; sticker price read from the photo when present; spend per scan capped.
- **Tests:** EAN lookup; recognition contract validation on 20 fixture photos; confirmation path.

## extraction-enrichment
- **Purpose:** cheap gate, tiered extraction, product-key resolution, geocoding.
- **Inputs:** `listing.new`, `listing.changed`, `details.fetched`, `product.identified`. **Outputs:** `detail.requested`, `listing.extracted`.
- **Owns:** `item_facts`, `extraction_cache`, `quarantine`.
- **Logic:** gate from the pack (title include/exclude, price band, `detailFetchAll`); rules tier (dictionary regexes) → Haiku tier (`generateObject` with the pack template) → escalation tier (Sonnet, or vision on the first photo) when `priceMinor` ≥ escalation value or mean confidence < threshold; cache by `contentHash`; schema failure → `quarantine`; product key by dictionary, then pg_trgm similarity, then embedding similarity; bundles produce `components`.
- **Tests:** gate precision on fixtures; extraction pass rate ≥ previous run; cache hit on identical content; quarantine on invalid output.

## risk-screener
- **Purpose:** risk score and flags.
- **Inputs:** `listing.extracted`. **Outputs:** `listing.screened`.
- **Owns:** `risk_assessments`.
- **Logic:** named rules referenced by the pack (`mentionsMining`, `untested`, `stockPhoto` via fingerprint reuse across sellers, `depositRequest`, `newSeller` via first-seen date of `sellerHash`, `reusedPhotos`, `priceFarBelowFloor` when asking < 50% of value band low, `partsOnly`, `wantedPost`, `emptyBox`); weighted sum clipped to 0..1; reasons carry the matched evidence.
- **Tests:** each rule on positive and negative fixtures; score monotonicity.

## price-book
- **Purpose:** value bands per product key.
- **Inputs:** `price_observations` writes from adapters and valuation, `listing.gone`, `outcome.recorded`, corrections. **Outputs:** `valueband.updated`.
- **Owns:** `products`, `product_aliases`, `price_observations`, `value_bands`.
- **Logic:** per `docs/valuation.md`: recency-weighted sold statistics over 90 days, ask statistics, CeX prices, trend, sell-through, median days-to-sell; refresh nightly for all keys and hourly for keys with activity in the last 24 h; observations partitioned by month.
- **Tests:** band computation on synthetic series (rising, falling, sparse); trend classification; idempotent observation writes.

## valuation-engine
- **Purpose:** turn facts plus bands into a valuation with explanation.
- **Inputs:** `listing.extracted`, `valueband.updated`, on-demand scan requests. **Outputs:** `listing.valued`.
- **Owns:** `valuations`.
- **Logic:** per `docs/valuation.md`; explanation from the pack template, optional wording polish by a model that may not add numbers.
- **Tests:** part-out maths; margin and deal score on fixtures; `unvalued` and `ask_based` states; explanation contains only input numbers.

## opportunity-router
- **Purpose:** match valued, screened listings to hunts.
- **Inputs:** `listing.valued`, `listing.screened`, `hunt.changed`, `entitlement.changed`. **Outputs:** `alert.requested`.
- **Owns:** `matches`.
- **Logic:** PostGIS radius match; thresholds from the hunt; risk score above 0.7 suppresses unless the hunt opts in; dedupe per user per listing and per cross-post group; quiet hours; rate limit 20 alerts per user per hour; free tier receives eBay alerts live and a daily digest of other sources.
- **Tests:** radius edge cases; suppression rules; digest batching.

## notification-dispatcher
- **Purpose:** deliver deal cards and record delivery.
- **Inputs:** `alert.requested`. **Outputs:** `alert.delivered`, `alert.opened`.
- **Owns:** `alerts`, `delivery_log`.
- **Logic:** card template (price, fair value range, margin, confidence, flags, comparables, freshness `T6 − T0`, actions); channels Telegram first, then push, Discord, email; opens tracked by signed link; batch sends.
- **Tests:** card rendering from a valuation fixture; freshness computation with rounded `listedAt`.

## web-app
- **Purpose:** the PWA: onboarding, hunts, deal feed, deal card, scan mode, inventory, feedback, account, billing, admin and review console.
- **Owns:** `user_profiles`, `telegram_links`, `push_subscriptions`, `deletion_requests` (account functions live in `services/account` and are called by the web app); everything else through module functions and `v_` views.
- **Logic:** Better Auth sessions (magic link, Google); one oRPC router with procedures per module (hunts, deals, scans, inventory, account, billing, admin), each validating with contracts schemas and calling module functions inside `withUser`; the same router exposes an OpenAPI public API for Business customers behind API keys; installable with service worker (Serwist); camera and barcode via the Barcode Detection API with a ZXing fallback; admin area behind the admin plugin's role; account export as a JSON archive; deletion request purged within 24 hours. Screens and flows in `docs/web-app.md`.
- **Tests:** Playwright end-to-end for sign-up → hunt → alert feed → feedback; scan flow with a fixture image.

## inventory-resale
- **Purpose:** record purchases, create eBay drafts, produce listing packs, record sales.
- **Inputs:** web app actions, `listing.valued`. **Outputs:** `item.listed`, `outcome.recorded`.
- **Owns:** `inventory_items`, `listing_drafts`, `ebay_seller_tokens`.
- **Logic:** eBay OAuth (authorization code, `sell.inventory` scope) with encrypted refresh tokens; draft via Inventory API (inventory item + offer, published only on user tap); listing pack (title, description, price, photos) rendered from facts and valuation; sale capture feeds `price_observations` (kind `sold`) and the north star.
- **Tests:** draft payload from fixtures; token encryption round-trip; outcome write.

## auth
- **Purpose:** identity, sessions, roles and the Stripe subscription lifecycle, all through Better Auth.
- **Owns:** the Better Auth generated tables (`user`, `session`, `account`, `verification`, `subscription`).
- **Logic:** Better Auth server instance in `services/auth` with the Drizzle adapter, plugins: magic link, Google social, admin, captcha (Turnstile), Stripe; database-generated UUID ids; email verification required; session helpers for oRPC procedures; Next.js route handler at `/api/auth/*` (`withUser` itself lives in `@nabvy/db`).
- **Tests:** sign-up and magic-link flow; role check on an admin action; admin bootstrap from `ADMIN_EMAILS`; sessions revoked on sign-out.

## marketing
- **Purpose:** consent, suppressions, waitlist, attribution, and the bridge to PostHog Workflows and Resend.
- **Inputs:** sign-up and preference forms, `product_events` forwarding, Resend and PostHog bounce and complaint webhooks, Stripe billing events. **Outputs:** service emails via Resend; marketing sends via PostHog Workflows.
- **Owns:** `marketing_consents`, `email_suppressions`, `waitlist`, `newsletter_subscribers`, `utm_attributions`, `daily_briefs`, `mv_market_daily`.
- **Logic:** `canMarket(userId, category)` consulted before any marketing send; suppression sync both ways within an hour; UTM and Dub click capture at sign-up; SEO price pages rendered from `value_bands` nightly; the programmes in `docs/marketing.md` configured in PostHog with goal events; the Nabvy Daily task at 07:30 Europe/London: refresh `mv_market_daily`, one model call for the recap (validated: no numbers outside the bundle), render per-user sections from views, send through Resend in batches, publish `/daily/[date]`, post to channel bots, skip users with nothing new.
- **Tests:** a suppressed address is never sent to; consent categories honoured; unsubscribe link resolves and records; attribution stored once per user.

## billing-entitlements
- **Purpose:** turn Better Auth's Stripe subscriptions, boosts and lifetime flags into entitlements.
- **Inputs:** Stripe plugin lifecycle hooks; boost webhook. **Outputs:** `entitlement.changed`.
- **Owns:** `entitlements`, `usage_ledger`, `usage_balances`, `boosts`, `billing_events`, `referrals`.
- **Logic:** per `docs/billing.md`; entitlement view answers areas, cadence class, channels and hunt caps per user; the usage balance with expiring and non-expiring buckets, monthly grants, top-ups, charges and refunds; `chargeUsage(userId, action, refId)` is the single function every metered module calls inside the action's transaction.
- **Tests:** entitlement matrix per plan and status; grant, expiry and bucket order; charge refused at zero and refunded on failure; idempotent top-up webhook; boost expiry; referral credit applied once.

## ops-monitor
- **Purpose:** metrics, incidents, caps, kill switches.
- **Inputs:** every event, `provider_calls`, model usage from Langfuse. **Outputs:** `provider.paused`, `budget.alert`.
- **Owns:** `metrics_daily`, `incidents`, `kill_switches`, `audit_log`, `product_events`, the dashboard materialised views.
- **Logic:** `track(userId, event, properties)` writing `product_events` and forwarding to PostHog when the user has consented; daily rollups of freshness per source and tier, error and empty-result rates, provider spend, model spend per listing (from Langfuse), alert precision from user verdicts; five-minute refresh of the admin and user dashboard materialised views by pg_cron; kill switch per provider checked by adapters before every call; every admin action audited. Event names and properties in `docs/analytics.md`.
- **Tests:** rollup maths; kill switch honoured.

## review-console
- **Purpose:** the human loop.
- **Inputs:** `quarantine`, user feedback, valuation spot checks. **Outputs:** corrections and new fixtures.
- **Owns:** `review_queue`, `corrections`, `fixtures_index`.
- **Logic:** approve or correct facts and valuations; a correction writes the true value to the Price Book as an observation of kind `sold` or `ask` with a `correction` source flag and adds the case to `fixtures/`.
- **Tests:** correction propagation.
