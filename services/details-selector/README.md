# @nabvy/details-selector

Chooses which newly seen listings get a paid detail fetch. A module session edits only this
folder, `packages/contracts/src/modules/details-selector.ts`,
`packages/config/src/modules/details-selector.ts`, `packages/db/src/schema/details-selector.ts`,
`packages/db/tests/details-selector.test.sql` and `packages/db/migrations/details-selector/`.

## Switch and priority

Off by default (rule 11 of `_rules.md`; no seed row, so `switches.state('details-selector')`
reads `off`). While it is off, or while the global `pipeline` switch is off, `select` acknowledges
`listing-ingest.first-seen` and writes nothing, and `v_selections` returns no rows; nothing is
enqueued through `detailsQueue.enqueue()`. Users lose automatic detail fetches for new listings
while it is off; pasted links and rechecks still use `details-queue` directly (its own queue is
unaffected). Shadow runs and writes, and calls `enqueue()` as usual (the queue's own switch, not
this one, gates a paid fetch), but the module has no user-facing output either way. P1: runs for
active hunts (`nabvy/docs/decisions.md:131-135`).

## Inputs

- Event `listing-ingest.first-seen` v1 `{ listingIds }` (`listing-ingest`), handled by
  `firstSeenHandler`.
- `listing_ingest.v_listings` (`listing-ingest`): source, sourceListingId, cardHash, cityPageId,
  categoryId, deliveryTypes for the arriving listings.
- `city_pages.v_area_membership` (`city-pages`): each city page's nearest active centre and
  whether it is in that centre's area.
- want-manager's `v_want_areas` (soft; not built): see "Decisions" below.
- Switches `details-selector` and `pipeline`, through `@nabvy/switches` (fail closed).

## Outputs

- **Events:** none. It calls `detailsQueue.enqueue()` directly instead of publishing.
- **Function called:** `@nabvy/details-queue`'s `enqueue()`, for every newly selected, `facebook`
  source card version: `priority: 'new-listing'`, `lane: 'text'`, `reason: 'first-seen'`,
  `requestedBy: 'details-selector'`.
- **Internal view** `details_selector.v_selections` (`nabvy_pipeline`; security_invoker; empty
  while off): source, source_listing_id, card_hash, reason, selected_at (T2)
  (`DetailsSelectorSelection`). No restricted or user-facing views (rule 5): a selection is never
  shown to a user.
- **Functions** (`@nabvy/details-selector`): `select(q, { listingIds }, evidence?)`,
  `erase(q, listingIds)`, `firstSeenHandler(deps)`, the pure helpers `categoryAllows`, `classify`,
  `selectBatch`, `chunk` (`src/domain`).

## Tables

Schema `details_selector`:

- `selections`: `id` (UUID v7), unique `(source, source_listing_id, card_hash)` — one row per
  selected card version, so a card that has not changed is never re-selected or re-enqueued, and a
  changed card (a new price, title or availability) is a fresh row (rule 8's card-stage
  idempotency key). `reason` (`in_area | shipped`), `selected_at` (T2), plus `created_at`/
  `updated_at`.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| In-category allowlist | 4 Facebook category IDs, all `categoryPath` `Electronics > Computers > …` despite mismatched `categoryName` ("Electronics & computers", "Miscellaneous", "Video Games", "Household") | `fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json:99,147-149,498,540-542,839,882-884`; card, "Facebook's category is unreliable" | Starting value, calibrated on the one recorded run |
| Unknown category | Counts as in | Card | Fixed |
| Unknown area | Not selected (never enqueued) | This module: selection triggers a paid fetch, so an unknown area is the conservative default, unlike an unknown category (docs/questions/details-selector.md) | Starting value |
| Area fallback | city-pages' own `v_area_membership.inArea` (which already applies its "100 km from the centre" starting value) | Card: "100 km from the centre applies … while want-manager is not built" | Starting value, until want-manager exists |
| Shipping delivery types | Starts empty: `shipped` never fires on real data | No recorded run shows a shipping-offering listing's `deliveryTypes` value (CLAUDE.md, "no invented numbers"); observed values are IN_PERSON, PUBLIC_MEETUP, DOOR_PICKUP, DOOR_DROPOFF | Starting value (docs/questions/details-selector.md) |
| No title filter | Never applied | Card: "whatever its price or title"; a bare "Gaming pc" title is selected | Fixed |
| Batch size | 500 listing IDs | Rule 9 (`DETAILS_SELECTOR_EVENT_BATCH_SIZE`); matches `detailsQueue.enqueue()`'s own 1–500 cap | Fixed |

## Fixtures and pass rate

Stage `select` (`test/fixtures/select.fixtures.ts`), on the real migrations in PGlite, from the
recorded run `fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/`, each row retitled to
a fresh source listing ID so cases never collide:

- `bare-title-in-area`: a bare "Gaming pc" title (no GPU keyword at all) on Armagh's city page — a
  seeded city page with its own coordinate, about 54 km from Belfast's centre (a seeded, active,
  verified centre with a real reported coordinate) — is selected `in_area`.
- `out-of-area-not-shipped`: a city page never in the seed (card-added, no coordinate) has no
  active centre in reach, and the row's recorded delivery types are not shipping; not selected.
- `unknown-category-in-area`: category cleared entirely, in area; still selected (unknown counts
  as in).
