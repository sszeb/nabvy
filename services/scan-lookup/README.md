# @nabvy/scan-lookup

Prices a scanned item from shared data first, then eBay and CeX. A module session edits only
this folder, `packages/contracts/src/modules/scan-lookup.ts`,
`packages/config/src/modules/scan-lookup.ts`, `packages/db/src/schema/scan-lookup.ts`,
`packages/db/tests/scan-lookup.test.sql` and `packages/db/migrations/scan-lookup/`.

## Switch and priority

Off by default (rule 11 of `_rules.md`; no seed row, so `switches.state('scan-lookup')` reads
`off`). Off: scans identify but do not price (the card's "When off"); `lookup()` refuses with
`scan-lookup.off` and writes nothing, and both views are empty. Shadow: `lookup()` runs and
writes to the internal view, but never charges usage-ledger (a shadow charge would spend real
credit while the user-facing view shows no row to explain it — the same reasoning
`services/usage-ledger/README.md` records for its own switch), and the user-facing view stays
empty. MVP, from Facebook asks only (`docs/decisions.md:85`). Backlog 3.3, wave 10.

## Inputs

- Event `scan-recognition.identified` v1 (`scanId`), from `scan-recognition`.
- `scan_recognition.v_scans` (scan-recognition): the identified catalogue item and status.
- `asking_price_index.v_groups` (asking-price-index): the group and its figures, filtered to this
  catalogue item, the beta's country and currency.
- Functions: `@nabvy/account`'s `isActive`; `@nabvy/usage-ledger`'s `chargeUsage`.
- Soft (absent in the MVP; `ebay-adapter`, `ebay-sold`, `cex-adapter` and `sold-price-book` do not
  exist yet): `ScanLookupProviders.ebayAsks`, `ebaySold`, `cexPrice`, injected functions a caller
  may supply once those modules exist. Absent, they read as unknown, never as a zero price.

## Outputs

- No event (rule 7): this module's output is `chargeUsage()` calls on the user's own usage-ledger
  balance, run inside `lookup()`'s own transaction.
- Internal view `scan_lookup.v_results` (`nabvy_pipeline`; rows while not off): scan_id, user_id,
  catalogue_id, status, sources, bands, cost, latency_ms, at.
- User-facing `app.v_scan_lookup_results` (`nabvy_app`, own rows by RLS, rows only while on):
  scan_id, catalogue_id, status, sources, bands, cost, latency_ms, at.
- Functions: `lookup(q, { scanId }, options)`, `toInternalResult(row)`, `identifiedHandler(deps)`.

## Tables

Postgres schema `scan_lookup`.

- `lookups`: `scan_id` (primary key — scan-recognition's own scan ID, so a replay finds its row
  and never recharges), `user_id`, `catalogue_id`, `status` (`priced | not_enough_asks`),
  `sources` (text array: which sources were actually queried this lookup), `bands` (jsonb — a
  frozen snapshot of the qualifying asking-price-index figures at `at`, so asking-price-index
  rewriting its own stats later never moves what this scan showed), `cost` (credits charged),
  `latency_ms`.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Band minimum | n ≥ 10 | `docs/decisions.md:15` (owner's rule), shared with asking-price-index's own bands | Fixed, shared so the two floors never drift apart |
| Country and currency | GB, GBP only | `docs/decisions.md`, Precedence, "Region and currency": "For the beta: UK only, Ireland skipped" | Fixed for this push |
| Credit cost per lookup | `SCAN_LOOKUP_CREDIT_COST` (1) | None measured; `pricing-console` (task 4.10b) does not exist yet to value it | Starting value, pending pricing-console |
| Charge order | Price computed first, then charged | `docs/scan-mode.md`, "Guardrails": "the price... is shown before it runs and debited" | Fixed by the spec |
| Shadow never charges | `moduleState === 'on'` gates `chargeUsage` | `services/usage-ledger/README.md`, "Decisions" (the same reasoning applied here) | This module's own decision |

## Fixtures and pass rate

Stage `lookup` (`test/fixtures/lookup.fixtures.ts`), 6 synthetic cases (there is no recorded run
to build scan mode fixtures from; each seeds a scan-recognition scan and asking-price-index
groups directly in PGlite): `priced-band` (n=12, one band), `not-enough-asks` (no group at all —
the card's own fixture, "with every other source off, a scan shows the asking-price position or
'not enough asks'"), `below-band-minimum` (n=9, filtered out), `two-context-bands` (standalone and
in_pc both qualify), `eur-kept-apart` (a qualifying Irish/EUR group, filtered by country and
currency), `insufficient-credit` (a band is found but the user has 0 credits). Pass rate 6/6.

`test/domain.test.ts` covers the band minimum boundary and the context/condition mapping.
`test/idempotency.test.ts` runs `lookup()` twice for the same scan and checks it writes once and
charges once. `test/switch.test.ts` covers off (refusal, empty views), shadow (written internally,
never charged, no user-facing row) and on (charged, the user sees their own row).
`test/contracts.test.ts` checks the schemas and that this module emits no events.
`packages/db/tests/scan-lookup.test.sql` covers grants, per-user RLS on `lookups` and the switch
filter on both views, on real Postgres (`pnpm db:dry-run`).

## Decisions

- 2026-09-26: **No position of its own.** The card says this module shows "Facebook asks only, as
  an asking-price position, never a value." Read literally: `lookup()` surfaces
  asking-price-index's own group figures unchanged (never converts, ranks or picks one condition
  for the scanned item); a future `asking-price-position` module, not this one, would compute an
  actual position. With the scanned item's condition unknown, every qualifying group for the
  catalogue item (across context and condition) is returned as its own band, rather than guessing
  which one applies (`CLAUDE.md`, "No invented numbers").
- 2026-09-26: **eBay, CeX, sold-price-book as injected functions, not stubs.** Those modules do
  not exist yet, so there is no `@nabvy/contracts/modules/<module>` to import for the soft-edge
  pattern rule 1 describes. Following `scan-recognition`'s own precedent for its soft
  `cex-adapter` dependency (`cexBoxLookup`), each is an optional function on
  `ScanLookupProviders`, absent in the MVP; a missing function and one that returns no bands both
  read as unknown (`docs/questions/scan-lookup.md`).
- 2026-09-26: **Charged once the lookup runs, even when the answer is "not enough asks".**
  `docs/scan-mode.md`'s guardrail charges for the price shown, and "not enough asks" is itself a
  real, useful answer this module worked to produce — never charged for a scan this module could
  not price at all (`scan-lookup.not_found`, `scan-lookup.account_restricted`,
  `scan-lookup.insufficient_credit` all skip the charge and write nothing).
- 2026-09-26: **Idempotent on the scan ID alone.** `lookups.scan_id` is the primary key; a replay
  (the same event redelivered, or a repeated call) finds the existing row and returns it without
  re-querying asking-price-index or calling `chargeUsage` again. A conflict from two concurrent
  deliveries is resolved the same way: `usage-ledger`'s own per-user lock makes the charge itself
  race-free, and the losing insert re-reads the winner's row.
- 2026-09-26: **`bands` is a frozen snapshot.** asking-price-index rewrites its `stats` only when
  a group's figures change (its own README, "Decisions"); storing the queried bands on the
  `lookups` row means a scan's shown price never moves underfoot after the fact.

## Open questions

`docs/questions/scan-lookup.md`: the injected-function seam for the not-yet-built eBay, CeX and
sold-price-book providers; the credit cost pending pricing-console; whether "no position of its
own" is the intended reading of the card.

## Incidents

None.
