# Abuse and cost-exploit threat model (task 4.3t)

From `docs/decisions.md`, "Sign-up throttle and surge stop" (owner, 2026-09-24, 17:08): a written threat model of cost and abuse exploits with a test plan, adversarially checked, before the free tier opens. Inputs: the four decisions on the free tier, hard caps, the sign-up throttle and metered watching; backlog 4.9a, 4.10a, 1.6c–1.6e, 7.1a, 4.3q–4.3u; `docs/security.md`; `docs/engineering.md`, "Rate limits and abuse"; the cards and READMEs of `account-integrity`, `account`, `spend-governor`, `usage-ledger` and `apify-gateway`.

## Summary

**The money bound is the caps, not identity checks.** A patient attacker gets past per-IP, per-device and per-email-domain limits with residential proxies, fresh browsers and Gmail. What bounds the cost is the chain behind those limits: the admission rate, the circuit breakers, the free-burst pool, the £2 lifetime cap per account, the daily, weekly and monthly spend caps checked before every paid submit, the gateway's monthly cap and Apify's platform limit. Identity checks raise the attacker's cost per account. They do not stop spending.

**The first line: 100 accounts, not thousands.** With the chain built as designed (4.3s, 1.6c–1.6e, 4.9a), 100 burner accounts that sign up in one minute cost at most the day's free pool plus the reservations in flight: **£20 + ≤ £2 a day**. The breaker trips inside the first minute, and admission pauses until an admin resets it. The real damage is not money. The attacker **drains the free pool**, so genuine free users wait (lost revenue), and on current numbers can **drain paid headroom** too (gap G7).

**Seven findings change the plan:**
1. **Guards in shadow do nothing** (G1). `account-integrity` ships in shadow and its channel checks allow everything while the module is off. The free-tier guards (4.3q, 4.3s) must be hard from day one, and free admission must hold when the module is off.
2. **Delete and rejoin resets the £2 cap** (G2). The deletion purge removes everything except a *banned* account's evasion keys. Trial keys (`trial_email`, `trial_card`, `trial_device`) and a canonical email hash must survive deletion. Otherwise the lifetime cap is only a per-account cap.
3. **Reservations are about 19 times the real cost of a check** (G6). The recorded run reserved $0.3363 and settled at $0.0177. A synchronous gate that counts reservations, as the decision requires, would stop a free window after about six 1-minute checks and let the £20 pool fund only about six lone areas at once. Reservations must be sized from each run's own cap, and the gate and the reservation must happen in one locked step.
4. **The free pool does not fit inside the monthly Apify cap** (G7). The £20-a-day floor comes to £600 a month; the gateway's hard cap is $150 (about £120) a month for everyone. Floods on six days could stop every paid watcher for the rest of the month. The free pool needs a monthly ceiling set as a share of the provider cap.
5. **A rate limit is not a budget** (G10). 30 scans a minute per user is 43,200 paid model calls a day. Scans and pasted links must be charged to credits or to the free cap, and pass the spend gate.
6. **Replays can re-announce "first seen"** (G11). An admin retry sends with a fresh idempotency key (0.9a). Unless first-seen is written once per listing, a replayed or late run re-alerts every watcher and repeats the model calls.
7. **Watching must be prepaid** (G9). A paid want with a wide radius at a 1-minute interval can spend faster than a balance checked after settlement can stop. Credits must be reserved before each check, and each user needs a monthly spending limit.

The table below lists 31 exploits. Each row gives the guard, the module that owns it, the fixture that proves it, the run-off bound where the exploit costs money, and the gap where no guard exists yet. The gaps are backlog rows G1–G16 in `docs/backlog.md`. The owner's one-minute list is the "Day-one checklist".

## Assumptions behind the pound figures

