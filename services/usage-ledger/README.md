# @nabvy/usage-ledger

Keeps each user's credit balance and charges metered actions against it: a ledger of grants,
top-ups, charges, reversals and expiries, with one bucket per grant (`docs/design/modules/usage-ledger.md`,
backlog 4.9).

## Switch and priority

Off by default (rule 11 of `docs/design/modules/_rules.md`; no seed row, so `switches.state('usage-ledger')`
reads `off`). **Off**: every metered action is refused with `usage-ledger.off` and a clear message
("Paid actions are paused for a moment. Nothing was charged; please try again later."), so paid
work that needs credit stops; `v_balances` returns no rows, `getBalance()` refuses and the expiry
sweep writes nothing. **Exceptions while off**: `grant()` and `reverseCharge()` keep recording,
so a paid top-up is never dropped and a charge taken while on can always be returned (see
"Decisions"); the account-deletion purge always runs. **Shadow**: charges run and write, and
`v_balances` has rows, but users are shown nothing (`getBalance()` refuses). **On**: all of it.
MVP, live at launch (`docs/decisions.md:93`), wave 3, backlog 4.9.

## Inputs

- `grant()` calls from `subscriptions` (top-up Checkout webhook, the monthly allowance, the
  taste) and `attribution` (referral credit), in the pipeline.
- `chargeUsage()` and `reverseCharge()` calls from the module that runs a metered action, inside
  that action's own transaction (withUser in a procedure, or withPipeline in a job).
- Event `account.deleted` (from `account`): `accountDeletedHandler` purges the user.
- Reads: `@nabvy/switches`' `state(q, 'usage-ledger')`; `@nabvy/account`'s `isActive(q, userId)`
  before a charge of one credit or more.

## Outputs

- **Functions** (`@nabvy/usage-ledger`), each on the caller's transaction:
  - `grant(q, { userId, kind, credits, refId, cashMinor?, expiresAt? })` → `{ entry, changed }`.
    Kinds: `allowance` (must expire), `taste` (must expire), `referral`, `topup`. `cashMinor` is
    the net cash the grant was bought with, in pence; only `allowance` and `topup` may carry it.
    Idempotent on (user, kind, refId); the same refId with other details is `usage-ledger.mismatch`.
  - `chargeUsage(q, { userId, action, credits, refId, costGbpMicros? })` →
    `{ entry, changed, balance, events }`. Idempotent on (user, refId). Refuses whole, never
    partly: `usage-ledger.insufficient` carries `balance` and `required` for the top-up prompt.
    Zero credits never refuses and records only `costGbpMicros`, the provider and model cost the
    action caused for this account (for the free-tier lifetime cap, 4.9a). `events` holds
    `usage-ledger.balance-low` when this charge crossed the low-balance line; the caller publishes
    it after commit.
  - `reverseCharge(q, { userId, refId })` → `{ entry, changed }`: a failed action's credits go
    back to exactly the buckets its charge drew from. A ledger reversal, never a refund of money
    (`docs/decisions.md`, "No refunds"). Idempotent; unknown charge is `usage-ledger.not_found`.
  - `getBalance(q, userId)` → `UsageLedgerBalance` (credits in total and by rank, next expiry):
    the user's balance for the account page and want screen, through a procedure inside withUser.
  - `expireBuckets(q)`: the expiry sweep, one batch of up to 500 buckets (pipeline job).
  - `purge(q, userIds)` and `accountDeletedHandler(deps)`.
- **Event** `usage-ledger.balance-low` v1 `{ userId, entryId }`, keyed
  `usage-ledger.balance-low:<userId>@<entryId>`: the top-up suggestion, for `lifecycle-messaging`.
- **Internal view** `usage_ledger.v_balances` (nabvy_pipeline only until per-module roles exist;
  rows only while not off): `user_id, credits, allowance_credits, taste_referral_credits,
  topup_credits, funding_credits, next_expiry_at, attributed_cost_gbp_micros`.
  `funding_credits` counts only buckets bought with cash (pricing-model, "Funding": taste and
  referral credit never fund speed). `attributed_cost_gbp_micros` sums the cost of every charge,
  reversed or not: the provider was paid.
- **No user-facing view**: no module has created the `app` schema yet (the same call `account`
  made); the user's balance is `getBalance()` through a procedure.
- Error codes `usage-ledger.off | insufficient | account_inactive | mismatch | not_found`, each
  with a message in `USAGE_LEDGER_MESSAGES`.

## Tables