- `known-other-category-excluded`: a synthetic category ID outside the allowlist, in area; not
  selected (a *known* other category excludes; an *unknown* one does not).
- `city-pages-off-selects-nothing`: the same in-area row as `bare-title-in-area`, but with
  `city-pages` switched off first, so `v_area_membership` is empty; not selected (the conservative
  default requested by city-pages' own review, since it could not test this before
  details-selector existed).

Pass rate 5/5 (2026-09-24). Every case also replays the same batch and asserts the second `select`
selects nothing (rule 8). Other tests: `domain.test.ts` (`classify`, `categoryAllows`, `chunk`,
boundary values including the `shipped` branch, which no fixture case reaches yet — see
"Decisions"), `idempotency.test.ts` (a replayed batch and a replayed handler delivery write
nothing new; a changed card hash is re-selected; malformed input is refused), `switch.test.ts`
(off, paused pipeline, shadow, city-pages off, erase, upstream modules unaffected),
`contracts.test.ts` (every `v_selections` row parses; no seller-like column), and
`packages/db/tests/details-selector.test.sql` (grants, the unique key and checks, the switch
filter, the foundation's view check).

## Decisions

- **2026-09-24: `select` calls `detailsQueue.enqueue()` directly rather than publishing an event.**
  The card's "Outputs" line names only `detailsQueue.enqueue()`; there is no
  `details-selector.selected` event for anything to consume, so `firstSeenHandler` emits nothing.
- **2026-09-24: want-manager's soft edge is a single injected port, `deliveryCentres`.** The card's
  full rule — "measured from the want's point", with per-want radius overrides — needs a want's own
  coordinate, which want-manager does not exist to provide. Rather than half-build that geometry
  against no real schema, the injected `DetailsSelectorEvidence.deliveryCentres(q, centreIds)`
  answers only "does an active want at this centre accept delivery", used solely for the `shipped`
  reason; its default (`noWantAreas`) returns none, so `shipped` never fires and area membership
  falls back entirely to city-pages' own `v_area_membership` — exactly the card's documented
  fallback ("100 km … while want-manager is not built"). The seam is recorded in
  `docs/questions/details-selector.md` for the session that builds want-manager to replace.
- **2026-09-24: unknown area is not selected; unknown category is.** The card states the category
  default explicitly ("unknown counts as in") but is silent on an unknown area (city-pages off, or
  a page with no resolvable coordinate). Selection here directly causes a paid Apify detail fetch
  (`details-queue`), so this module treats an unknown area as the conservative default and does not
  select — the opposite of the category default, and consistent with `CLAUDE.md`'s "Ask, don't
  guess: … pick the conservative option" (docs/questions/details-selector.md).
- **2026-09-24: the in-category allowlist follows `categoryPath`, not `categoryName`, as its
  basis.** The one recorded run shows a single desktop-PC listing's category labelled all of
  "Electronics & computers", "Miscellaneous", "Video Games" and "Household" across its 20 listings,
  each time under `categoryPath` `Electronics > Computers > …` — direct evidence of the card's "full
  PCs filed under 'Computer cases'". No category ID for a standalone GPU listing has been recorded
  (docs/questions/details-selector.md).
- **2026-09-24: `detailsQueue.enqueue()` is called only for `source: 'facebook'` selections.**
  `DetailsQueueSource` accepts only `facebook` today. `selections` itself is source-agnostic
  (the card's own column list), so a future adapter's rows would still be recorded and simply wait
  to be enqueued once details-queue accepts their source.
- **2026-09-24: one line added to `services/apify-gateway/test/conventions.test.ts`'s `seeders`
  allowlist.** That test enumerates the packages whose test support seeds `apify_gateway.jobs`/
  `items` directly, in PGlite only, to exercise `listing-ingest.ingest()` and `city-pages.
  reconcileSeen()` for real; four modules (listing-ingest, detail-evidence, run-coverage,
  relist-merge) already do this. This module's test support needs the identical seeding to build
  up `listing_ingest.v_listings` and `city_pages.v_area_membership` for its fixtures, so it is a
  fifth entry, not a new mechanism. It is the one file this module's session touches outside its
  own file set (rule 2); the change is a single appended array element.
- **2026-09-24: a known architectural overlap with `details-queue`, left unresolved here** — see
  "Open questions": `details-queue`'s own `firstSeenHandler` already enqueues every
  search-originated `first-seen` listing unconditionally, bypassing this module's area/category
  gate entirely when both handlers are wired to the same event.
- **2026-09-24: `erase` maps listing UUIDs to `(source, sourceListingId)` through
  `listing_ingest.v_listings`.** `selections` itself holds no listing UUID (the card's column
  list), so erasure needs that join; a listing listing-ingest no longer shows (already erased, or
  the module off) simply contributes no pair, and erasure of an already-gone selection is a no-op.

## Open questions

`docs/questions/details-selector.md`: the `details-queue` overlap (its own `firstSeenHandler`
enqueues unconditionally, which would make this module's gate ineffective wherever both handlers
run); the shipping `deliveryTypes` value (no recorded run shows one); a GPU-specific category ID;
whether an unknown area should instead default to selecting (today: conservative, does not select);
want-manager's future replacement of the `deliveryCentres` stub. Card's own open questions 33 and
`actor-integration.md` questions 6 and 17.

## Incidents

None.