- A lone search check costs 1.31p (measured). Window one is 68p lone; windows two and three are 43p each. The lifetime cap is £2 per account. The free pool is £20 a day, or 5% of last month's net revenue if that is higher. The gateway cap is $150 a month, about £120 at 0.79.
- **Run-off** means spend past a cap after it is hit. The decision bounds it by the reservations in flight: at most C × R, where C is the paid-submit concurrency cap and R is the largest reservation for one run. The caps are set so that C × R stays under 10% of the smallest cap it guards: ≤ £2 on the £20 pool and ≤ £1 on a £10 daily cap (the 1.6d fixture). These bounds hold only once G6 is built, because the gate and its reservation must be atomic.
- Model calls are metered by the same gate (1.6d names model callers). A model call made outside the gate is a finding in itself.

## Threat table

"Built" means code on `main`. "Planned" means a backlog row. "Gap" names a new row in `docs/backlog.md`.

### A. Sign-up and identity

| # | Exploit | Guard | Owner | Fixture that proves it | Run-off | Gap |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | **Sign-up flood**: 100 accounts in a minute from rotating residential IPs, each firing a free burst in a distinct lone area | Edge: Turnstile, Cloudflare rate rules, Bot Fight Mode (4.3u). App: 5 sign-ups an hour per IP (engineering). Per-IP, device and domain limits (4.3q). Global throttle and admission queue (4.3s). Breakers on sign-ups, young-account submits and cost per minute (1.6e). Free pool (1.6c). Lifetime cap (4.9a). Planned | `account-integrity`, `spend-governor`, edge | `signup-flood-100`: 100 sign-ups from 100 IPs in 60 s. At most the policy's number are admitted and the rest are queued in order. The breaker trips before a concurrency cap's worth of submits. Free spend ≤ pool + C × R. The run is repeated with 1,000 sign-ups | ≤ £22 a day (pool + run-off). The 100 accounts' combined £200 lifetime is never reachable in a day | G1 (guards hard from day one) |
| A2 | **Aliases**: `a+1@gmail.com`, dotted Gmail, catch-all domains, many Google accounts | Disposable domains refused (4.3q). Planned, but no canonical form of the email is defined | `account-integrity` | `email-canonical`: plus-tags, Gmail dots, `googlemail.com` and case all hash to one trial key. A catch-all domain seen more than N times a day is throttled | Per account ≤ £2; overall bounded by A1 | G2 |
| A3 | **Delete and rejoin** to reset the £2 lifetime cap and the three windows | None. `account.deleted` purges every row except a banned account's evasion keys (card, question 37) | `account-integrity`, `usage-ledger` | `rejoin-after-delete`: delete, then sign up with the same canonical email, card or device. The new account inherits the spent cap and the used windows | Unbounded per person without G2 (£2 per rejoin); bounded overall by the pool | **G2** |
| A4 | **Free-burst farming**: a steady 30 accounts a day, each run to window one | Pool (1.6c). The card check before windows two and three (4.3q) confines the farm to window one. Per-area anomaly stop (4.3q) | `spend-governor`, `account-integrity` | `pool-starvation`: 30 farm accounts and 5 genuine accounts on one day. The genuine accounts that land in areas already funded still run. Farm accounts in lone areas take their turn from the lone-area sub-pool, not ahead of others | ≤ £20 a day, but the pool is lost to genuine users (revenue) | **G7** (sub-pool, risk-weighted admission) |
| A5 | **Wide radius on a free want**: one want covering 40 areas makes each check 40 times the cost | Lifetime cap stops the account at £2, but a single window then drains the pool 40 times as fast | `check-scheduler`, `pricing-console` | `free-wide-radius`: a free want over 40 areas has the same cost per window as one over a single area (cadence scales down) | ≤ £2 per account | **G8** (question 1) |
| A6 | **Magic-link email bombing**: requests for victims' addresses, which burns email sends and the sender domain's reputation | 5 magic-link requests an hour per email; Turnstile on magic-link requests (security.md). Built in part | `auth`, edge | `magic-link-flood`: 1,000 addresses from 50 IPs. At most the global send cap goes out; the rest are refused without revealing whether an address exists | Email cost is small; the loss is deliverability for every user | **G5** (global send cap) |
| A7 | **Guards off or in shadow**: `account-integrity` in shadow or switched off, so `checkChannelBinding()` allows everything and sign-up limits record without acting | None. The card says the module ships in shadow; `account` allows channel binding "when off" | `account-integrity`, `switches` | `integrity-off-holds-free`: with `account-integrity` off or in shadow, no new free window is admitted and paid users are unaffected | Without G1, the limit is only the pool and the caps | **G1** |

