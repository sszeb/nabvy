# Pricing model (recommended)

Synthesis, 2026-09-24: design 1's chassis; design 2's funded speed, anchors, Missed deals; design 3's prepaid hard stop, lone-safe floors, bands, taste. **[M]** measured, **[A]** assumed, **[P]** placeholder. Only $0.0177 a check (£0.0131 at 1.35) and costs derived from it are measured.

## Summary for the owner

| Tier | Monthly | Yearly | What it buys | Expected margin [A] |
|---|---|---|---|---|
| Free | £0 | – | 50 cr, 3 wants, daily digest, Missed deals, one 72-h Max taste | cost £0.10/month |
| Starter (1x) | £12 | £120 | 1,200 cr: one area at 15 min + 300 cr checking; 10 wants | 58% |
| Pro (5x) | £29 | £290 | 6,000 cr: two areas at 5 min + 2,000 cr; 40 wants | 68% |
| Max (20x) | £99 | £990 | 24,000 cr: eight areas at 5 min + 8,000 cr, 1-min bands; priority chat | 73% |
| Business | from £299 | contract | 80,000 cr, 5 seats, API, feeds, SSO, account manager | 73% |

Prices include VAT. Margins at 1,000 paying users; blended **68%**. Speeds are maxima, delivered where the area funds them.

- **Use it or lose it:** the fee is a prepaid credit allowance, granted monthly (yearly plans too) and expiring at the next renewal; spent credit rates fall with tier (Apify); nothing carries over (Claude).
- **Prepaid, hard stop:** at zero, checking stops and watching falls to the digest; top-ups at the tier's rate, opt-in auto-reload under a user cap; no arrears.
- **Every credit earns 40%:** any credit spent costs Nabvy ≤ 60% of the net cash that bought it, at the payer's rate. Checking units clear this at the lowest rate on sale; an area runs the fastest cadence costing ≤ 60% of the credits its watchers at that speed pay (the approved 60% rule, on credits spent).
- **Paid speed, shared cost:** each want is served at the interval it pays for. One check serves all watchers; prices never fall because others share, so the sharing gain is Nabvy's.
- **Hook:** a 72-hour Max taste, no charge, once per person, ending on the user's real numbers ("7 matching deals, 4 seen within 5 minutes") and a plan picker with nothing preselected.

**Scale, plainly:** profit £1.4k, £17.5k, £194k a month at 100, 1,000, 10,000 paying users (margin 55% → 68% → 75%; £14.21 → £17.52 → £19.37 per user). Cost follows areas, revenue follows users, so profit grows faster than users (×12.3, then ×11.1 per tenfold), but **not exponentially**: profit per user levels off near £20–25. It compounds only while the user base does; the density and referral loops are built for that.

## Tiers

| Tier | Gross / net rate per cr | Areas / wants | Max cadence | Support |
|---|---|---|---|---|
| Free | – | digest / 3 | daily digest | help centre |
| Starter | 1.00p / 0.790p | 2 / 10 | 15 min | email, 2 days |
| Pro | 0.483p / 0.386p | 6 / 40 | 5 min | chat, 1 day |
| Max | 0.413p / 0.332p (yearly 0.277p) | 20 / 150 | 1 min (bands, pins, dense areas) | priority chat |
| Business | 0.374p / 0.301p (contract ≥ 0.23p net) | 60+ | 1 min, round the clock | account manager, SSO |

Net rate = net cash ÷ credits. Before saving, the want screen shows credits as areas at a cadence, the area's live cadence, the unlock count ("6 more watchers unlock 15 min here") and the pin price.

## Unit prices

**Watching**, credits per area-month, daytime 07:00–23:00 (round the clock ×1.5; bands pro rata by hours).

| Cadence | cr | Lone cost [M] | Watchers to fund it [A mix] |
|---|---|---|---|
| hourly | 300 | £6.29 | 8 (6.29 ÷ 0.6 ÷ £1.38 per watcher) |
| 15 min | 900 | £25.17 | 10 (÷ £4.15) |
| 5 min | 2,000 | £75.52 | 25 (÷ £5.05; Pro and up only) |
| 1 min | 6,000 | £377.60 | 32 Max-rate 1-min watchers (÷ £19.91) |

