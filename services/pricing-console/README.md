# @nabvy/pricing-console

Holds the owner's price policy as versioned rows (the paid ladder, unit prices, credit bundles,
offers, the free-tier policy, the minimum margin) and prices every sale from them, never below
measured cost times the minimum margin (`docs/design/modules/pricing-console.md`, backlog 4.10a
and 4.10b).

## Switch and priority

Off by default (rule 11 of `docs/design/modules/_rules.md`; no seed row, so
`switches.state('pricing-console')` reads `off`). **Off**: admin changes are refused with
`pricing-console.off`; list prices apply and no offers do (the card's "When off: list prices from
configuration apply; no offers", the configuration being the current policy rows); `v_offers` has
no rows. `v_ladder`, `v_prices`, `v_free_policy` and `v_settings` always return their rows, and
`usageLedgerPolicy` always answers, so want-manager, check-scheduler and the ledger keep their
plan ceilings and a paid top-up is never refused for want of a price (see "Decisions").
**Shadow**: changes are written, users still pay list prices, and `v_offers` stays empty (it shows
only offers that apply; review of PR #55). **On**: offers apply and `v_offers` shows them. MVP, with `usage-ledger` (card); backlog 4.10a and 4.10b.

## Inputs

- Admin changes: `setPolicy(q, input)` and `retirePolicy(q, input)`, run inside `withPipeline`.
  **The admin procedures are not built**: there is no oRPC router in `apps/web` yet (backlog 4.1),
  so this module adds none, as `account` and `marketing-consent` did. When the admin screen is
  built, its procedure checks the session with `requireAdmin(headers)` from `@nabvy/auth` on the
  server and then calls these functions inside `withPipeline`; the database has no admin check for
  `nabvy_app`, so no signed-in session can write a price. The server-side admin gate for the admin
  layout is backlog 4.3af, not yet built. Question in `docs/questions/pricing-console.md`.
- Reads: `cost_meter.v_costs` (from `cost-meter`) through two SECURITY DEFINER functions:
  `pricing_console.basis_cost(key)` (web app and pipeline: one current cost basis, with the row's
  own window and sample minimum) and `pricing_console.measured_cost()` (pipeline only: any window,
  to check a cost-basis change before it is written); `switches.state('pricing-console')`
  (`@nabvy/switches`).
- Writes one `audit-log` row per change (`@nabvy/audit-log`'s `record()`, same transaction).
- Event `account.deleted` (from `account`): `accountDeletedHandler` deletes offers made for the
  user.

## Outputs

- **Functions** (`@nabvy/pricing-console`), each on the caller's transaction:
  - `priceFor(q, { userId, item, plan? })` → `PricingConsoleQuote`: a checking or watching action
    in credits (`price:<key>`) or a plan fee in gross pence (`plan:<tier>:monthly|yearly`), less
    the user's best live offer while on, never below the floor (`floored` says the floor applied).
    Runs as the web app (withUser) or the pipeline.
  - `estimate(q, { userId, plan, cadenceMinutes, areaCount, roundTheClock? })` →
    `PricingConsoleEstimate`: the monthly credits of a want, for want-manager and the cadence
    slider. At or slower than the plan's base: included (0). Faster than the plan's floor:
    `pricing-console.below_plan_floor`. Otherwise the watching price of the nearest priced cadence
    at or faster than the one asked, per area, times the areas (× the round-the-clock setting).
  - `usageLedgerPolicy`: the `UsageLedgerPolicy` usage-ledger's `grantAllowance` and `grantTopup`
    take. `bundleCredits(plan)` = the tier's bundled credits; `topupCredits(plan, cashMinor)` =
    the net cash at the tier's net top-up rate, less the best pack discount the payment reaches.
    Each answer carries the policy version, e.g. `pricing-console:tier/pro@1+bundle/topup-25@2`.
  - `checkFloor(q)`: what the floor refuses in the current policy (the admin screen's warnings).
  - `setPolicy`, `retirePolicy` (above), `purge(q, userIds)`, `accountDeletedHandler(deps)`.
- **Internal views** (`nabvy_pipeline` only until per-module roles exist; `security_invoker`):
  - `pricing_console.v_ladder`: `tier, version, base_cadence_minutes, floor_cadence_minutes,
    bundled_credits, monthly_price_minor, yearly_price_minor, topup_gross_micros_per_credit,
    topup_net_micros_per_credit, areas, wants, round_the_clock, effective_at`. The plan ceiling
    (base and floor) for want-manager, check-scheduler and the cadence slider.
  - `pricing_console.v_prices`: `item, version, unit (each | area-month), credits,
    cadence_minutes, cost_basis, cost_units, effective_at`.
  - `pricing_console.v_offers` (rows only while on): `offer, version, user_id, segment, item,
    discount_bps, starts_at, ends_at`, live offers only.
  - `pricing_console.v_free_policy` (backlog 4.10a): the free tier's window count and length,
    reset hours, burst shapes (JSON), lifetime, per-user, per-account-per-day and pool caps,
    sign-up limits.
  - `pricing_console.v_settings`: `setting, version, value, effective_at` (the minimum margin that
    check-scheduler's funding rule uses, VAT, fees, the round-the-clock multiple).
- **No user-facing view**: the prices and offers a user sees go through procedures only (card).
  **No events.**
- Error codes `pricing-console.off | below_floor | invalid | not_found | below_plan_floor |
  no_price`, each with a message in `PRICING_CONSOLE_MESSAGES` (`no_price` also when no floor
  price can be set: a missing cost basis, or no credit on sale); `below_floor` and `invalid` list
  what was refused.

## Tables

`pricing_console.policy_rows`: `id`, `kind` (`tier | price | bundle | offer | free-tier | setting
| cost-basis`), `key`, `version`, `value` (jsonb, validated by the kind's Zod schema before it is
written), `retired`, `target_user_id` (offers for one user only, equal to the value's `userId`),
`effective_at`, `created_by` (the admin; null for seeds), `reason`, `created_at`. **Unique on
(kind, key, version).** The current row of a key is its highest version in effect, unless
retired (the card's `price_rules`, `bundles` and `offers` are the kinds `price`, `bundle` and
`offer`).

A trigger keeps it append-only: no update, no truncate, no delete except an offer made for one
user (the account-deletion purge); each version is the previous one plus one; nothing takes effect
in the past or before the version it follows; `target_user_id` must match the offer and never
changes between an offer's versions; tier and bundle keys are at most 24 characters.
`effective_at` defaults to `now()` truncated to milliseconds, so a new row is never a fraction of a
millisecond ahead of the clock the views compare with. RLS: `nabvy_app` may select rows with no
target or targeting its own user; `nabvy_pipeline` may select, insert and delete. Writes take an
advisory lock, so a change is checked against the floor with no other change landing in between.

## Rules and thresholds

Every number is a policy row, seeded as an **initial policy value** by the access migration and
changed only through `setPolicy`. The monthly tier prices, base cadences, floors and bundled
credits are the owner's starting prices (`docs/decisions.md`, "Starting prices", 2026-09-24
19:55, on the "Paid ladder" table); the rest are the coordinator's within the 60% rule.

| Rule | Initial value | Basis | Status |
| --- | --- | --- | --- |
| Minimum margin (`min-margin-bps`) | 2x measured cost; must stay above 1x | Brief: "start at two to three times measured cost"; `docs/decisions.md`, "Always profitable" | Initial policy value; question |
| Measured cost used | The higher of the mean of the last 7 days' matching `v_costs` calls (from 20 calls) and the recorded fallback | Brief; conservative (README "Decisions") | Initial policy value |
| Cost of a check (`cost-basis/check`) | 1.31p, all Apify calls | `docs/decisions.md`, "Free tier" (16:50: 1.31p per lone check, measured) | Initial policy value |
| Cost of a photo scan (`cost-basis/photo-scan`) | 2p, Anthropic calls of `scan-recognition` | `docs/design/pricing-model.md`, "Unit prices" ([P]) | Initial policy value |
| Net of a payment | gross ÷ 1.2 − (2.7% × gross + 20p) | `docs/design/pricing-model.md`, "Unit economics" ([A] verify) | Initial policy value |
| Ladder: base / floor / bundled credits | Starter 2 h / 1 h / 1,200; Pro 30 min / 5 min / 6,000; Max 15 min / 1 min / 24,000; Business 15 min / 1 min / 80,000 | `docs/decisions.md`, "Paid ladder" (17:40) and "Starting prices" (owner, 19:55) | Owner's starting value |
| Ladder: monthly price | £12; £29; £99; from £299 | `docs/decisions.md`, "Starting prices" (owner, 19:55) | Owner's starting value |
| Ladder: yearly price | £120; £290; £990; contract | `docs/design/pricing-model.md`, "Summary" | Initial policy value (coordinator's, within the 60% rule) |
| Ladder: top-up rate gross / net per credit | 1.00p / 0.790p; 0.483p / 0.386p; 0.413p / 0.332p; 0.374p / 0.301p | `docs/design/pricing-model.md`, "Tiers" | Initial policy value |
| Ladder: areas / wants | 2 / 10; 6 / 40; 20 / 150; 60 / 150 | `docs/design/pricing-model.md`, "Tiers" (Business wants: question) | Initial policy value |
| Checking prices | Photo scan 15 cr; live lookup 15; pasted link 10; similar item 10; export 50; boost 24 h 150, 7 d 500 | `docs/design/pricing-model.md`, "Unit prices" | Initial policy value |
| Watching prices (per area-month, daytime) | Hourly 300; 15 min 900; 5 min 2,000; 1 min 6,000; round the clock ×1.5 | `docs/design/pricing-model.md`, "Unit prices" | Initial policy value |
| Top-up packs | £10, £25, £50, no volume discount yet | `docs/design/pricing-model.md`, "Rules" | Initial policy value |
| Free tier | 1 want; 3 windows of 8 h, 72 h apart; bursts 1 min × 20, 5 min × 100, 15 min × 120, hourly (window 1) and 10/50/120/300 (windows 2–3); £2 lifetime cap; pool £20 a day or 5% of last month's net | `docs/decisions.md`, "Free tier: bursts under a lifetime cap" (coordinator's shape, 16:50) | Initial policy value |

**The floor.** A change is refused (`below_floor`) if, with it, any checking action at its list
or offer price earns less than the minimum margin times its measured cost at any rate a credit is
sold at: each tier's net top-up rate, each pack's discounted rate, each plan fee (monthly and
yearly, net) over its bundled credits, and each plan offer. It also refuses a plan floor with no
watching price at or faster than it, a free-tier burst costing more than the lifetime cap lone, a
margin of 1x or less, and references to rows that do not exist. A change is refused for any breach
it newly causes and for any breach still involving the changed row, so a price already below the
floor after costs rose can only be raised to one that clears it. At read time `priceFor` never
returns a checking price below the floor at the lowest rate on sale, and drops a plan offer that
would.

## Fixtures and pass rate

Stage `floor` (`test/fixtures/floor.fixtures.ts`), 12/12, synthetic cases built from the card,
backlog 4.10a and 4.10b, `docs/decisions.md` and `docs/design/pricing-model.md` (no recorded run
applies), each on a fresh database with the real migrations and seeded policy:
`floor-refuses-below-cost`, `expired-offer`, `offer-one-user`, `audit-every-change` (the card's
four); `ladder-starter`, `ladder-pro`, `ladder-max`, `ladder-business` (the floor on each money
value of each tier, and the cadence rules); `margin-and-measured-cost`, `packs-and-plan-offers`,
`free-tier-cap`, `estimate-want`.

`test/domain.test.ts` covers the net of a fee, rounding, the floor's boundary (exactly at the
margin and one micro below), the cost used, the floor's violations, the free-tier check count,
watching steps, offer choice and expiry, and top-up credits. `test/policy.test.ts` covers the seeded
policy passing its own floor and publishing, the append-only guard, RLS on offers, future-dated
changes, and `usageLedgerPolicy` through the real `grantAllowance` and `grantTopup`.
`test/switch.test.ts` covers off, shadow and on. `test/idempotency.test.ts` covers a repeated
change, retirement, purge and the `account.deleted` handler. `test/contracts.test.ts` checks the
view rows against Drizzle and the real columns, and every seeded row against its schema.
`packages/db/tests/pricing-console.test.sql` covers grants, RLS, the guard, the seeded policy, the
views' switch filter and `measured_cost()` on real Postgres (`pnpm db:dry-run`).

## Decisions

- 2026-09-24: **one append-only table of versioned rows**, `policy_rows`, keyed by kind and key,
  instead of one table per kind. Every value (the card's price rules, bundles and offers, the
  ladder, the free tier, the settings and the cost bases) gets the same versioning, audit,
  effective time and floor check, and a change applies on the next read with no deploy. Values are
  checked by their Zod schema in code; the database holds the invariants that must hold whoever
  writes (append-only, no gaps, nothing in the past, offer targets).
- 2026-09-24: **no cache**: every call reads the current rows, so a change applies at once (the
  brief allows a minute).
- 2026-09-24: **the floor's cost is the higher of measured and recorded cost.** A mean over the
  last 7 days of matching `v_costs` calls counts once there are 20; below that, or if it is lower,
  the recorded fallback (the last measurement written into the cost-basis row) stands. The floor
  therefore never rests on a cost lower than both; the owner lowers the fallback with an audited
  change when costs fall.
- 2026-09-24: **watching's floor is the funding rule.** Watching an area is shared by every
  watcher, so a per-watcher price cannot be compared with the lone cost of the area. As the
  pricing model sets out, check-scheduler runs an area only at the cadence its watchers' credits
  fund, at this module's minimum margin (`v_settings.min-margin-bps`); here a watching price needs
  only to be positive, and each plan floor needs a watching price to buy it with.
- 2026-09-24: **when off, list prices apply**: the ladder, prices and free policy stay published
  and `usageLedgerPolicy` answers (the card's "When off"), so an off console never refuses a paid
  top-up or leaves the scheduler without a ceiling; only offers and admin changes stop.
- 2026-09-24: **top-ups are valued on net cash** at the tier's net rate, since `usage-ledger`
  passes the net cash (`cashMinor`). A £10 Starter top-up (786p net) is 994 credits, not the 1,000
  a 1.00p gross rate suggests. Question.
- 2026-09-24: **a want between priced steps is priced at the next faster step** (a 30-minute want
  on Pro pays the 15-minute price), the conservative reading until the owner prices every slider
  step; the owner can add `watch-30` and `watch-120` rows at any time.
- 2026-09-24: **a discount rounds up** (in Nabvy's favour), and an offer that would sell below the
  floor is refused when made and dropped at read time.
- 2026-09-24: **no admin procedure or page yet** (see "Inputs"): writes run as the pipeline after
  the caller's `requireAdmin`, as `switches` does. The admin gate is backlog 4.3af.
- 2026-09-24 (review of PR #55): **an offer's target is fixed for its key.** A later version
  cannot move an offer between users or between a user and a segment (in code, `invalid`, and in
  the database), so row-level security can never leave an older version live for the users who no
  longer see the newer one, and a purge removes a user's offer whole.
- 2026-09-24 (review of PR #55): **versions take effect in order.** A change without a time,
  written while a version is scheduled, takes effect with that version rather than skipping it;
  an explicit earlier time is refused.
- 2026-09-24 (review of PR #55): `v_offers` shows offers only while on, the one state in which
  they apply; the web app reads costs only through `basis_cost(key)`; tier and bundle keys are at
  most 24 characters so `pricing-console:tier/<tier>@<n>+bundle/<bundle>@<n>` fits usage-ledger's
  100; `priceFor` and `estimate` refuse with `no_price` rather than quote a price they cannot floor,
  and the floor flags a costed action when no credit is on sale.
- 2026-09-24 (review of PR #55): the floor at read time uses the list rates. A user's own plan
  offer can lower their rate, but each plan offer is checked against every checking price when it
  is made, and the 2x margin leaves headroom; revisit if margins are cut close.
- 2026-09-24 (owner, "Starting prices", 19:55): the seeded monthly prices, cadences and bundled
  credits are the owner's starting prices, no longer placeholders; they stay versioned policy rows,
  editable from the admin panel and held to the floor like any other.
- 2026-09-24: seeds carry no audit row (`audit_log.entries` needs an actor; `switches` did the
  same); each carries its source in `reason`.

## Open questions

`docs/questions/pricing-console.md`: the minimum margin; top-ups on net or gross; Business's wants
and yearly price; pricing between slider steps; the admin procedures; round the clock on Business.

## Incidents

None.