### B. Cards, credits and referrals

| # | Exploit | Guard | Owner | Fixture that proves it | Run-off | Gap |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | **Card-check bypass**: a new virtual card number for each account (Revolut, Monzo, privacy cards), or prepaid cards | One card per account, keyed by the Stripe fingerprint (4.3q). Planned, but each virtual number has its own fingerprint | `account-integrity`, `subscriptions` | `card-check`: a card with `funding: prepaid` is refused. A second account whose card shares a device, network or canonical email with an account that already used windows two and three is refused | ≤ 86p per extra account (windows two and three); bounded by the pool | **G3** |
| B2 | **Card testing**: a stolen-card list tested through the never-charged check | None beyond Turnstile on sign-up | `subscriptions`, `account-integrity` | `card-testing`: 20 SetupIntents from one IP or device in an hour. After the policy's number (initially 3 an account a day, 10 an IP a day) the check is refused, and the Radar rule to block is on | Stripe fees are small; the loss is a Stripe account restriction, which ends all billing | **G3** |
| B3 | **Referral self-dealing**: burners sign up through the attacker's own link | `usage-ledger.grant()` is idempotent on `refId`. The referral rules are not written | `attribution`, `usage-ledger` | `referral-self`: a referee in the referrer's linked group earns nothing. A credit is paid only after the referee's first paid purchase has cleared its dispute window, capped per referrer per month | Credits worth ≤ the monthly cap per referrer | **G13** |
| B4 | **Top up, spend, then charge back** | Chargebacks feed `v_billing_signals` into `account-integrity`. No clawback is defined | `subscriptions`, `usage-ledger` | `dispute-clawback`: a disputed top-up freezes that top-up's unspent credits, lets the balance go negative for the spent part, and holds paid watching until the balance is settled | ≤ one top-up; bounded by the top-up size ladder | **G12** |
| B5 | **Reversal gaming**: forcing failures (a deleted want, cancelling mid-run) to earn ledger reversals while still getting results | Reversal only on failure (card). Who may call a reversal is not defined | `usage-ledger` | `reversal-only-provider-failure`: a reversal needs a failed job ID from `apify-gateway` or the model caller; a cancellation by the user reverses nothing already spent | Small | G12 (the same row) |
| B6 | **Promotion stacking**: a per-user offer, a bundle discount and a referral credit together push the price below cost | Floor: every price is cost × margin, and anything below cost plus the minimum margin is refused (decision). Planned | `pricing-console` | `offer-stack-floor`: the worst stack of every live offer still clears the floor | None; refused | None; the fixture goes in the `pricing-console` build |
| B7 | **Postpaid drain**: a watch runs on a balance that is checked only after settlement | Refusal at zero (`chargeUsage`). Estimate before save. Low-balance top-up hint | `usage-ledger`, `check-scheduler` | `prepaid-watch`: a want reserves credits for each check before submit. At zero it pauses at the next check, not after settlement | ≤ one check interval of the want | **G9** |

### C. Channels and webhooks