- **Thin areas** (under 8 watchers): hourly for as many daytime hours as 60% of committed credits pay. A lone Starter's 900 cr fund 0.6 × 900 × 0.79p = £4.26 = 325 checks, about hourly 07:00–18:00: live, never a loss.
- **Pin (speed now):** credits = (band cost ÷ 0.6 − current funding) ÷ the payer's own net rate, from allowance or top-ups; they fund only as credits spent. Pro, 5 min Saturdays 08:00–11:00: 156 checks = £2.04 → 882 cr. Max, 1 min, same band: 779 checks = £10.22 → 5,130 cr.

**Checking.** Floor: cr × lowest net rate (0.23p, the Business bound; Max yearly 0.277p) ≥ cost ÷ 0.6.

| Unit | cr | Cost | Floor cr |
|---|---|---|---|
| Photo scan (cached comps) | 15 | 2p [P] | 14.5 |
| Live lookup, per source checked | 15 | 1.31p [A: one run] | 9.5 |
| Pasted-link lookup; similar-item search | 10 | ≤1.31p [A] | 9.5 |
| Export | 50 | ~0 [A] | – |
| Boost 24 h / 7 d (want to area's fastest cadence) | 150 / 500 | 0; faster is a pin | – |

Per-source lookups stay above the floor as sources arrive. Delivery is free. Checking costs ≤ 0.14p a credit [A].

## Rules

- **Order:** allowance (expires at renewal), taste and referral credit, top-ups oldest first. Top-ups never expire (approved) until the owner decides; recommended 12 months.
- **Top-ups:** £10, £25, £50 at the tier's rate; auto-reload £10 below £2, off by default, capped by the user; price shown before every metered action; daily checking soft cap, 25% of the allowance (Claude-style).
- **Funding:** only cash-bought credits fund speed; taste, referral and paused accounts never fund. Recomputed daily per area and band from measured area cost (Apify plus model calls). Charged at the cadence delivered.
- **Density guard:** contribution per paying user may not fall month on month; if a day's plan would lower it, step-ups wait, densest first. Never binds in the base case (watching 15.2% → 7.4% of revenue).
- **Upgrades** at once, prorated; **downgrades, cancellation** at period end, two taps.
- **Taste:** 72 h of Max at the area's fastest running cadence, or 15 min where none runs (≤ £2.52 [M]); 300 cr; reminder at 24 h; card check (never charged) where no one pays. Missed deals shows Free users what paid watchers caught, and how much sooner.
- **Yearly** = 10 months; allowance granted monthly.
- **Refunds:** none except where the law requires; then cash paid minus credits used at the payer's rate, never below zero. Failed actions reversed in the ledger (Apify cost still booked). Pause once a year, up to 3 months, wants kept.

## Unit economics

Net = fee ÷ 1.2 − (2.7% × fee + 20p) [A: card 1.5% + 20p, Billing 0.7%, Tax 0.5%; verify]. Revenue adds top-ups: 10% × £7.86 = £0.79. Overhead per user £2.01 = referral 0.25 + free users 0.50 + tastes 1.20 + disputes 0.06. Affiliates 6% of net (20% referred × 30%).

| Tier | Net revenue | Lone, full use | Expected at 1,000: watch + check + affiliates + overhead → margin |
|---|---|---|---|
| Starter | 10.00 − 0.52 = £9.48 | cost ≤ 5.69 → ≥ 40% | 1.51 + 0.25 + 0.57 + 2.01 = £4.34 of £10.26 → 58% |
| Pro | 24.17 − 0.98 = £23.18 | ≤ 13.91 → ≥ 40% | 2.92 + 1.36 + 1.39 + 2.01 = £7.69 of £23.97 → 68% |
| Max | 82.50 − 2.87 = £79.63 | ≤ 47.78 → ≥ 40% | 8.03 + 7.07 + 4.78 + 2.01 = £21.89 of £80.41 → 73% |
| Business | 249.17 − 8.27 = £240.89 | ≤ 144.54 → ≥ 40% | 22.77 + 24.94 + 14.45 + 2.01 = £64.17 of £241.68 → 73% |

Lone full use holds for yearly plans and pins (valued at the payer's rate). Commission is capped so Nabvy keeps ≥ 20% of net after direct cost (worst case 30% → 20%).

### Scale economics

[A] Mix 60/28/10/2; areas per user 1.2/2.5/8/25 = 2.72; Starter picks 15 min, others 5 min; areas A = 25 × (U/100)^0.54 (city by city); watchers per area Zipf (α 0.9); 45% of credit left after watching spent on checking; new payers 30% of U a month, 15% of tastes convert, so tastes cost 2 × (0.42 + thin share × 2.52) per user. Revenue = U × (24.96 fees + 0.79 top-ups). Other = U × (1.50 affiliates + 0.25 + 0.50 + tastes + 0.06). Fixed £1,000 [P], hourly sweep included.

| Paying users | 100 | 1,000 | 10,000 |
|---|---|---|---|
| Areas / average / largest watchers | 25 / 10.9 / 62 | 87 / 31.3 / 438 | 301 / 90.4 / 3,290 |
| User-areas at ≥ 15 min / at 5 min | 64% / 35% | 93% / 70% | 100% / 94% |
| Revenue | £2,574 | £25,744 | £257,439 |
| Apify (Σ areas × cadence cost) | £390 | £2,983 | £18,956 |
| Checking and top-ups | £266 | £1,735 | £13,274 |
| Other (4.97 / 3.51 / 3.15 per user) | £497 | £3,510 | £31,475 |
| **Profit / margin** | **£1,421 / 55.2%** | **£17,516 / 68.0%** | **£193,735 / 75.3%** |
| Per user / after fixed | £14.21 / £421 | £17.52 / £16,516 | £19.37 / £192,735 |
| Downside: all spare credit used | £1,114 | £15,567 | £179,222 |
| Round the clock everywhere | £1,302 | £17,097 | £194,686 |
| Cost per check ×2 (many terms, T2) | £1,130 | £15,757 | £184,748 |
| Tier pull, mix 50/32/15/3 | £1,899 | £22,583 | £246,088 |
| 150 / 600 UK areas | – | – | £202,199 / £185,581 |

Denser beats sparser. Density buys speed its own watchers pay for, then margin; areas step at different times, so profit per user rises smoothly.

**Year one** [A: 40% monthly growth], profit after fixed costs:

| Month | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Users | 100 | 140 | 196 | 274 | 384 | 538 | 753 | 1,054 | 1,476 | 2,066 | 2,893 | 4,050 |
| Profit £k | 0.4 | 1.1 | 2.0 | 3.3 | 5.3 | 8.0 | 12.0 | 17.6 | 25.5 | 36.8 | 52.8 | 75.3 |
| Per user £ | 14.21 | 14.79 | 15.21 | 15.74 | 16.30 | 16.75 | 17.20 | 17.60 | 17.96 | 18.32 | 18.59 | 18.85 |

## Competitive position

At $1.35; US prices exclude sales tax, Nabvy's include VAT.
- **Free** vs native alerts and DealScout free (hourly): adds valuation, scam flags, the taste.
- **Starter £12** vs DealScout £14.81, MM Starter £18.51 (5 min), willingness to pay £9.99: cheaper, a whole area with valuation, but 15 min.
- **Pro £29** vs MM Intermediate £33.33, Swoopa Pro £34.81: under both, 5 min where funded, 6 areas.
- **Max £99** (£82.50 ex VAT) vs MM Expert £74.07 and Expert Plus £125.92 ("instant"): 20 areas and full detail; 1 min only in bands, pins or dense areas.
- **Business £299** vs Swoopa top £260.74: 5 seats, API.
- **Honest gap:** lone all-day 1 min costs £378 a month; no floor-safe price matches Flipify (£7.41) or MM "instant" alone. Nabvy sells peak bands, breadth, detail.

## Profit maximisation levers

1. **Fill areas:** £5 referral credit both sides, unlock-bar invites, Dub affiliates, city-by-city launch (`attribution`, `lifecycle-messaging`, `search-planner`).
2. **Allowances above typical use:** spare credit expires monthly (`usage-ledger`, `subscriptions`).
3. **Top-ups, auto-reload, pins** at ≥ 40% margin (`usage-ledger`, `pricing-console`).
4. **Tier pull:** 5 min from Pro, falling rates, "Pro would have cost you £X less", the Max taste (`lifecycle-messaging`).
5. **Shared work:** one area check and one interpretation per listing serve every want; slower riders cost nothing (`check-scheduler`, pipeline).
6. **Floor, cadence rule, density guard** keep thin areas above cost and profit per user rising (`pricing-console`, `check-scheduler`).
7. **Supplier tiers:** Apify Scale/Business rates cut cost; prices never follow (not counted).

## Risks and gaming

What breaks the curve, and the guard:
- **Single-user areas:** thin-area hours at 60%; acquisition aimed at watched areas; density guard.
- **Power users at full allowance:** every credit ≥ 40%; hard stop; area caps; nothing unlimited.
- **Model calls per user:** per listing, never per want; per-user work only in metered units above the floor.
- **Cost per check rising with terms** [A]: funding uses measured area cost, so the area slows, never loses; T2 measures it.

Gaming: account sharing (2 devices, private Telegram chat only, never a group; paid seat later, D5); taste farming (email, phone, device keys, card check); self-referral; chargebacks (~£20 [A]: prepaid, stored consent, 3DS, top-ups blocked after a dispute, 30-day affiliate hold).

## Assumptions

All Scale economics inputs are [A], plus: one run per live or link lookup; Stripe split, UK cards; VAT registration; daytime watching by default; cost per check flat as terms grow (T2). [P]: photo scan 2p; fixed £1,000 a month.

## Decisions for the owner

- Ladder £12/£29/£99/£299 with 1,200/6,000/24,000/80,000 cr; Starter replaces Standard £9, Business £99 becomes Max; £12/£39/£119 would add ~20% profit if conversion held.
- Cadence: 60% applied to credits spent by watchers at that speed; wants served at their paid interval (replaces "everyone in a cell gets the cell's cadence").
- Density guard and thin-area hours as the watching floor (analytics-growth open point 1).
- 72-h Max taste replaces the 7-day card Standard trial.
- Checking: photo scan 15 cr (not 2p), lookups per source, packs £10/£25/£50, £4 extra area retired.
- Top-up expiry (never, or 12 months); affiliate commission capped to keep 20%.

Each goes to `questions.md`; `legal-review.md` gets a line each: expiring credit, auto-reload, no refunds, the taste.

## What changes in the build

- **`pricing-console`:** floor per credit at the lowest net rate on sale (yearly, Stripe 20p included); stores cadence prices, tier rates, the 60% share, `pinPrice(want)`, Business bound 0.23p, commission cap; recomputes daily from `cost-meter`.
- **`usage-ledger`:** each grant carries its net cash per credit; buckets and order as in Rules, non-funding buckets flagged; hard stop; watching charged daily at the delivered cadence, pro rata by band; daily soft cap; low-balance event.
- **`subscriptions`:** 6 recurring prices, Business contract, 3 packs; no metered prices; auto-reload off-session under the user's cap; prorated upgrades with pro-rata grant; taste is an entitlement, not a Stripe trial; pause; legal refunds net of credits used.
- **`check-scheduler`:** funded speed per area and band on measured cost, counting only cash credits at that speed or faster; thin-area hours; wants served at their paid interval; density guard; publishes live cadence and unlock count.
- **`lifecycle-messaging`:** taste end screen with real numbers, 24-h reminder, Missed deals, unlock invites, upgrade nudge, low balance.
- **`account-integrity`:** taste keys (email, phone, device; card check in unwatched areas); private-chat-only Telegram; 2-device limit; self-referral; top-ups blocked after a dispute.
