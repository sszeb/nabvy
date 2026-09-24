# Scan mode

Point the phone camera at an item and get, within seconds: what it is, what it sells for, the CeX cash floor, a days-to-sell range, the margin against the sticker price, risk flags and a verdict; then list it on eBay or save it to inventory. Scan mode reuses the Price Book, Valuation Engine and Risk Screener and adds Recognition and Inventory & Resale.

## Flow

1. **Capture.** The PWA opens the camera. The Barcode Detection API (ZXing fallback) reads EAN/UPC codes locally. Otherwise the user takes a photo; a second optional photo of the price tag.
2. **Identify (Recognition).**
   - Barcode → `products.eans` → product key; else `cex-web` box lookup by EAN.
   - Photo → vision model with the recognition contract: structured description (type, brand, model, colour, material, size, condition), up to three candidate product keys with confidence, search phrases, sticker price if a tag is visible.
   - Confidence below 0.8 → the app shows the top candidate and asks the user to confirm or pick.
3. **Cache check.** If a value band exists for the product key and is fresher than 24 hours, go to step 5.
4. **On-demand fetch.** Runs as a Trigger.dev task started by the scan procedure; the client follows progress through Trigger.dev Realtime. In parallel through the adapters: eBay `item_summary/search` by GTIN or phrases (live asks) and `search_by_image` (similar items); eBay sold signal (Insights when enabled, else recent `ended`); `cex-web` price; Facebook and Gumtree asks through the Apify actors with the search phrases and the user's location. Results are written as observations, the photo is embedded, and the band is computed. A visible progress state shows each source completing. Budget per scan: `SCAN_SPEND_CAP_MINOR` (default 5p); daily per-user cap by tier.
5. **Value and screen.** As in `docs/valuation.md`, with the sticker price as the asking price. Days-to-sell and local fair-price range included.
6. **Card.** Blocks in order: what we think it is (tap to correct); verdict and margin; fair value with 90-day sparkline and trend; CeX cash and voucher, nearest store stock; days to sell; risk flags; comparables (same item live now, similar items live now, what similar items did); actions.
7. **Actions.** List on eBay (draft via Sell APIs, published only on tap); save to inventory with cost; listing pack for other marketplaces (copy title, description, price, photos); share.
8. **Outcome capture.** Later, two taps record "sold for £X on Y" against the inventory item.

## Similar-item search (no barcode, no model)

For sofas, bikes, tools and similar items:
- Same item: exact product key matches where a named model exists.
- Similar items: eBay `search_by_image` results plus similarity search over `listing_embeddings` (cosine distance under the pack threshold) and provider text search with the phrases; ranked by similarity, distance and freshness; each with marketplace, price, distance, days listed, similarity score.
- What similar items did: ask range over 30 and 90 days, share gone within 30 days and median days from lifecycle, price cuts before gone.
- Output is a range with confidence, never a single number. Coverage depends on what has been ingested in the area.

## Guardrails

- Every scan is a metered action: the price (cached or live) is shown before it runs and debited from the usage balance through `chargeUsage`; the card shows "checked live" when on-demand fetch ran. Provider spend per scan is additionally capped at `SCAN_SPEND_CAP_MINOR` so a runaway fetch cannot exceed the price charged.
- Values built from asks alone are labelled `ask_based`.
- No scan is sent to a model when a barcode resolves; photos are deleted from storage after 30 days unless saved to inventory.
- Categories excluded from scan mode at launch: DVDs.

## Tests and acceptance

- Identification: at least 80% correct on 100 test items across the first pack's categories; confirmation prompt on all low-confidence cases.
- Latency: cached scan under 2 s; first-time on-demand scan under 10 s median.
- Verdict agreement: at least 70% with hand valuation on the fixture set.
- eBay draft: payload validates against Inventory API schemas in the Sandbox.
