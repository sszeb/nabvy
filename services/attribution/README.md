# @nabvy/attribution

Records who brought each user: UTM tags, a Dub partner link or creator code, and customer
referral pairs (`docs/design/modules/attribution.md`, `docs/affiliates.md`).

## Switch and priority

Off by default (rule 11 of `docs/design/modules/_rules.md`; no seed row, so
`switches.state('attribution')` reads `off`). **Off**: sign-up capture, sale tracking and
reversal all refuse (`attribution.off`); `v_attributions` has no rows. Rule 11 names no exception
for this module, so nothing keeps recording while off — unlike a payment webhook, a lost sign-up
capture only loses attribution for that user, never money (card, "When off": "no attribution;
nothing else changes"). **Shadow**: sign-up capture writes and records (the Dub lead included); `trackSale`
and `reverseSale` refuse (`attribution.not_on`), because a commission and a referral credit both
move money and rule 11 requires `on` for that; no user-facing view exists yet either way (see
"Decisions"). **On**: all of it. MVP, live from day one of the public beta
(`docs/decisions.md:225`); backlog 4.7a (`docs/backlog.md:125`; the card's "BP4" is that entry).

## Inputs

- Sign-up: `captureAttribution()`, called by a future sign-up hook (no user session exists yet at
  that point, the same reason `account.confirmTelegramLink` runs in `withPipeline`).
- A paid invoice, already resolved and verified by its caller: `trackSale()`. A dispute or a
  legally required refund: `reverseSale()`. Neither parses a raw Stripe webhook or verifies a
  signature — see "Decisions".
- Event `account.deleted` (from `account`): `accountDeletedHandler` purges the user.
- Reads: `@nabvy/switches`' `state(q, 'attribution')`; `@nabvy/account`'s `isActive(q, userId)`
  before tracking a sale or crediting a referral pair; `@nabvy/usage-ledger`'s `grant()` for the
  give-£5-get-£5 pair.
- Configuration: `ATTRIBUTION_CLICK_COOKIE_DAYS`, `ATTRIBUTION_COMMISSION_HOLD_DAYS`,
  `ATTRIBUTION_REFERRAL_CREDIT_CREDITS` through `@nabvy/config/modules/attribution`.

## Outputs

- **No events.** Nothing downstream consumes a lead, sale or reversal yet (card, "Outputs"); the
  event registry is declared empty for `test/contracts.test.ts` and stays that way until a reader
  needs one.
- **Partner calls** through the injected `AttributionPartnerClient` (`trackLead`, `trackSale`,
  `reverseSale`) — see "Decisions" for why this is injected rather than a real Dub HTTP client.
- **Usage grants** through `@nabvy/usage-ledger`: `grant({ kind: 'referral', ... })`, once per side
  of a referral pair, refId `referral:<referrer|referred>:<referralId>`.
- **Internal view** `attribution.v_attributions` (`nabvy_pipeline` only until per-module roles
  exist; for `lifecycle-messaging` and `search-planner`,
  `docs/design/pricing-model.md`, "Fill areas"): `user_id, utm_source, utm_medium, utm_campaign,
  utm_content, utm_term, affiliate_click_id, affiliate_code, affiliate_partner_id, referral_code,
  referred_by, referred_at, credited_at, captured_at`. Rows only while the module is not off.
- **No user-facing view yet**: no module has created the `app` schema (the same gap `account`,
  `usage-ledger` and `subscriptions` all note). The user's own referral code is read through
  `getAttribution()`, for a future procedure.
- **Functions** (`@nabvy/attribution`): `captureAttribution(q, input, deps)`,
  `trackSale(q, input, deps)`, `reverseSale(q, input, deps)`, `getAttribution(q, userId)`,
  `purge(q, userIds)`, `accountDeletedHandler(deps)`, `inMemoryPartnerClient()`.
- Error codes `attribution.off | not_on | self_referral | mismatch | account_inactive`, each with
  a message in `ATTRIBUTION_MESSAGES`.

## Tables

All in the `attribution` Postgres schema. Written only by `nabvy_pipeline` (sign-up capture and
partner calls run in the pipeline, never under a user's own `withUser`); `nabvy_app` reads only
its own row of `utm_attributions` and `referral_codes`.

- `utm_attributions`: `user_id` (primary key), the five UTM fields, `affiliate_click_id`,
  `affiliate_code`, `affiliate_partner_id` (filled in after `trackLead`), `created_at`,
  `updated_at`. One row per captured user, written once.
- `referral_codes`: `user_id` (primary key), `code` (**unique**), `created_at`. Issued once, in
  the same transaction as the row above, so every captured user can always share a code.
- `referrals`: `id`, `referrer_user_id`, `referred_user_id` (**unique**: one referrer each),
  `code`, `referred_at`, `credited_at` (set once, on the referred user's first paid subscription
  invoice). A check constraint refuses `referrer_user_id = referred_user_id`.
- `partner_events`: `id`, `user_id`, `kind` (`lead | sale | reversal`), `ref_id` (**unique** on
  `(user_id, kind, ref_id)`: idempotency), `partner_id`, `amount_minor`, `currency`, `reason`
  (reversals only), `at`. Rows are never edited or truncated; the pipeline may delete a user's
  rows only for the account-deletion purge (the same pattern as `usage_ledger.entries`).

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Click cookie window | 90 days | `docs/affiliates.md`, "Attribution" | Fixed by the programme's terms; enforced by Dub's own cookie, not this module |
| Commission hold | 30 days | `docs/affiliates.md`, "Hold and clawback" | Fixed by the programme's terms; enforced by Dub's payout schedule |
| Referral credit | 500 credits (≈ £5) | Starter's net rate in `docs/design/pricing-model.md`, "Watching" (£12 ÷ 1,200 cr ≈ 1p/credit) | Starting value; no pricing-console policy exists yet for referral credit (`docs/questions/attribution.md`) |
| Referral code | 8 characters, the same unambiguous alphabet as account's Telegram codes | `services/account/src/domain/index.ts` | Fixed by precedent |

## Fixtures and pass rate

Stage `attribution` (`test/fixtures/attribution.fixtures.ts`), 4/4, synthetic single-actor cases
built from the card's own test list and `docs/affiliates.md`, "Tests", run on the real migrations
in PGlite: `lead-once`, `sale-once-per-invoice`, `chargeback-reverses`,
`no-click-no-code-no-calls`. The two-actor give-£5-get-£5 pair (this runner assigns one user per
case) is covered instead in `test/attribution.test.ts`.

`test/domain.test.ts` covers referral code generation (alphabet, determinism), self-referral and
the per-side credit ref ID. `test/attribution.test.ts` covers sign-up capture (idempotency, an
unknown code dropped, a real pairing), the full give-£5-get-£5 flow (both sides credited once, a
second invoice credits nothing further, a top-up never credits), the inactive-account refusal and
`getAttribution` for an uncaptured user. `test/idempotency.test.ts` runs `captureAttribution`,
`trackSale`, `reverseSale` and the `account.deleted` handler twice each. `test/switch.test.ts`
covers off, shadow and on. `test/contracts.test.ts` checks the empty event registry and that a
captured record parses as `AttributionRecord`. `packages/db/tests/attribution.test.sql` covers
grants, RLS, the self-referral check constraint, the append-only guard and the view's switch
filter (`pnpm db:dry-run`).

## Decisions

- 2026-09-24: two kinds of "referred", never mixed. A peer's own code (`referral_codes` /
  `referrals`) is entirely internal: give-£5-get-£5 through `usage-ledger.grant()`, never touches
  Dub (`docs/affiliates.md`'s opening paragraph: "Customer-to-customer referrals … stay in our own
  usage ledger"). A Dub partner link or creator code (the `affiliate_*` columns) is a Dub-tracked
  cash commission for the creator, reversed on a chargeback or refund, and never itself grants
  this module's internal credit — the Terms table's two-sided row for that programme is Dub-side
  reward configuration, out of scope here (`docs/questions/attribution.md`).
- 2026-09-24: Stripe data reaches this module as clean, already-resolved parameters
  (`trackSale`, `reverseSale`), never a raw webhook. There is one Stripe webhook secret in the
  whole system (`docs/secrets.md`), owned by `subscriptions`, and this module verifies no
  signature. Wiring a real caller into that webhook — so a paid invoice or a dispute actually
  reaches these functions — is follow-up work outside this module's own files
  (`docs/questions/attribution.md`); the `subscriptions` dependency the card names is therefore
  soft in this pull request: no import of `@nabvy/subscriptions` here.
- 2026-09-24: the card's "auth" dependency is satisfied through `@nabvy/account`'s `isActive`,
  itself auth's one-line delegate (`services/account/README.md`, "Standing"); this module does
  not import `@nabvy/auth` directly, the same precedent account itself set for standing logic.
- 2026-09-24: Dub Partners is not an account yet (`docs/secrets.md` lists no key for it in this
  push), so every caller injects an `AttributionPartnerClient`; the default,
  `inMemoryPartnerClient()`, is deterministic and keeps no state beyond the call (this module's
  own `partner_events` table is the real record). A real Dub HTTP client is later work once
  `DUB_API_KEY`/`DUB_PROGRAM_ID` exist.
- 2026-09-24: referral credit has no pricing-console policy to convert cash to credits (as
  usage-ledger's own bundle and top-up grants need one), so it is granted with an explicit
  credits amount, as usage-ledger's `grant()` allows for the `referral` kind
  ("grant() with explicit credits stays for taste and referral credit",
  `services/usage-ledger/README.md`, "Decisions"). `ATTRIBUTION_REFERRAL_CREDIT_CREDITS` is a
  starting value pending a real policy.
- 2026-09-24: "the referred user's first paid subscription invoice" is operationalised as
  `referrals.credited_at is null`, not by reading the user's Stripe invoice history: the first
  `trackSale` call for a `subscription` kind that finds an uncredited pair credits it, once
  (`usage-ledger.grant()`'s own idempotency on refId is a second, independent guard against a
  double credit under a race). A top-up sale never credits the pair (`docs/affiliates.md`'s
  give-£5-get-£5 sentence names only the pair, not top-ups).
- 2026-09-24: a chargeback or a legally required refund claws back the Dub commission only
  (`reverseSale`); a referral credit already granted is never reversed (`docs/decisions.md`, "No
  refunds": there is no refund path anywhere in this codebase, and the card's own "a chargeback …
  reverses the commission" names the commission, not the peer credit).
- 2026-09-24: self-referral is structurally near-impossible (a user cannot know their own code
  before their own, one-time sign-up capture creates it), but `isSelfReferral` is still checked
  and refused defensively, and covered at the domain level, in case a future change ever lets a
  code be entered before a user's own capture (for example, a recycled or chosen code).
- 2026-09-24: sign-up capture is idempotent per user on UTM and affiliate fields only (never on
  `referralCode`): a second capture call for an already-captured user with the same UTM/affiliate
  details is a pure no-op and never re-processes a referral pairing or a Dub lead, even if it
  supplies a different `referralCode` — referral pairing happens only once, at first capture.
- 2026-09-24: an unknown referral code is dropped rather than refusing the whole sign-up: a typo
  or a stale marketing link should never block account creation. Recorded as a conservative choice
  in `docs/questions/attribution.md`.

- 2026-09-25: `trackSale` and `reverseSale` require the switch `on`; in `shadow` they refuse with
  `attribution.not_on` and write nothing, so a shadow run can never pay a creator a commission or
  grant a user credit (rule 11: "anything that moves money or sends to a user requires `on`").
  Sign-up capture still runs in shadow, Dub lead included: a lead pays nobody. A sale that
  arrives in shadow is not recorded and is not replayed later; the module is switched on before
  billing goes live, so no real sale is expected to reach it in shadow.

## Open questions

`docs/questions/attribution.md`: wiring `trackSale`/`reverseSale` into a real Stripe webhook
caller; whether the affiliate/creator programme's two-sided customer discount should also touch
this module's own ledger calls; the referral credit's credits-per-£5 conversion once
pricing-console exists; an unknown referral code dropped rather than refused.

## Incidents

None.