| # | Exploit | Guard | Owner | Fixture that proves it | Run-off | Gap |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | **Telegram link-code guessing or hijack**: guess an outstanding 8-character code from a bot chat, or confirm a leaked code | Codes are single use, expire in 10 minutes, are stored as sha256, are issued only from an established device, 5 an hour. Built | `account` | `link-code-guess`: after 5 wrong codes from one `chat_id` in 10 minutes, that chat is refused for an hour. A code confirmed twice is refused the second time (built) | None | **G4** (attempt limit per chat) |
| C2 | **Telegram webhook forgery or replay** | "Telegram webhooks verify signatures" (security.md). Telegram does not sign updates; it sends a secret-token header | `account`, `notifier` | `telegram-webhook`: a missing or wrong `X-Telegram-Bot-Api-Secret-Token` returns 401, compared in constant time. A repeated `update_id` is a no-op | None | **G4** |
| C3 | **Stripe webhook replay** grants a top-up twice | Signature with timestamp tolerance; `grant()` idempotent on `refId`; replay test before launch (security.md). Planned | `subscriptions`, `usage-ledger` | `stripe-replay`: the same `checkout.session.completed` delivered three times, including once after 25 hours, writes one grant (`refId` = the Checkout Session ID) | None | None |
| C4 | **Group chat as a shared feed**: a paid user links a Telegram group, so 200 people get the alerts | One chat per user and one user per chat. Group chats are not refused | `account` | `telegram-private-only`: linking a chat whose type is not `private` is refused | Revenue, not spend | **G4** |
| C5 | **Alert flood** from a replay or a hot area hits Telegram's bot-wide rate limit, delaying everyone | `notifier` sends each claim once (1.8l) | `notifier`, `alert-router` | `alert-dedupe`: one alert per (user, listing, kind), whatever the event order | None | G11 |

### D. Apify cost amplification

| # | Exploit | Guard | Owner | Fixture that proves it | Run-off | Gap |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | **Many areas at a 1-minute interval** on paid wants: 40 areas at 1.31p is 52p a minute, £31 an hour | The user pays for it: the estimate before save, then metered credits. Daily and monthly caps (1.6d) | `usage-ledger`, `check-scheduler`, `spend-governor` | `wide-paid-want`: the want's credits are reserved per check (G9). The daily cap stops all paid calls at £10 + ≤ £1 | ≤ one check of the want plus C × R | G9 |
| D2 | **Retry storm**: a blocked or broken actor fails every run and each resubmit spends compute | Event retries have a `maxAttempts` (0.9a). Gateway run retries have no budget | `check-scheduler`, `details-queue`, `spend-governor` | `retry-storm`: a run shape failing 5 times in 10 minutes holds that shape (a failure-rate breaker in 1.6e) and alerts. Each area resubmits at most N times an hour | ≤ breaker threshold × R | **G14** |
| D3 | **Out-of-order replay re-announces first seen**: a late collection, a replayed `run-collected` or an admin retry with a fresh key (0.9a) makes old listings look new, so alerts and model calls repeat | `run-collected` is keyed by job ID and announced once (built). First-seen is not proven stateful | `listing-ingest`, `alert-router` | `replay-first-seen`: collect job 2, then job 1, then replay job 1 with a fresh key. `first_seen_at` is unchanged, no second alert goes out, and no model call repeats for an unchanged content hash | Model cost of one batch per replay (≤ £1 with 1.6d) | **G11** |
| D4 | **Reservation too low**: displayed costs have run up to 45% low, so the true cost passes the cap | Unsettled runs count at the larger of reservation and provisional cost (built). Per-run cost cap in the actor input (1.6d) | `spend-governor`, `apify-gateway` | `reservation-covers-cost`: a run whose settled cost is 1.45 times its provisional still settles under its reservation | ≤ 45% of in-flight reservations | G6 |
| D5 | **Reservation too high**: $0.3363 reserved against $0.0177 settled starves the gate, so free windows stop early and paid wants hold (revenue loss, and trivial to trigger with a few accounts) | None | `spend-governor`, `apify-gateway` | `reservation-sized`: a 1-minute window-one check reserves no more than 3 times its measured cost; a window runs its full shape inside the £2 cap | Not a cost | **G6** |
| D6 | **Gate race**: 50 submits pass the gate together before any reservation is written | The gate checks reserved plus settled (1.6d). Atomicity is not specified | `spend-governor` | `gate-race`: 50 concurrent submits against £1 of headroom book ≤ £1 + R | ≤ C × R once atomic; unbounded between gate and write without it | **G6** |
| D7 | **The free pool starves paid watchers**: £20 a day for 6 days exhausts the $150 monthly gateway cap shared with paid users | The gateway's monthly cap (built) protects money but not paid users | `spend-governor`, `apify-gateway` | `pool-vs-cap`: with the free pool spent every day, paid watchers keep their funded cadence until the paid share of the cap is used | £120 a month at most (the gateway cap), but paid service stops | **G7** |

