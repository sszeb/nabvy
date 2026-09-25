# @nabvy/listing-card

Publishes the facts users may see about a listing, in one allowlisted, suppression-filtered view
(`docs/design/modules/listing-card.md`). A module session edits only this folder,
`packages/contracts/src/modules/listing-card.ts`, `packages/config/src/modules/listing-card.ts`,
`packages/db/src/schema/listing-card.ts`, `packages/db/tests/listing-card.test.sql` and
`packages/db/migrations/listing-card/`.

## Switch and priority

Off by default (rule 11 of `_rules.md`; no seed row, so `switches.state('listing-card')` reads
`off`). While off or in shadow, `app.v_listing_card` returns no rows: screens show no listing
details, but every other module still computes on stored data (the module card, "When off").
Priority: first — every user surface needs it (the module card).

## Inputs

No events consumed; this module has no handlers. Views and functions read, all through SQL inside
`app.v_listing_card` (`packages/db/migrations/listing-card/20260925121238_listing_card_access.sql`):

- `listing_ingest.v_listings` (`listing-ingest`): title, price, currency, listed time, town label,
  availability. Fresh card fields always come from here, never from a possibly stale detail fetch.
- `detail_evidence.v_current` (`detail-evidence`): condition, description status, the
  stale-fallback flag. Left-joined: null until a detail fetch exists for the listing.
- `listing_lifecycle.v_status` (`listing-lifecycle`): read only to keep an `unresolved` listing
  (an ID the pipeline could not identify) off the card; its other status values are not shown
  (see "Decisions").
- `listing_suppression.is_suppressed()` (`listing-suppression`): excludes a suppressed listing.
- `quote_redaction.redact()` (`quote-redaction`): masks the title like any quote.
- `switches.is_on()` (`switches`): this module's own switch, and `listing-suppression`'s (rule 11).

## Outputs

No events (this module has nothing to announce; the module card lists only its view).

- **User-facing view** `app.v_listing_card` (`nabvy_app`, `nabvy_pipeline`; a plain view over the
  `security definer` function `app.listing_card()` — see "Decisions"): `listing_id`, `link`,
  `title`, `price_minor`, `currency`, `listed_at`,
  `town_label`, `condition`, `availability`, `description_status`, `possibly_outdated`. No seller
  field, no coordinate, no copy-cluster or relist-group ID, no photo column (the `listing-photos`
  switch stays off; the web app shows a neutral placeholder and an "Open on Facebook" link
  instead).
- **Functions** (`@nabvy/listing-card`): `cardsFor(q, listingIds)` → `ListingCard[]`, the visible
  cards for these listing IDs (an off-switch, suppressed or missing listing is simply absent, never
  an error). Takes any number of IDs, read 500 at a time (rule 9), as
  `listing_suppression.suppressed` does.

## Tables

None. This module owns no tables (`docs/design/modules/listing-card.md`, "Owns: none"); it stores
nothing and needs no `erase()` for `seller-rights` (rule 12). Its migration still creates an empty
Postgres schema, `listing_card`: `packages/db/tests/core.test.sql` requires every module in the
migration ledger to have the schema `replace(module, '-', '_')`, since the foundation's ledger and
view checks derive a module's schema name that way. `packages/db/src/schema/listing-card.ts` exists
only for the folder convention (rule 2) and to give this module's own TypeScript the shape of
`app.v_listing_card` via a `.existing()` view declaration.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| `cardsFor` batch size | 500 | Rule 9 of `_rules.md` (batches, never one query per listing); matches `listing_suppression.suppressed`'s own 500 | Fixed by rule, not calibrated |

No other numeric threshold: this module otherwise projects columns other modules already compute
and applies switch and suppression filters, none of which is tunable.

## Fixtures and pass rate

Stage `card`, 7/7, all synthetic (`test/fixtures/cases.json`): a full card, a listing with no
detail fetch yet, a title with a phone number (masked), a stale-fallback flag, a suppressed
listing (hidden), an unresolved listing (hidden), and a non-Facebook source (no link). No recorded
Facebook run is needed: this module only projects columns listing-ingest, detail-evidence,
listing-lifecycle and listing-suppression already compute from their own fixtures, so a synthetic
row exercises the real view exactly as a recorded one would. The same scenarios (plus the exact
column list and the grant checks) run at the SQL level in `packages/db/tests/listing-card.test.sql`.

## Decisions

