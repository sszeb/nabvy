# Pricing research — beta price ladder for Nabvy

Purpose: set beta prices for Nabvy (UK deal-finder: Facebook Marketplace, Gumtree, Vinted, eBay, CeX; alerts, price-vs-comps, scam flags) from what the market pays, not from cost. Cost is noted only as a funding check.

## 1. Competitors and near-competitors

| Name | What it does | Check speed | Price (paid) | Free tier | Source |
|---|---|---|---|---|---|
| Facebook Marketplace "Notify Me" (native) | Built-in saved-search alert | Slow, unpublished, user reports lag | Free | Yes, only tier | [How-To Geek](https://www.howtogeek.com/819768/how-to-set-up-facebook-marketplace-alerts/) |
| Marketplace Monitor | Multi-site alerts: FB, Gumtree, eBay, Craigslist, OfferUp, Kijiji, Depop, Vinted, Shpock | 5 min → 2 min → "instant", by tier | Starter $24.99/mo, Intermediate $44.99/mo, Expert $99.99/mo, Expert Plus+ $169.99/mo | 7-day trial only | [Trustpilot reviews via search](https://uk.trustpilot.com/review/marketplacemonitor.co.uk), [tier breakdown](https://carsnipe.com/blog/carsnipe-vs-marketplace-monitor) |
| Flipify | FB, eBay, OfferUp, Craigslist, Vinted, Mercari, Gumtree, Kijiji alerts, billed per watchlist | 10 min (Basic) or 1 min (Premium) | $5/mo per Basic watchlist, $10/mo per Premium watchlist | 7-day trial | [flipifyapp.com](https://www.flipifyapp.com/) |
| Swoopa | Multi-platform sourcing (FB, Craigslist, OfferUp, Kijiji, Gumtree, Nextdoor) | Tiered, fastest on top plan | Pro $47/mo (FB only) up to Business $144/mo, range to $352/mo | Free trial | [superflip.ai comparison](https://www.superflip.ai/swoopa-alternatives) |
| DealScout | FB Marketplace keyword/price/location alerts | 1 hour (free) or 5 min (paid) | $20–$100/mo (in-app tiers) | Yes, 1-hour alerts | [superflip.ai](https://www.superflip.ai/resources/facebook-marketplace-scanner-tools) |
| Vinotify | Vinted saved-search alerts | Free: 6 hr, expires 14 days. Paid: 1 min, no expiry | Plus/Premium/Pro up to £19.99+/mo (weekly or monthly billing) | Yes, 1 search | [vinotify.me/blog](https://vinotify.me/blog/best-vinted-alert-services/) |
| eBay saved search (native) | Built-in keyword alert, email/app/SMS | Near-instant on new listings | Free | Yes, only tier | [eBay Help](https://www.ebay.com/help/account/changing-account-settings/notifications?id=4203) |
| Trove | Third-party eBay alerts | <60 sec | Free, no subscription, up to 15 searches | Yes, only tier | Search result summary (Trove App Store listing) |
| uBuyFirst | eBay real-time arbitrage alerts + desktop/Slack/Telegram push | Seconds (via eBay API) | Free web app; extra computer seat $50/mo | Yes, core alerting | [ubuyfirst.com](https://ubuyfirst.com/ebay-alerts/) |
| Terapeak (eBay) | Sold-price comps, 3-yr history | N/A, lookup | Free core; Sourcing Insights needs Store ~$22/mo+ | Yes, core | [litcommerce.com](https://litcommerce.com/blog/ebay-terapeak/) |
| ScoutIQ | Barcode-scan sourcing: profit, rank, demand | Real-time scan | $14–$44/mo | No | [threecolts.com](https://www.threecolts.com/seller-365/scoutiq) |
| Vendoo | Cross-lister + sourcing | N/A, listing tool | $8.99–$69.99/mo | Limited | [nifty.ai](https://nifty.ai/post/app-for-resellers) |
| ZIK Analytics | eBay research, sold comps | N/A, research | $39.9–$89.9/mo | No | [zikanalytics.com](https://www.zikanalytics.com/pricing) |
| CamelCamelCamel | Amazon price history + drop alerts | Continuous | Free, no paid tier | Yes, all | [camelcamelcamel.com](https://camelcamelcamel.com/) |
| Keepa | Amazon price/sales history, API | Continuous | ~$19/mo for pro | Yes, base | [goaura.com](https://goaura.com/blog/camelcamelcamel-vs-keepa) |

**Pattern:** every native marketplace alert (Facebook Notify Me, eBay saved search) is free and slow/uncertain-speed. Every third-party tool that sells *speed* (sub-15-minute or sub-1-minute checks) charges for it, and prices scale with speed: cheapest fast tier clusters at $5–25/mo, multi-platform "instant" tiers reach $45–170/mo. Sold-price/valuation tools (Terapeak, ZIK, ScoutIQ) are priced and sold separately from alert speed.

## 2. Willingness to pay

- Marketplace Monitor, Trustpilot: *"Price may seem high but it's worth every penny as you make it back in one flip"* — value driver is alerts landing "before anyone else," not price. (moderate — small sample, from search snippets not read verbatim)
- Flipify App Store: *"Definitely worth the $20 a month"* (tool is $5–10/mo per watchlist). A second reviewer on a buggy trial: *"it wasn't even worth that"* — complaint was reliability, not price. (moderate)
- Flipping-community sourcing tools (Gumroad-hosted) cluster at $15–35/mo for niche deal-list/cook-group services (e.g. a GPU/hot-product Discord group at $35/mo); one estimate put "seriously starting" flipping costs under $100/mo across two tools. (weak — seller-published figures, not verified spend data)
- No UK-specific r/Flipping or PC-building thread with explicit price figures for a Facebook/Vinted alert tool surfaced in this pass; the ladder below leans on the paid apps' own list prices and reviews instead.
- Anchor effect: eBay's and Facebook's own alerts are free, so "free but slow" is the default comparison — paid tools justify price on speed and reach, matching Nabvy's own pitch.

**Caveat:** direct fetch to several candidate sources (flipifyapp.com, getswoopa.com, vinotify.me, most app-store review pages, Reddit) was blocked by the network egress proxy; figures above come from search-result snippets and secondary write-ups, not primary pricing pages. Confirm against live pricing pages before publishing prices.

## 3. Recommended beta ladder

| Tier | Price | What it buys | Reasoning | Evidence |
|---|---|---|---|---|
| **Free** | £0 | 1 saved search, hourly checks, core alert only (no valuation, no scam flag detail) | Matches DealScout's and Vinotify's free tiers (1 hr / 6 hr) and the native-alert baseline; gives a real taste without giving away the speed that competitors charge for | Moderate — directly mirrors two live competitor free tiers |
| **Standard** | £9.99/mo or £89/yr (≈26% off) | Several saved searches, 15-minute checks, price-vs-comps shown, basic scam flag | Sits just above Flipify's Premium watchlist ($10/mo ≈ £8) and below Marketplace Monitor's Starter ($24.99 ≈ £20); undercuts the cheapest multi-platform "fast" competitor while beating Flipify on scope (valuation + scam flags, not just alerts) | Moderate — anchored to two directly comparable list prices |
| **Pro** | £19.99/mo or £179/yr (≈25% off) | More/unlimited searches, 5-minute checks, full valuation + scam detail, early access to photo-scan and eBay-draft features | Matches Marketplace Monitor's Intermediate tier ($44.99 is 2x this, but that tool is alerts-only across more sites; Nabvy adds valuation) and undercuts DealScout's and Swoopa's mid/upper tiers, positioning as the "serious hobbyist/small trader" plan | Moderate-to-strong — three corroborating competitor price points in the same band |
| **Metered add-on** | e.g. £2 for 5 extra fast-checks or photo scans, in-app | Fits occasional bursts (a one-off car-boot-sale scan, a rush week) without changing the base plan | No competitor in this set sells alert speed as metered credits — they all use flat monthly speed tiers. A credit pack fits better for the *occasional-use* features (photo-to-value scans, eBay draft generation) than for core alerts, where flat tiers match user expectations | Weak — inferred from absence of a metered pattern among alert competitors, not directly observed |

Yearly discount (~25%) is a generic SaaS convention, not something sourced to this market specifically — weak evidence, safe default.

## Cost-funding check (flag, not a driver)

At Nabvy's measured $0.0177/area check: 15-minute checks ≈ $51/area/month, 5-minute checks ≈ $153/area/month, before pooling across users watching overlapping areas/items.

- **Standard (15-min, £9.99/mo ≈ $13)** and **Pro (5-min, £19.99/mo ≈ $26)** only fund themselves if checks are pooled across users per area/category — standalone they'd cost ~4x and ~6x the subscription respectively. Nabvy's pipeline already batches (100–500 listings/run), so pooling is the intended model, but per-area economics depend on overlapping demand, not standalone unit cost.
- **Sharpest flag — Flipify Premium ($10/mo) and Vinotify Pro (~£20+/mo), both 1-minute checks**: standalone cost under Nabvy's economics is ~$765/area/month, 75×+ the price. Either these competitors pool very aggressively, their per-check cost is far below Nabvy's Facebook-actor cost, or they're priced below cost as a loss-leader. Do not assume Nabvy can match a 1-minute tier at $10–20/mo on the Facebook side without heavy pooling or a cheaper check.
- **Marketplace Monitor's Expert Plus+ ($169.99/mo, "instant"/24-7)** is the one tier priced high enough to plausibly cover near-1-minute checks for a single dedicated area — evidence that an unpooled "instant" tier genuinely needs $150+/mo.

## Sources

- https://www.howtogeek.com/819768/how-to-set-up-facebook-marketplace-alerts/
- https://uk.trustpilot.com/review/marketplacemonitor.co.uk
- https://carsnipe.com/blog/carsnipe-vs-marketplace-monitor
- https://www.flipifyapp.com/
- https://www.superflip.ai/swoopa-alternatives
- https://www.superflip.ai/resources/facebook-marketplace-scanner-tools
- https://vinotify.me/blog/best-vinted-alert-services/
- https://www.ebay.com/help/account/changing-account-settings/notifications?id=4203
- https://ubuyfirst.com/ebay-alerts/
- https://litcommerce.com/blog/ebay-terapeak/
- https://www.threecolts.com/seller-365/scoutiq
- https://nifty.ai/post/app-for-resellers
- https://www.zikanalytics.com/pricing
- https://camelcamelcamel.com/
- https://goaura.com/blog/camelcamelcamel-vs-keepa
