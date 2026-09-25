# @nabvy/inventory

Records the items a user bought and sold, with profit: every cost, sale price and date is what
the user typed, never an estimate (`docs/design/modules/inventory.md`; CLAUDE.md, "No invented
numbers"). A module session edits only this folder, `packages/contracts/src/modules/inventory.ts`,
`packages/config/src/modules/inventory.ts`, `packages/db/src/schema/inventory.ts`,
`packages/db/tests/inventory.test.sql` and `packages/db/migrations/inventory/`.

## Switch and priority

Off by default (rule 11 of `_rules.md`; no seed row, so `switches.state('inventory')` reads
`off`). While it is off, inventory is unavailable: `addItem()` and `recordSale()` return
`inventory.off`, both views are empty and the inventory page shows nothing. In `shadow`, writes
still land and `inventory.v_items` has rows, but `app.v_inventory_items` is empty. Nothing here
moves money or sends to a user. Priority BP3 (`docs/backlog.md:51`), critical path `[cp 3]`.

## Inputs

- `account.deleted` v1 (`account`): purges the users' items, `onAccountDeleted()`.
- `app.v_listing_card` (`listing-card`): `addItem()` with a `sourceListingId` checks the listing is
  on the caller's card.
- `scan_recognition.v_user_scans` (`scan-recognition`): `addItem()` with a `scanId` checks the scan
  is the caller's own and takes its `identified` product key when the form gives none.
- `switches.state()` / `switches.is_on()` (`switches`); `better_auth.account_active()` through
  `@nabvy/account`'s `isActive()` (`account`); `listing_suppression.is_suppressed()`
  (`listing-suppression`) inside the user-facing view.

## Outputs

- **Event** `inventory.outcome-recorded` v1: `{ itemIds }` (1 to 500). Emitted by `recordSale()`
  when a sale is recorded or corrected; never for adding an item. Key: the item ID plus the sale as
  stored (`outcomeKey()` in `src/domain`), so the same sale republishes the same key and a
  correction publishes a new one. Stamps `sold_recorded_at` (server time). `sold-reports` consumes
  it, only with the user's separate consent (its card).
- **Internal view** `inventory.v_items` (`nabvy_pipeline`): `id, user_id, product_key, currency,
  cost_minor, bought_at, sold_minor, sold_at, sold_on, sold_recorded_at`; rows while the switch is
  shadow or on. No source listing or scan ID. Row type `InventoryItemInternal`.
- **User-facing view** `app.v_inventory_items` (`nabvy_app`, `security_invoker`, rows while the
  switch is on): `id, product_key, source_listing_id, scan_id, currency, cost_minor, bought_at,
  sold_minor, sold_at, sold_on, profit_minor`. `profit_minor` is `sold_minor - cost_minor`, null
  until sold. `source_listing_id` reads null while the listing is suppressed or
  `listing-suppression` is off. Never a seller field, a user ID or listing content. Row type
  `InventoryItem`.
- **Functions** (`src/index.ts`, all inside `withUser`): `addItem(q, input, { now })`,
  `recordSale(q, input, { now })`, `itemsFor(q)`; handler `onAccountDeleted(q, payloads)`.

## Tables

Postgres schema `inventory`.

| Table | Key columns | Unique keys |
| --- | --- | --- |
| `items` | `id` (the client's item ID), `user_id`, `product_key`, `source_listing_id`, `scan_id`, `currency`, `cost_minor`, `bought_at`, `sold_minor`, `sold_at`, `sold_on`, `sold_recorded_at` | `id` |

Check constraints: at least one of `product_key`, `source_listing_id`, `scan_id`; the product key
has product-catalogue's shape and at most 200 characters; `currency` in GBP, EUR; amounts between
0 and 100,000,000 minor units; `bought_at` from 2000-01-01; the three sale columns set together or
all null; `sold_at >= bought_at`; `sold_on` only with a sale and one of the shared `Source`
values. `nabvy_app` may insert and may update only the four sale columns; no delete grant. The
pipeline reads and deletes (the purge) and never inserts.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Largest amount | 100,000,000 minor units (£1,000,000.00) | A bound on user input, not a price; nothing Nabvy prices comes near it | starting value |
| Earliest purchase date | 2000-01-01 | A bound on user input so a typo never makes a 1970 row | starting value |
| Latest purchase or sale date | today, server time (`dateOf(now)`, UTC) | PR template: never a window from caller input | fixed |
| Sale currency | must equal the item's | `packages/contracts/src/core/money.ts`: never converted | fixed |

## Fixtures and pass rate

Stage `record` (`test/fixtures/record.fixtures.ts`), nine synthetic cases in
`test/fixtures/cases/`, each a sequence of `addItem`/`recordSale` calls by one user at a fixed
server date, built from the module card and the contracts (no recorded Facebook run: the module
never reads listing content). Cases: buy then sell; the same form twice; the same ID with a
different item; the same sale twice; a corrected sale; a loss in EUR on the purchase day; a sale
before the purchase or after today; a sale in the wrong currency; a purchase dated tomorrow and a
sale on an unknown item. Latest pass rate: 9/9 (`test/fixtures/pass-rates.json`). Listing and
scan links are covered in `test/rls.test.ts`, where the other modules' rows are seeded.

Unit tests: `domain` (date order, currency, profit, event key), `contracts`, `idempotency`,
`switch`, `rls` (cross-user select, update, insert; column-level update; scan and listing links;
suppression), `purge`. `packages/db/tests/inventory.test.sql` runs in `pnpm db:dry-run`.

## Decisions

- **2026-09-25, the client's item ID is the idempotency key.** As scan-recognition does with
  `scanId`, the "I bought this" form carries an `itemId` the client generates, so a retry or a
  double tap is the same item (`on conflict (id) do nothing`, then a read back through RLS). The
  same ID with different input, or another user's ID, is `inventory.conflict`, never an overwrite.
- **2026-09-25, a sale's key is the item ID plus the sale as stored.** Recording the same sale
  again changes nothing (not even `sold_recorded_at`) and republishes the same key; correcting it
  replaces the sale in place and publishes a new key. There is one sale per item: the row, not a
  history.
- **2026-09-25, one currency per item.** The card lists no currency column, but the shared money
  contract is never a bare number, so `currency` is set at purchase and a sale in another currency
  is refused. Profit is only ever computed within one currency (`docs/questions/inventory.md`).
- **2026-09-25, dates are calendar dates the user picks, bounded by server time.** `bought_at` and
  `sold_at` are `date` columns (the user says "sold on Tuesday", not at what second); the module
  refuses a date after today (server clock, UTC) or a sale before the purchase, and the SQL check
  `items_sold_after_bought` backs the second in the database. `sold_recorded_at` is the server
  stamp.
- **2026-09-25, a scan fills in the product key.** With a `scanId` and no `productKey`, the item
  takes the scan's `identified` (null if the scan was unidentified); an explicit `productKey` on
  the form wins. The scan must be the caller's own, read through `scan_recognition.v_user_scans`
  (RLS, rows only while scan-recognition is on), so a scan ID cannot be guessed.
- **2026-09-25, a listing must be on the caller's card at purchase time.** `addItem` with a
  `sourceListingId` checks `app.v_listing_card`, so a purchase is never recorded against a
  suppressed, unresolved or unknown listing ID. Afterwards the row keeps the ID; the user-facing
  view nulls it while the listing is suppressed or `listing-suppression` is off, keeping the item
  itself (the user's money record). `docs/questions/inventory.md`.
- **2026-09-25, column-level update, no delete.** After insert only the sale can change, so
  `nabvy_app` gets `update (sold_minor, sold_at, sold_on, sold_recorded_at)` and no delete; the
  card names no remove or edit of a purchase (`docs/questions/inventory.md`).
- **2026-09-25, `app.v_inventory_items` is a plain `security_invoker` view over this module's own
  RLS table.** Unlike `app.v_listing_card` it joins no other module's table, so it needs no
  SECURITY DEFINER function; its only cross-module calls are `switches.is_on()` and
  `listing_suppression.is_suppressed()`, both already granted to `nabvy_app`. As with listing-card,
  `nabvy_core.view_violations()` does not scan `app.*`, so the SQL test asserts the view rules by
  hand.
- **2026-09-25, no thresholds in config.** The two bounds (largest amount, earliest date) bound
  user input that crosses the API boundary, so they live in the contracts file next to the schemas
  they bound, as `SCAN_RECOGNITION_PHOTO_MAX_BYTES` does; `packages/config/src/modules/inventory.ts`
  stays the empty scaffold.

## Open questions

`docs/questions/inventory.md` (never `docs/questions.md` itself: `docs/session-conventions.md`).

## Incidents

None.