### E. Sharing, API, pasted links, scans and data

| # | Exploit | Guard | Owner | Fixture that proves it | Run-off | Gap |
| --- | --- | --- | --- | --- | --- | --- |
| E1 | **Account sharing**: credentials or a session shared across a household or a reseller group | One live screen and a device cap (`live_leases`), risk score and ladder. Ships in shadow; thresholds await the owner (question 37) | `account-integrity` | The card's timeline fixtures (couples, commuters, VPNs, resellers) at or above their pass rate | Revenue, not spend (watching is metered) | None new; owner's thresholds |
| E2 | **API key leaked or abused** (5.4a, Business tier) | Hashed at rest, per user, 600 requests a minute, revocable (security.md, engineering). Planned | `account`, `usage-ledger` | `api-key-spend`: calls made with a key charge the owner's ledger, pass the spend gate and stop at the key's own daily limit. A key is shown once, with a prefix that secret scanners can match | ≤ the key's daily limit | **G15** |
| E3 | **Pasted-link abuse**: each paste starts a paid details run; an arbitrary URL invites SSRF | `pasted-link-lookup` exists. The rules against fetching the pasted URL and on cost are not written; scraping is banned (CLAUDE.md) | `pasted-link-lookup`, `details-queue` | `paste-cost`: a pasted URL is parsed to (source, listing ID) and never fetched. A repeat within 24 hours hits the cache, and each paste is charged or counted to the free cap | ≤ one details run per new listing | **G10** |
| E4 | **Scan abuse**: 30 a minute per user is 43,200 vision calls a day | Rate limit only (engineering) | `scan-lookup`, `scan-recognition`, `usage-ledger` | `scan-quota`: a free account stops at the policy's daily scan count and at its £2 cap; every scan passes the gate | ≤ £2 per free account; paid accounts are charged | **G10** |
| E5 | **Upload bombs**: a 10 MB PNG that decodes to 50,000 × 50,000 pixels | Type and size limits (security.md) | `scan-recognition` | `upload-pixels`: an image over the pixel cap (initially 40 MP) is refused before decoding | Compute only | **G10** |
| E6 | **Scraping the data set** (the moat) with many free accounts or an API key | Per-user rate limits; RLS. No per-day result cap | `account-integrity`, `listing-search` | `bulk-read`: one account or linked group reading more than the policy's number of listings a day is slowed, then held, as a shadow rule first | Revenue, not spend | **G16** |
| E7 | **Seller identity leak** to end users through the API, exports, alerts or the map | `v_rows` strips `seller`; user-facing views carry no seller fields; location precision; decision "Actor data kept in full" | `apify-gateway`, `output-guard`, `account` | The existing `v_rows` test, plus an export and an API response scanned for any `seller` key | None | None |

### F. Admin and switches