All in the `usage_ledger` Postgres schema. Integers only: credits `integer`, cash integer pence,
cost integer GBP micros (the cost-meter's unit).

- `entries` (the card's `usage_ledger`): `id`, `user_id`, `kind` (`allowance | taste | referral |
  topup | charge | reversal | expiry`), `credits` (signed: grants and reversals add, charges and
  expiries take), `action` (charges only), `ref_id`, `reverses_id` (reversals only), `cash_minor`,
  `cost_gbp_micros` (charges only), `expires_at` (grants only), `at`. **Unique on (user_id, kind,
  ref_id)** and on `reverses_id` (one reversal per charge). Check constraints tie each column to
  its kinds and signs. Append-only: no role may update; only the pipeline deletes (the purge).
- `buckets` (the card's `usage_balances`): one per grant, `id` = the grant entry's id, `user_id`,
  `kind`, `rank` (1 allowance, 2 taste and referral, 3 top-up), `credits`, `remaining`
  (**check: between 0 and credits**), `cash_minor`, `expires_at`, `created_at`. No role writes
  it: an insert trigger on `entries` opens it, and each allocation moves it.
- `allocations`: `(entry_id, bucket_id)` primary key, `user_id`, `credits` (signed, never 0):
  which buckets each charge, reversal or expiry moved. A trigger checks the allocation's entry and
  bucket belong to the same user, that a charge or expiry takes, that an expiry closes only an
  expired bucket, and that a reversal gives back exactly what its charge took from that bucket;
  a deferred trigger checks at commit that an entry's allocations add up to its credits.

RLS on all three (`user_id = withUser's user`). `nabvy_app` may select all three and insert
charges and reversals only (a restrictive policy refuses grants); it cannot touch another user's
rows. `nabvy_pipeline` may select, insert and delete entries and allocations, and select and
delete buckets. Charges take a per-user advisory lock, so concurrent charges wait rather than
fail; the bucket check constraint refuses an overdraw even without it.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Spend order | Allowance; then taste and referral credit; then top-ups. Inside a rank: earliest expiry, never-expiring last, then oldest | `docs/design/pricing-model.md`, "Order"; `docs/billing.md`, "expiring is spent first" | Fixed by the design |
| Refusal | A charge above the live balance is refused whole | Card: "refusal at zero"; `docs/billing.md` | Fixed |
| Expired credit | Counts nothing from `expires_at`, swept or not | `docs/billing.md`: unused included usage expires | Fixed |
| Low-balance line | 50 credits (`USAGE_LEDGER_LOW_BALANCE_CREDITS`) | The Free allowance in `docs/design/pricing-model.md` (a placeholder there) | Starting value; question below |
| Expiry sweep batch | 500 buckets | `CLAUDE.md`, "Batches, not items" | Fixed |
| Prices | None here | Brief: pricing-console owns prices; the caller passes credits | Fixed |

## Fixtures and pass rate

Stage `ledger` (`test/fixtures/ledger.fixtures.ts`), 7/7, synthetic cases built from the card, the
4.9 entry, `docs/billing.md` and `docs/design/pricing-model.md` (there is no recorded run to build
ledger fixtures from), run on the real migrations in PGlite: `bucket-order`, `refusal-at-zero`,
`partial-refused`, `reversal-on-failure`, `grant-once`, `expired-not-spent`, `charge-once`.

`test/domain.test.ts` covers the spend order, allocation and the low-balance boundary.
`test/idempotency.test.ts` runs grant, charge, reversal, the expiry sweep and the
`account.deleted` handler twice each. `test/switch.test.ts` covers off (refusal with the message,
no writes, grants still recorded, empty view), shadow and on, and a reversal after switching off.
`test/ledger.test.ts` covers what the database refuses whoever writes (a grant from the web app,
a bucket edit, a charge without allocations, a forged or oversized reversal, an overdraw), RLS
isolation, the account check, the low-balance event and `v_balances`' attributed cost.
`test/contracts.test.ts` checks the event and the input schemas. `packages/db/tests/usage-ledger.test.sql`
covers grants, RLS, the triggers and the view's switch filter on real Postgres (`pnpm db:dry-run`).

## Decisions

- 2026-09-24: the ledger counts **credits**, not pence. `docs/billing.md` predates the
  owner's "Watching is metered" decision and `docs/design/pricing-model.md`, which price
  everything in credits; each grant keeps the net cash it was bought with (`cash_minor`, pence),
  so a credit's cash value is `cash_minor / credits` without storing a fraction.
- 2026-09-24: the card's table names become `entries` (`usage_ledger`) and `buckets`
  (`usage_balances`) inside the `usage_ledger` schema, plus `allocations`, so a reversal returns
  credit to exactly the buckets its charge drew from.
- 2026-09-24: buckets are written only by triggers, and entries and allocations are
  append-only, so no application code path (nor a bug in one) can mint or move credit outside the
  ledger; the web app role can charge and reverse but never grant.
- 2026-09-24: `grant()` and `reverseCharge()` keep recording while the module is off. Refusing a
  paid top-up would depend on Stripe's retries to avoid losing it, and refusing a reversal would
  keep credits for an action that failed. Recorded as a question.
- 2026-09-24: attributed cost (`cost_gbp_micros`) rides on charges, including zero-credit ones,
  and `v_balances.attributed_cost_gbp_micros` sums it per account, so task 4.9a's £2 lifetime cap
  on free accounts (`docs/decisions.md`, "Free tier: bursts under a lifetime cap", on the
  coordinator's branch) can read it without a schema change.
- 2026-09-24: `estimate(want)` (card) is not here: it needs prices, which the brief keeps in
  `pricing-console`. The ledger supplies the balance and the low-balance event it compares with.
- 2026-09-24: a charge of zero credits skips the account check, so the cost of a check already
  made is always recorded; a charge of one credit or more is refused for an inactive account.
- 2026-09-24: credit a reversal returns to a bucket that has already expired stays there and
  counts nothing (the sweep closes each bucket once).

## Open questions

`docs/questions/usage-ledger.md`: credits vs pence; recording while off; the low-balance line;
the refusal messages; top-up expiry; purge of ledger rows on account deletion.

## Incidents

None.
