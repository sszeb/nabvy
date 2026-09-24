# @nabvy/listing-suppression

Keeps the suppression list and resolves it to the listings every user-facing view must hide
(`docs/design/modules/listing-suppression.md`).

A module session edits only this folder, `packages/contracts/src/modules/listing-suppression.ts`,
`packages/config/src/modules/listing-suppression.ts`, `packages/db/src/schema/listing-suppression.ts`,
`packages/db/tests/listing-suppression.test.sql` and `packages/db/migrations/listing-suppression/`.

## Switch and priority

Off by default (rule 11), and fails closed: every user-facing view of listings adds
`and switches.is_on('listing-suppression')`, so while this module is off or in shadow users see no
listings at all. `v_suppressed` and `is_suppressed()` always answer, and `add()` always records;
the module has no batch work for "off" to stop. Launch priority: objection and erasure are built
before launch (`fb-scrap-engine/docs/design/SELLER_DATA.md:131`).

## Inputs

- `add(q, input)`, called by `seller-rights` only: a request ID, the listings the requester named
  (source and source listing ID, from their links) and seller keys from `seller-key`.
  `seller-rights` must call `add()` before any `erase()` of the named listings: look-alikes are
  taken from the listings still visible in listing-ingest and detail-evidence, so suppression
  applies before erasure finishes (backlog 4.12). Until `seller-key` exists, `AddReport` counts the
  seller keys that hide nothing yet (`unenforcedSellerKeys`).
- Views of `listing-ingest`: `v_listings` (listing IDs of named listings; listing hashes of every
  listing), `v_fingerprints` (card look-alikes: title, price and city page).
- View of `detail-evidence`: `v_fingerprints` (description look-alikes of the current version).
- `seller-key`'s `restricted_listing_keys` (soft): not read yet; seller-key entries are recorded
  but not resolved until that module exists (`docs/questions/listing-suppression.md`).
- Switches `listing-ingest` and `detail-evidence` (`switches.state`), to fail closed while their
  views are empty.
- Consumes no events.

## Outputs

- **Event** `listing-suppression.changed` v1 `{ entryIds }` (1–500 entry UUIDs): every entry of the
  request, returned by `add()` for the caller to publish after commit. Key
  `listing-suppression.changed:<requestId>@<entries>:<batch>`: a replay publishes the same key,
  and a retry that adds look-alikes a new one. Readers re-check the listings they show.
- **SQL function** `listing_suppression.is_suppressed(listing_id uuid) → boolean`, SECURITY
  DEFINER, `EXECUTE` for `nabvy_app` and `nabvy_pipeline` only. True when an entry hides the
  listing now; also true for a null ID, and for every listing while a module whose view an active
  entry needs is off. Every user-facing view of listings calls it (rule 5).
- **Internal view** `listing_suppression.v_suppressed` (`nabvy_pipeline`; security_invoker; not
  filtered by the switch): listing_id, reason (`listing_hash | lookalike`; `seller_key` once
  resolved), until (null: no end) (`ListingSuppressionSuppressed`). One row per listing and reason.
- **Restricted and user-facing views:** none.
- **Functions** (`@nabvy/listing-suppression`): `add(q, input, { now? })` → `AddReport`,
  `suppressed(q, listingIds)` → the set hidden now (for `notifier` before a send and for batch
  readers; 500 IDs per query), and the pure helper `listingHash`.

## Tables

Schema `listing_suppression`:

- `entries`: `id` (UUID v7); `kind` (`listing_hash | seller_key | lookalike`), `basis`
  (`description | card`, look-alikes only), `value` (64 lowercase hex characters, checked),
  `expires_at` (look-alikes only), `request_id` (the `seller-rights` request), `created_at`,
  `updated_at`. Unique `(request_id, kind, value)`; index `(kind, value)`. `nabvy_pipeline` may
  select and insert; no role may update or delete.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Listing hash | SHA-256 of `source:sourceListingId`, lowercase hex, unsalted; the same in TypeScript and SQL | Card; SELLER_DATA.md:132-133; PARTS_INTELLIGENCE.md:355-356 | Fixed (question in `docs/questions/listing-suppression.md`) |
| Named listing | Hidden with no end | SELLER_DATA.md:132-133 | Fixed |
| Card look-alike | listing-ingest's fingerprint of title (lower case, whitespace collapsed), price, currency and city page | SELLER_DATA.md:136-137 | Fixed |
| Description look-alike | detail-evidence's fingerprint of the current description (lower case, whitespace collapsed) | SELLER_DATA.md:136-137 | Fixed |
| Look-alike life | 90 days from when it is recorded (`LISTING_SUPPRESSION_LOOKALIKE_DAYS`); matches while `expires_at > now()` | SELLER_DATA.md:135-138 | The brief's value |
| Seller key | Stored as `seller-key` gives it (64 hex); a raw seller ID is refused | SELLER_DATA.md:134; rule 6 | Fixed; not resolved yet |
| Fail closed | A listing reads as suppressed while a view an active entry needs is empty because its module is off | Rule 11 | Starting value (question) |
| Batch | At most 500 named listings and 500 seller keys per `add`; 500 IDs per event and per `suppressed` query | CLAUDE.md, "Batches, not items"; rule 7 | Fixed |