| # | Exploit | Guard | Owner | Fixture that proves it | Run-off | Gap |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | **Admin takeover** through a compromised inbox (magic link) | `ADMIN_EMAILS`, roles set server-side, `audit_log` (built) | `auth` | `admin-step-up`: an admin action (policy, switch, breaker reset, override) needs Google sign-in with 2-step verification or a passkey, re-authenticated within 15 minutes. A magic-link session alone cannot act | Up to the ceilings in F2 | **G5** |
| F2 | **Policy edit past sane limits**, by mistake or on purpose: a £2,000 pool, a £200 lifetime cap, a daily cap above the monthly | Versioned, audited policy rows (4.10a) | `pricing-console`, `spend-governor` | `policy-ceiling`: an edit above the config ceiling (for example pool ≤ 50% of the provider monthly cap, lifetime cap ≤ £5, day ≤ week ≤ month) is refused with a message | Ceilings bound it | **G7** |
| F3 | **Switch misuse**: turning a guard off to "fix" an outage, or resetting a breaker in a loop | `spend-governor` and `cost-meter` fail closed (built). The breaker resets only by an audited admin (1.6e) | `switches`, `spend-governor`, `account-integrity` | `integrity-off-holds-free` (A7); `breaker-reset-rate`: a third reset in an hour needs a written reason and alerts the founder | Pool + C × R per reset | G1 |
| F4 | **Insider export of restricted rows** (seller data, which developers may see) | `restricted_rows` is owner-only SQL; the owner's decision "Actor data kept in full" | `apify-gateway` | Privileges test (built): no role but the owner reads `restricted_rows` | None | None |

## Gaps

Each gap is one row in `docs/backlog.md`, under "Abuse threat model gaps (4.3t)". G1–G16 map to IDs as follows.

| Gap | Backlog | One line |
| --- | --- | --- |
| G1 | 4.3v | Free-tier guards are hard from day one, not shadow; free admission holds when `account-integrity` is off |
| G2 | 4.3w | Canonical email; trial keys survive deletion; the lifetime cap and windows follow the linked group |
| G3 | 4.3x | Card check hardening: prepaid refused, attempt limits, Radar rules, check only after a verified email |
| G4 | 4.3y | Telegram: attempt limit per chat, private chats only, secret-token header, `update_id` dedupe |
| G5 | 4.3z | Global magic-link send cap; admin step-up (Google 2-step verification or passkey, fresh within 15 minutes) |
| G6 | 1.6f | Reservation sized from the run's own cap, 45% uplift over measured cost; gate and reservation in one locked step |
| G7 | 1.6g | Free pool ceiling as a share of the provider monthly cap; lone-area sub-pool; risk-weighted admission; policy ceilings |
| G8 | 7.1b | Free burst cost per window fixed whatever the radius (cadence scales with areas) |
| G9 | 4.9b | Prepaid watching: credits reserved per check before submit; a monthly spending limit per user |
| G10 | 3.3a | Scans and pasted links charged or counted to the free cap and gated; pasted URLs parsed, never fetched; pixel cap |
| G11 | 1.3i | First-seen written once per listing; alert dedupe per (user, listing, kind); replay fixture |
| G12 | 4.9c | Dispute clawback and reversal rules in the ledger |
| G13 | 4.9d | Referral credit rules: after a cleared paid purchase, never within a linked group, monthly cap |
| G14 | 1.6h | Failure-rate breaker and a retry budget per area and shape |
| G15 | 5.4b | API keys: per-key daily spend limit, charged and gated, scanner-friendly prefix |
| G16 | 4.3aa | Bulk-read rule (shadow first) against scraping the data set |

## Day-one checklist (owner)

Before the free tier opens, each of these is true:

1. **Caps set.** Daily £10, weekly and monthly caps are rows; the gate refuses at the cap without waiting for a schedule (1.6d, G6).
2. **Pool fits the month.** The free pool's monthly ceiling is at most half of the provider's monthly cap (G7).
3. **Breakers low.** Thresholds are set for 100 accounts, not thousands (1.6e), and a test trip has been run.
4. **Guards hard.** Sign-up limits, the admission queue and the card check act, not shadow (G1).
5. **Rejoin closed.** A deleted account's trial keys stop a rejoin (G2).
6. **Scans and pastes metered** (G10); **watching prepaid** (G9).
7. **Edge on.** Turnstile, Cloudflare rate rules and Bot Fight Mode on sign-up and search (4.3u).
8. **Kill switch rehearsed.** `free-bursts` off stops new windows within a minute.
9. **Admin locked.** Admin actions need a second factor (G5).
10. **Alerts reach the owner.** A breaker trip, a cap reached, and the pool at 80%.

## Adversarial pass

[filled after the critic's pass]