- **2026-09-25, `redact()` not `quote()` for the title.** The module card names `quote_redaction.redact()`
  specifically. `redact()` always masks (a pure function, independent of the switch); `quote()`
  additionally fails closed to `null` while `quote-redaction` is off. Since the title is this
  card's primary field (unlike an optional customer quote elsewhere), following the card literally
  keeps titles showing — still masked — even if `quote-redaction` is off, rather than blanking out
  every card's title. `quote-redaction`'s own regex masking still runs unconditionally either way.
- **2026-09-25, `app.v_listing_card` is a thin view over a `SECURITY DEFINER` function, not a plain
  join and not `security_invoker`.** This is the first user-facing view in the repo
  (`packages/db/README.md`, "Views", found no `app.*` precedent). Two drafts came before it, each
  caught by `pnpm db:dry-run`:
  1. `security_invoker = true` with a matching grant of `listing_ingest.v_listings`,
     `detail_evidence.v_current`, `listing_lifecycle.v_status` and the tables underneath them (since
     those three are themselves `security_invoker`) to `nabvy_app`. This broke three other modules'
     own tests: `packages/db/tests/listing-ingest.test.sql`, `detail-evidence.test.sql` and
     `listing-lifecycle.test.sql` each assert `nabvy_app` has *no* schema usage on them at all, a
     hard invariant those modules ship with today.
  2. A plain (owner-executed) view joining straight to those same three views, reasoning that rule
     5's closing line asks for `security_invoker` only on "user-scoped views" and this view has no
     user row or RLS policy at all. `pnpm db:dry-run` still failed with `permission denied for table
     listings` for `nabvy_app`: Postgres checks a `security_invoker` view's own body against the
     true session role wherever it is nested, even underneath a plain outer view whose owner can
     read everything, so wrapping them in a plain view does not shield the caller from needing a
     grant on what those views themselves read from.
  The row-building query now lives in `app.listing_card()`, `security definer`, `set search_path =
  ''`, revoked from `public`, granted `execute` to `nabvy_app` and `nabvy_pipeline` (the reviewer's
  recurring check on functions). A `SECURITY DEFINER` function changes the effective user for its
  whole body, so its nested `security_invoker` views run as the function's owner — the same reason
  `listing_suppression.is_suppressed()` already reads through these same three modules' internal
  views without `nabvy_app` holding any grant on them. `app.v_listing_card` is kept as the public
  name (rule 5, the module card) but is `select * from app.listing_card()`, a plain view needing no
  grant of its own beyond `select` on itself. `packages/db/tests/listing-card.test.sql` asserts the
  function's privileges and that `nabvy_app` still has no usage on the three schemas it reads.
- **2026-09-25, `listing_lifecycle.v_status` is read but not shown.** The module card lists
  `v_status` as an input but does not name a status column among what the card shows. Exposing the
  raw lifecycle status (`live`, `pending`, `marked-sold`, `not-seen-recently`, `unknown`) would add
  user-facing wording the owner has not chosen, so the conservative reading is used: this module
  reads `v_status` only to keep an `unresolved` listing (a broken ID) off the card, and shows
  nothing else from it. Logged in `docs/questions/listing-card.md`.
- **2026-09-25, no `status` filter beyond `unresolved`.** A `not-seen-recently` or `unknown`
  listing still shows: the module card does not ask for it to be hidden, and lifecycle status is a
  system inference, not the seller's own flag (`availability`, which the card does show).
- **2026-09-25, an empty `listing_card` schema, even though the module owns no tables.**
  `packages/db/tests/core.test.sql` ("Schema-name drift") raises `ledger modules without their
  derived schema` for any module in `nabvy_core.schema_migrations` whose own schema
  (`replace(module, '-', '_')`) does not exist, found by running `pnpm db:dry-run`. The migration
  now creates `listing_card` alongside `app`, empty and with no grant beyond the default (nobody
  outside the migration role can do anything with it).
- **2026-09-25, `nabvy_core.view_violations()` does not yet check `app.*` views.** The check's
  `module_schemas` are the ones the migration ledger's `module` column names (schema-derived), so a
  view in the shared `app` schema is out of scope even though this migration's ledger row is named
  `listing-card`. This module's own SQL test asserts the column allowlist (and the plain-view,
  no-new-grant shape above) by hand instead. Flagged in `docs/questions/listing-card.md` as a
  possible follow-up to the check itself (out of this module's file ownership, rule 2).

## Open questions

`docs/questions/listing-card.md` (never `docs/questions.md` itself: `docs/session-conventions.md`).

## Incidents

None.
