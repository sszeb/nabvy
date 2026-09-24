# Providers

All sources are reached through the `ProviderAdapter` interface in `docs/contracts.md`. Adapters never parse HTML. Every call is metered into `provider_calls` with cost, latency and status. Each provider has a daily spend cap; reaching it pauses the provider and emits `provider.paused`.

## Facebook Marketplace — Nabvy's own actor on Apify (primary)

- **Access:** `apify-client` with `APIFY_TOKEN`; actor ID in `APIFY_FB_ACTOR_ID`. Run with `run-sync-get-dataset-items` for watches (expected under 60 s) or a normal run with dataset read if the actor is longer-running. Use Standby mode if the actor supports it, so watches answer without a container start.
- **Watch input per crawl unit:** Marketplace location ID or city slug and radius (40 km) for the cell; category slug (computers sub-category where available, else electronics) or the pack's query list; sort newest first; date listed last 24 hours; minimum price £5; high-water mark (last 200 listing IDs seen and newest listed-at); page cap 3; item cap 100; detail fetch off; pass-through `crawlUnitId` and `cellId`.
- **Detail input:** up to 50 listing URLs or IDs; description, all photos, attributes, delivery method, public seller ID; seller names not requested.
- **Stub fields required:** listing ID, URL, title, price, currency, location text, coordinates if present, thumbnail, listed-at as shown by Facebook, sold or pending flags, delivery method, category, public seller ID.
- **Adapter contract with the actor.** Backlog task 1.0 records the actor's real input and output field names in `services/source-adapters/README.md`. The adapter maps them to this target shape; if a required field is missing from the actor's output, the task stops and records it in `docs/questions.md` so the actor can be extended.

```
Actor input (target)                     Actor output per item (target)
{ locationId | citySlug, radiusKm,       { id, url, title, price, currency, locationText,
  category | queries[], sortNewest,        lat?, lng?, thumbnailUrl, listedAtText, listedAtIso?,
  daysSinceListed, minPrice,               isSold?, isPending?, deliveryMethod?, categoryId?,
  knownIds[], sinceListedAt?, maxPages,    sellerId? }
  maxItems, fetchDetails, passthrough{} }  Detail adds: { description, photoUrls[], attributes{} }
```
- **Metrics from the run:** pages fetched, items returned, new items, bytes transferred, blocked responses, duration.
- **Known limits:** anonymous browsing returns about 20–24 listings per request and no deeper paging; cadence must be short enough that new listings per interval fit in that page; the listed-at label is rounded, so `listedAtPrecision` is `minute` or `hour`.
- **Fallback:** a second Facebook actor from the Apify Store, chosen in the first-week comparison (`APIFY_FB_ACTOR_FALLBACK_ID`), with the same input mapping.
- **Cap:** `FB_DAILY_CAP_MINOR` per day across both actors; default £10 until measured.

## eBay — official APIs

- **Auth:** client credentials (application token) for Browse; authorization-code user tokens for Sell. Marketplace header `X-EBAY-C-MARKETPLACE-ID: EBAY_GB`. Affiliate header `X-EBAY-C-ENDUSERCTX: affiliateCampaignId=<EPN campaign id>` on Browse calls so returned item URLs carry tracking.
- **Browse `item_summary/search`:** parameters `q` or `gtin`, `category_ids`, `filter` (for example `buyingOptions:{FIXED_PRICE}`, `itemLocationCountry:GB`, `price:[50..2000]`, `conditions:{USED}`), `sort=newlyListed`, `limit` up to 200. Item summaries include `itemCreationDate`, so `listedAtPrecision` is `exact`.
- **Browse `getItem`:** full description, image URLs, item specifics, `estimatedAvailabilities` (used by the lifecycle recheck to detect ended and sold-out items), seller feedback counts.
- **Browse `search_by_image`:** POST with a base64 image; returns visually similar live listings. Used only in scan mode.
- **Marketplace Insights `item_sales/search`:** 90 days of sold listings by query or GTIN. Limited release; the adapter exists behind a feature flag and activates when `EBAY_INSIGHTS_ENABLED` is true.
- **Sell APIs (inventory-resale only):** Inventory API `createOrReplaceInventoryItem`, `createOffer`, `publishOffer`; scopes `sell.inventory`; refresh tokens stored encrypted.
- **Limits:** 5,000 Browse calls per day on the free tier; request an Application Growth Check before that; cache product lookups by GTIN for 24 hours; one call per watch per unit.
- **Sold-price signal without Insights:** watch newly listed fixed-price items for tracked product keys; on recheck, an item that ended with availability at zero is recorded as `kind: 'ended'` with its last price. Treat `ended` as weaker evidence than `sold`.

## CeX — web API (low volume, cached, capped)

- **Base:** `https://wss2.cex.uk.webuy.io/v3` (config `CEX_API_BASE`). Responses wrap `{ response: { ack, data, error } }`.
- **Endpoints used:** `/boxes?q=<text>&firstRecord=1&count=50&sortBy=relevance` for search; `/boxes/<boxId>/detail` for `cashPrice`, `exchangePrice`, `sellPrice`, `ecomQuantityOnHand`, `outOfStock`, category and attributes; `/boxes/<boxId>/neareststores?latitude=&longitude=` for store stock and distance; `/boxlists/mostwanted` for the demand list; `/supercats`, `/productlines`, `/categories` for the taxonomy.
- **Mapping:** `boxId` is often the EAN; the pack dictionary stores `cexBoxIds` per product key. Observations written as `cex_cash`, `cex_voucher`, `cex_sell`.
- **Caps and manners:** at most 300 calls per day (`CEX_DAILY_CAP_CALLS`), 24-hour cache per box, one request at a time with 500 ms spacing, exponential backoff on errors, kill switch honoured. This is an unofficial API and may change; a licensing request to CeX and CeXDB is the preferred long-term route, and an Apify CeX price actor is the fallback.

## Gumtree — Apify Store actor

- **Access:** `apify-client`, actor ID in `APIFY_GUMTREE_ACTOR_ID`, chosen for newest-first search by location and category with listing-time output. Same watch and detail mapping as Facebook; cap `GUMTREE_DAILY_CAP_MINOR`.

## Vinted (later)

- Through an Apify Store actor when the pack for clothing or Vinted electronics is added. Not in version 1.

## Comparison and selection

In the first week, run the primary and fallback Facebook actors on the same cell at a 5-minute cadence for seven days and record: cost per new listing found, median and p95 latency, error and empty-result rate, and the share of PC listings whose GPU appears only in the description. Choose primary and secondary on those numbers and write them into `docs/decisions.md`.

## Health and fail-over

`health()` returns the last hour's error rate and p95 latency from `provider_calls`. A unit fails over when the primary's error rate exceeds 20% or p95 latency exceeds 15 s, and returns to primary after 30 minutes of healthy calls. A provider whose secondary also fails is paused and the source shows "delayed" in the app.