## Fixtures and pass rate

Stage `add` (`test/fixtures/add.fixtures.ts`), on the real migrations in PGlite: the recorded run
`fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/` stored as a collected gateway job,
ingested by `listing-ingest` and recorded by `detail-evidence`, then a request, then later runs.
Each case checks the entries written, `v_suppressed`, `suppressed()` and a sample user-facing view
built as rule 5 requires:

- `named-listing`: row 0 named; three entries; row 0 hidden, 19 rows shown.
- `relist-same-card` (synthetic, row 0 under a new ID with another description): hidden by the card
  look-alike.
- `relist-same-description` (synthetic, row 0 under a new ID with another title and price): hidden
  by the description look-alike.
- `lookalike-expired` (synthetic, request recorded 2026-06-01): the relist shows after 90 days; the
  named listing stays hidden.
- `named-before-ingest`: only the hash is recorded, reported in `withoutLookalike`; the listing is
  hidden once collected.
- `seller-key-only` (synthetic key): recorded, hides nothing yet.
- `unknown-listing`: an ID no run returned; recorded, hides nothing.

Pass rate 7/7 (2026-09-24). Other tests: `domain.test.ts` (the hash, the 90-day boundary to the
millisecond, entry building, batching, event keys), `idempotency.test.ts` (a replay writes nothing
and returns the same keys; a retry after ingestion adds the look-alikes under a new key; a replay
keeps the first expiry; bad input writes nothing; the TypeScript and SQL hashes agree),
`switch.test.ts` (off and shadow: `add` records, the list answers, the sample app view is empty;
failing closed with `listing-ingest` or `detail-evidence` off, and not on expired look-alikes;
`nabvy_app` calls `is_suppressed()` but cannot read the list; no updates or deletes),
`contracts.test.ts` (the event, every entry and every `v_suppressed` row parse; only hashes stored,
no seller-like column) and `packages/db/tests/listing-suppression.test.sql` (grants and function
privileges, checks, resolution and expiry, a suppressed listing never reaching an `app` view, the
app view empty while off or in shadow, failing closed with `listing-ingest` or `detail-evidence` off, the description look-alike branch, the foundation's view check). No module reads
this one yet, so no reader's fixtures run with it off; `app.v_listing_card`'s own test covers that
once `listing-card` exists, with a stand-in view here meanwhile.

## Decisions

- **2026-09-24: `basis` beside `kind`.** The card's three kinds do not say which fingerprint a
  look-alike holds; `basis` (`description | card`) picks the view that resolves it. Checked: set on
  look-alikes only, together with `expires_at`.
- **2026-09-24: live resolution in SQL.** `v_suppressed` and `is_suppressed()` join the entries to
  listing-ingest's and detail-evidence's views when read, so a listing is hidden from the moment it
  is ingested, with no handler lag. `is_suppressed()` looks up one listing; `v_suppressed` hashes
  every listing and is meant for batch readers. A table of resolved matches is the alternative if
  that grows slow or the fail-closed cost is too high (question).
- **2026-09-24: fail closed on empty inputs.** See "Rules" and `docs/questions/listing-suppression.md`.
- **2026-09-24: nothing is updated or deleted.** The card: "It deletes nothing". A look-alike stops
  matching at `expires_at` and its row stays; a replay keeps the first expiry. The pipeline role
  has no update or delete grant. Without listing rows the module has no `erase()` (rule 12 asks it
  of modules that hold listing rows) and no user rows to purge.
- **2026-09-24: `add` names listings by source listing ID.** Requesters give listing links (Art 11;
  SELLER_DATA.md:140-141), which carry the source ID, so `add` takes `{ source, sourceListingId }`,
  hashes it and keeps neither the link nor the ID. Look-alikes come from the named listings found in
  listing-ingest; one not ingested yet is reported in `withoutLookalike`.
- **2026-09-24: `changed` carries every entry of the request**, keyed by the request and its entry
  count, since entries only grow; a retry that adds look-alikes announces them.
- **2026-09-24: `nabvy_app` has usage on the schema** only so it can call `is_suppressed()`;
  Postgres requires schema usage to call a function. It has no grant on the table or the view.
- **2026-09-24: view rows are Zod in contracts.** `drizzle-zod` is not a dependency yet, as in
  `detail-evidence`.
- **2026-09-24: `AddReport.unenforcedSellerKeys`** (review of PR #52): seller keys are recorded
  but hide nothing until `seller-key` exists, and the report says so, so `seller-rights` cannot
  report such a request as honoured.
- **2026-09-24: `listing-ingest` and `detail-evidence` are dev dependencies only.** The module
  reads their views through `@nabvy/db`; the tests use their `ingest` and `record` to build real
  rows.

## Open questions

`docs/questions/listing-suppression.md` (folded into `docs/questions.md` by the coordinator):
seller-key resolution; failing closed; the unsalted hash; look-alikes taken at request time.
Catalogue question 9.

## Incidents

None.
