# Valuation, risk and days-to-sell

All numbers come from statistics over real observations. Models never produce a price. Parameters below are configuration in the category pack or `services/valuation/config`, with the defaults stated; change them from measured data only.

## Inputs per product key (from the Price Book)

- Sold observations (`sold`, `ended`, corrections) over the last 90 days, with condition where known.
- Ask observations (`ask`) currently live, per source.
- CeX `cex_cash`, `cex_voucher`, `cex_sell` and stock signals.
- Lifecycle signals: for each tracked listing, first seen, last seen, gone-at.

## Value band

1. **Recency weighting.** Each sold observation gets weight `w = 0.5 ^ (ageDays / 30)`; `ended` observations get half that weight. Compute the weighted median (mid), weighted 25th and 75th percentiles (low, high).
2. **Trend.** Compare the weighted sold median of the last 30 days with the previous 30 days, and the live ask median with the sold median. `rising` when both exceed +5%, `falling` when both fall below −5%, otherwise `flat`; `unknown` when either side has fewer than 3 observations.
3. **Trend adjustment.** Shift mid, low and high by half the 30-day change, capped at ±10%.
4. **Staleness.** If the newest sold observation is older than 30 days, or the trend is steeper than ±20%, multiply confidence by 0.7 and blend the mid towards the ask median: `mid = 0.6 × mid + 0.4 × (askMedian × (1 − askHaircut))`, `askHaircut` default 0.12. State becomes `ask_based` when there are fewer than 3 sold observations but at least 5 asks.
5. **Unvalued.** Fewer than 3 sold observations and fewer than 5 asks → state `unvalued`; the card shows the raw comparables and no number.
6. **Floor.** `floorMinor = cex_cash` when present. If asking price ≤ floor, the card shows a "below CeX cash price" badge and the margin is computed against the floor as the guaranteed exit.

## Listing valuation

1. **Condition and spec.** Multiply the band by the pack's condition multiplier (defaults: `new` 1.10, `used_working` 1.00, `untested` 0.70, `faulty` 0.35, `unknown` 0.85). Apply variant adjustments from the dictionary where a variant is known (for example VRAM size).
2. **Bundles.** For a PC, value = sum of component mids × (1 − `bundleHaircut`), default haircut 0.15, plus a fixed allowance for case, PSU and assembly from the pack. Components with no band are excluded and the confidence is reduced by their share of the expected value.
3. **Costs.** `fees = feePct × fairMid + feeFixed` (defaults 0.129 and 30p, to be confirmed against eBay's current UK fee page and set per pack); `postage` from the pack for posted items; `travel = travelPerKm × distanceKm × 2` for collection (default 25p per km); `expectedRepair` from the pack when condition is `untested` or `faulty`.
4. **Margin.** `margin = fairMid × (1 − feePct) − feeFixed − postage − travel − expectedRepair − askingPrice`.
5. **Deal score (0–100).** `score = clamp(50 + 50 × margin / fairMid, 0, 100)` multiplied by confidence, then reduced by `20 × riskScore`. A score of 60 is the default alert threshold.
6. **Confidence (0–1).** Start at 0.5; +0.1 per 5 sold observations up to +0.3; +0.1 when a CeX price exists; −0.2 when the product key came from similarity rather than a barcode or dictionary match; ×0.7 for staleness; minimum 0.1.

## Days to sell

1. **Sell-through rate** over 30 days for the product key: `str = sold / (sold + activeAtEnd)` using `sold` plus `ended`; fall back to lifecycle: share of tracked listings gone within 30 days.
2. **Median days to sell** from lifecycle data where at least 10 listings are tracked; otherwise from the table: `str ≥ 0.8` → 3 days; `0.6–0.8` → 7; `0.4–0.6` → 14; `0.2–0.4` → 30; `< 0.2` → 60+.
3. Report a range: low = median × 0.5, high = median × 2, widened when `unknown` trend. CeX stock churn (how often a box returns to stock) raises the estimate when strong.

## Risk score

Weighted sum of triggered rules, clipped to 0..1. Default weights: `price_far_below_floor` 0.35, `deposit_request` 0.30, `stock_photo` 0.20, `reused_photos` 0.20, `new_seller` 0.15, `mining` 0.15, `untested` 0.10, `parts_only` 0.10, `wanted_post` 1.0 (drop), `empty_box` 1.0 (drop). Flags are always shown with the evidence that triggered them.

## Model escalation

Extraction uses Haiku by default. Escalate to Sonnet (or vision on the first photo) when `askingPriceMinor ≥ 30000` (£300) or mean field confidence < 0.7. Both thresholds are configuration and are reviewed after the first week using extraction cost and correction rates from the Review Console.

## Explanation template

"Asking £{ask}. Similar {product} sold for £{low}–£{high} in the last 90 days (median £{mid}, {trend}). CeX pays £{cexCash} cash. After fees and {collection|postage}, expected margin £{margin} ({dealScore}/100). {flagsSentence}" A model may rephrase this for readability but may not change or add any number.
