# @nabvy/price-drop-watch

Lets a user watch a listing, keeps its price history within that one listing ID, and alerts when
its observed asking price falls (`docs/design/modules/price-drop-watch.md`).

## Switch and priority

Off by default (rule 11 of `docs/design/modules/_rules.md`; no seed row exists yet, so
`switches.state('price-drop-watch')` reads `off` until an admin turns it on). While off: `watch()`
and `unwatch()` are refused (`price-drop-watch.module_off`) — the card's own words, "no watches
and no drop alerts" while off, unlike details-queue's `enqueue`, listing-lifecycle's
`requestRecheck` or listing-suppression's `add`, which are rule 11's named exceptions because they
are another module's infrastructure; this module's watch is its own user-facing feature, so it
follows the plain default. `applyEvent` and `tick` acknowledge and write nothing, the same while
the global `pipeline` switch is off (the pipeline pause does not gate `watch()`/`unwatch()`
themselves: a user's own write is not pipeline processing). Shadow runs and writes like `on`, with
no user-facing output: both `app.*` views stay empty. `erase()` runs whatever the switch says
(rule 12). Priority: first — the brief wins over the build pack's "not in version 1"
(`docs/decisions.md`, "Precedence").

## Inputs

- Events `listing-ingest.card-changed` v1 and `relist-merge.merged` v1, `{ listingIds }`, handled
  by `cardChangedHandler` and `mergedHandler`, both running the same check
  (`applyEvent`). `relist-merge.merged` re-checks a group's members, in case the group formed after
  its own price change was already read (see "Decisions").
- Event `account.deleted` v1 `{ userId }` (`account`), handled by `accountDeletedHandler`: purges
  the account's watches and drops (rule 12).
- Views of `listing-ingest`: `v_listings` (does the watched listing exist), `v_price_changes`
  (the listing's own observed price transitions, joined to `v_sightings` for the triggering
  sighting's card hash).
- View of `relist-merge`: `v_groups` (the listing's group ID, if any, for the announcement
  dedupe below).
- `requestRecheck()` (`listing-lifecycle`): asked, in `tick()`, for every actively watched listing,
  reason `watched`.
- `listing_suppression.is_suppressed()` and `switches.is_on('listing-suppression')`, called from
  the `app.*` views only (never from the pipeline check, which has no user-facing output to hide
  anything from).
- Switches `price-drop-watch` and `pipeline`, through `@nabvy/switches` (fail closed).

## Outputs

- **Event** `price-drop-watch.dropped` v1, payload `{ watchIds }` (1–500 watch UUIDs): every watch
  whose listing dropped in this batch and was chosen to announce (see "Decisions"). Key
  `price-drop-watch.dropped:<trigger>:<batch>`, where `trigger` is the incoming event's own key —
  an unchanged pass named again repeats a key the transport has already seen.
- **User-facing views** (`app` schema; `nabvy_app` only today — no other module has declared this
  one as a dependency yet):
  - `app.v_price_drop_watch_watches` (id, listing_id, active, created_at): the caller's own
    watches (RLS on the underlying table).
  - `app.v_price_drop_watch_history` (listing_id, observed_at, price_minor, currency): the
    watched listing's own observed prices only — the anchor (first fetched price) plus every
    later `listing_ingest.v_price_changes` row. Never the seller's displayed "previous price",
    never a number this module invents, and never a row from another listing ID even when
    relist-merge has grouped it with this one (the card: "It never shows history across listing
    IDs"). Both views require `switches.is_on('price-drop-watch')` and
    `switches.is_on('listing-suppression')`, and anti-join `listing_suppression.is_suppressed()`
    (rule 5): a suppressed listing, or an off/unreachable suppression module, hides every row
    rather than showing it again.
- **Functions** (`@nabvy/price-drop-watch`): `watch(q, { userId, listingId })`,
  `unwatch(q, { userId, listingId })`, `applyEvent(q, { listingIds, key })`, `tick(q)`,
  `accountDeletedEvent(q, userIds)`, `erase(q, listingIds)`, `cardChangedHandler`, `mergedHandler`,
  `accountDeletedHandler`, and the pure `isDrop`, `dedupeAnnouncements`.

## Owned tables

Postgres schema `price_drop_watch`.

- `watches`: `id`, `user_id`, `listing_id` (listing-ingest's, a plain value), `active`,
  `created_at`, `updated_at`. Unique `(user_id, listing_id)`: one watch per user and listing.
  Unwatching sets `active` false rather than deleting the row, so the user's own drop history
  stays and re-watching just reactivates it. Row-level security on `user_id`.
- `drops`: `id`, `watch_id` (→ `watches`, cascade), `from_minor`, `to_minor` (must be strictly
  lower), `currency`, `observed_at`, `card_hash` (the triggering sighting's own card hash, copied
  verbatim — the idempotency key material with `watch_id`), `relist_group_id` (relist-merge's
  group ID at write time, a plain value, nullable — an extra column beyond the card, like
  relist-merge's own `matched_listing_id`; see "Decisions"). No user column: never read by
  `nabvy_app` directly, only through the history view (which never touches this table — see
  "Decisions").

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| A drop | `toMinor < fromMinor`, both observed, same currency | The card | Fixed |
| History source | `listing_ingest.v_price_changes` (plus the listing's first fetched price as the anchor); never `displayedPreviousMinor` | The card: "the seller's displayed previous price appears only as the seller's own figure, never as history" | Fixed |
| Idempotency key | `(watch_id, card_hash)`; `card_hash` is listing-ingest's own sighting hash | Rule 8 (card-stage `cardHash`); this module has no `detail-evidence` dependency, so only `cardHash`, not `cardHash`+`evidenceHash` | Deviation from rule 8's generic "price stages" row, recorded in `docs/questions/price-drop-watch.md` |
| Group announcement dedupe | One announcement per `(relistGroupId, toMinor)` per batch, earliest watch (`watchCreatedAt`, then `watchId`) wins; every candidate is still written | README "Decisions"; catalogue question 21 ("relist-merge only stops the same item alerting twice") | Starting value; the card leaves the exact mechanics to this module (question 21) |
| Announced once | A drop is announced only by the pass whose insert wrote its `drops` row; only changes observed at or after the watch's `created_at` are candidates | README "Decisions"; review of PR #70 | Fixed |
| Watched recheck cadence | `tick()` asks once per active watch, at least daily (the caller's schedule); listing-lifecycle itself batches (≥ 20, or a day's wait) | `PARTS_INTELLIGENCE.md:190-191`; `listing-lifecycle`'s own "watched" reason | Starting value |
| Batch | 500 listing IDs and watch IDs per handler pass, recheck request and event | Rule 7; `CLAUDE.md`, "Batches, not items" | Fixed |

## Fixtures and pass rate

Stage `watch` (`test/fixtures/watch.fixtures.ts`), on the real migrations in PGlite, from the
recorded run `fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/` stored as a
collected gateway job and ingested by listing-ingest:

- `watch-price-drop` (synthetic): a watched listing re-collected at a real lower price; one drop
  written, one announcement.
- `watch-price-rise-no-alert` (synthetic): a watched listing re-collected at a higher price;
  `card-changed` fires but `isDrop()` refuses a rise — nothing written or announced.
- `watch-unchanged-reword-no-alert` (synthetic): the card's own required case, "an unchanged
  price across repeated sightings gives no alert" (the brief's Romford listing, reworded here as a
  title-only edit across two re-collections, since the recorded run has no matching case): genuine
  `card-changed` events fire, but `listing_ingest.v_price_changes` has no row for an unmoved price,
  so nothing is written or announced.
- `watch-displayed-previous-ignored` (recorded): the card's other required case, "the recorded
  listing asking £450 with a displayed previous price of £499" (listing 1072745435569624,
  `dataset.json`, `conflicts[0]`): re-collected with a title-only edit; the seller's displayed
  figure is never read as history, so nothing is written or announced.
- `watch-drop-then-reword-once` (synthetic): a real drop, then a title-only re-collection at the
  same lower price; the second `card-changed` finds the same latest price change, its `drops` row
  is already there, so the drop is announced once in total.
- `watch-created-after-drop-no-alert` (synthetic): the drop is observed before the user watches;
  a later reword fires `card-changed`, but a change observed before the watch's `created_at` is
  never a candidate, so nothing is written or announced.

Cases may set `stepsBeforeWatch` and `watchedAt`; the harness pins the watch's `created_at`
(default: the recorded run's start), since the fixtures' sightings carry fixed recorded times.

Pass rate 6/6 (2026-09-25; 4/4 on 2026-09-24). Other tests: `domain.test.ts` (`isDrop`'s boundary, `dedupeAnnouncements`'s
group tie-break and its ties-break-on-watchId case, `chunk`, `triggerId`, `eventKey`),
`idempotency.test.ts` (a replayed `card-changed` writes nothing new and announces nothing new;
unknown listing IDs are simply ignored), `switch.test.ts` (off refuses `watch()`/`unwatch()`
and empties `applyEvent`/`tick`, but `erase()` still runs; the pipeline pause does not gate
`watch()`; shadow runs and writes with no user-facing output), `watch.test.ts` (idempotent
watch/re-watch, two users on one listing, unwatch deactivates and re-watch reactivates the same
row, `tick()`'s recheck request and its paging past the first 500 watched listings, `erase()` and `account.deleted`'s own-user-only purge),
`relist-dedupe.test.ts` (two watches on two listings relist-merge has grouped, dropping to the
same price in one batch: both get their own `drops` row, only the earlier watch is announced),
`contracts.test.ts` (events and every view row parse; a history row with an extra column is
refused) and `packages/db/tests/price-drop-watch.test.sql` (grants; RLS isolation including
`WITH CHECK`; the `drops` checks — strictly lower, non-negative, a real sha256; both `app.*`
views' columns, `security_invoker` and switch/suppression gates, checked by hand because
`nabvy_core.view_violations()` only scans schemas the migration ledger lists as modules, and `app`
is not itself one; `listing_price_history()`'s and `listing_known()`'s `SECURITY DEFINER`
privileges, `nabvy_app` only, and the history helper's user scope called directly as `nabvy_app`:
the watcher, another user, an unwatched listing and no `app.user_id` at all).

## Decisions

- **2026-09-24: `price-drop-watch` is the first module to publish an `app.*` view.** No module has
  created the `app` Postgres schema yet (`services/account/README.md`, "Decisions": "no module has
  created the `app` schema yet"). This module's own access migration creates it with
  `create schema if not exists app`, idempotent so a second module's migration in the same
  parallel wave is a no-op, never a conflict.
- **2026-09-24: the history view reads listing-ingest's internal views through a `SECURITY
  DEFINER` helper, not a direct join.** `listing_ingest.v_listings` and `v_price_changes` are
  internal views (rule 5), granted only to `nabvy_pipeline` until per-module roles exist. A
  `security_invoker` view queried by `nabvy_app` cannot reach them directly (that role has no
  grant), so the cross-module read is wrapped in `price_drop_watch.listing_price_history(uuid)`,
  owned by the migration role and callable by `nabvy_app`, exactly as
  `listing_suppression.is_suppressed()` wraps its own cross-module reads. The outer view stays
  `security_invoker` and touches only this module's own `watches`, so RLS still scopes every row
  to the caller. Recorded in `docs/questions/price-drop-watch.md` as a pattern other modules
  publishing their first `app.*` view will likely need too.
- **2026-09-25: the helpers follow the coordinator's conditions** (`docs/security.md`,
  "Cross-module reads behind a user-facing view"; `docs/questions.md`, "Coordinator answers").
  `nabvy_pipeline` has no usage on schema `app` and no execute on either helper: the pipeline
  reads `listing_ingest.v_listings`/`v_price_changes` directly with its own grants, and no
  pipeline code calls `listing_known()`. `listing_price_history()` (row-returning) is scoped in
  its own body, since its owner bypasses RLS: it returns rows only when
  `nabvy_core.current_user_id()` has an active watch on that listing, so a call outside `withUser`
  or for another user's listing returns nothing. `listing_known()` stays an unscoped boolean over
  one opaque ID. Both are `language sql`, `stable`, `security definer`, `set search_path = ''`,
  fully schema-qualified, revoked from `public` and granted to `nabvy_app` only; the SQL test
  probes each of these as `nabvy_app`.
- **2026-09-24: relist-merge's "stops the same item alerting twice" is implemented as an
  announcement dedupe, not a data merge (catalogue question 21).** A watch never moves to another
  listing ID (the card is explicit), so relist-merge cannot change what a watch points at. The
  only place two watches can otherwise double-announce what is really one item is when relist-merge
  has grouped their listings and a batch's price check lands both on the same new price (most
  plausibly the same user watching both the original and its relist, discovered separately). Every
  drop is still written to its own watch's `drops` row (so each watch's own history stays
  complete); only the batch's *announcement* picks one watch per `(relistGroupId, toMinor)`, the
  earliest by `watchCreatedAt` then `watchId`. This is the conservative reading of an explicitly
  open question; recorded in `docs/questions/price-drop-watch.md`.
- **2026-09-24: `relist-merge.merged` re-runs the same check, not a separate code path.** Both
  input events call `applyEvent`; the merged event's listing IDs are just another batch to check
  for active watches and price drops, so a relist-merge group that forms after a price change was
  already read still gets the dedupe applied on the next relevant event.
- **2026-09-24: the idempotency key is `(watch_id, card_hash)`, with only `cardHash`, not rule 8's
  `cardHash + evidenceHash`.** Rule 8's table groups "price-drop watch" under stages that read
  both hashes, but this module's own card lists no `detail-evidence` dependency, and its history is
  explicitly "card sightings the app already collects" — never detail text. Recorded in
  `docs/questions/price-drop-watch.md`.
- **2026-09-24: `watch()`/`unwatch()` are gated on this module's own switch, not the global
  pipeline pause.** The named exceptions in rule 11 (details-queue's `enqueue`, listing-lifecycle's
  `requestRecheck`, listing-suppression's `add`) are infrastructure other modules call; watching is
  this module's own user-facing feature, so it follows the default ("off": refused) rather than an
  exception, matching the card's "no watches ... while off". The pipeline pause is a separate,
  background-processing concern and does not gate a user's own write.
- **2026-09-24: `tick()` asks for every active watch's listing every time it runs**, relying on
  listing-lifecycle's own `requestRecheck` to no-op a still-pending schedule and to decide the
  actual batching (≥ 20, or a day's wait) — this module does not re-derive that policy. It pages
  through the watched listings 500 at a time, keyed on `listing_id` (2026-09-25, review of PR #70).
- **2026-09-25: a drop is announced once, and only if observed while the watch existed** (review
  of PR #70). Each pass reads a watched listing's latest price change whatever event arrived, so
  a later `card-changed` (a reword, a new photo) or `relist-merge.merged` finds the same drop
  again. `insertDrops` returns the watch IDs whose `drops` row it actually wrote, and only those
  are announced; a drop already on record is never announced again under a new key. A change
  observed (`seen_at`, the sighting's collection time) before the watch's `created_at` is never a
  candidate, so a user who starts watching after a drop is never told about it. Reactivating a
  watch (`watch()` after `unwatch()`) keeps its original `created_at`, so a drop observed while it
  was inactive and not yet written can still be announced on the next pass after reactivation;
  accepted as the simpler rule. A replay now announces nothing (the transport would drop its
  unchanged key anyway), so a pass whose writes committed but whose event was never published
  loses that announcement; recorded in `docs/questions/price-drop-watch.md`.
- **2026-09-24: no RLS on `drops`.** It carries no `user_id` and is never read by `nabvy_app`
  directly, only through the history view, which reads listing-ingest's own observations instead
  (see "Owned tables"); the pipeline role alone has grants.

## Open questions

`docs/questions/price-drop-watch.md`: the relist-merge announcement dedupe mechanics (question
21); the idempotency key's missing `evidenceHash`; the `SECURITY DEFINER` pattern for a module's
first `app.*` view, for the coordinator to confirm as the convention other modules follow.

## Incidents

None.
