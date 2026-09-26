# @nabvy/want-manager

Stores what each user wants (a want: spec criteria over parts, a price cap, a point and radius,
delivery methods, a check cadence and a delivery speed) and how they want to hear about it
(preferences) (`docs/design/modules/want-manager.md`). It replaces the build pack's hunts. It does
not plan searches or match listings.

A module session edits only this folder, `packages/contracts/src/modules/want-manager.ts`,
`packages/config/src/modules/want-manager.ts`, `packages/db/src/schema/want-manager.ts`,
`packages/db/tests/want-manager.test.sql` and `packages/db/migrations/want-manager/`.

## Switch and priority

Off by default (rule 11 of `docs/design/modules/_rules.md`). Off: `upsertWant`, `setActive`,
`deleteWant` and `setPreferences` refuse (`want-manager.off`), nothing is written, `listWants` and
`wantOwners` answer empty, and every view is empty, so no module downstream sees a want: no
matching, no alerts (card, "When off"). The `account.deleted` purge still runs: it is owed to the
user, not a feature. Shadow: writes go through, the internal views have rows, the user-facing view
has none. MVP, first phase with spec search (card, "Priority and phase"); critical-path priority
[cp 7].

## Inputs

- Web forms through oRPC procedures inside `withUser`: `upsertWant`, `setActive`, `deleteWant`,
  `previewWant`, `listWants`, `getPreferences`, `setPreferences`.
- `account.deleted` (`account`), handled by `onAccountDeleted`: purges the user's rows.
- `pointForPostcode()` (`location`): the want's point; the postcode is never stored. Off or an
  unreachable provider: `want-manager.location_unavailable`; an unknown postcode:
  `want-manager.postcode_unknown`. Injectable (`WantManagerDeps.pointForPostcode`) for tests.
- `city_pages.v_centres` and `v_city_pages` with `city_pages.haversine_km` (`city-pages`), read
  only inside the SECURITY DEFINER function `want_manager.nearest_centre(lat, lng)`: the nearest
  active centre with a coordinate, verified or not. Off: no centre, the want keeps `centreId`
  null until its next save.
- `getEntitlement()` and `subscriptions.v_entitlements` (`subscriptions`, soft): the tier's
  want count and the `paid` flag. With the switch off, the Free limit of 3 applies.
- `account.v_standing` (`account`), read only inside `want_manager.fair_use_want_cap()`: a
  fair-use `maxActiveHunts` only ever lowers the cap.
- `product_catalogue.v_items` (`product-catalogue`), in `v_want_terms_by_centre` only: a
  catalogue ID's family.
- `better_auth.account_active` (`auth`, through `@nabvy/account`'s `isActive`): every write
  refuses for a suspended or banned account (rule 12).
- `listing-search`'s search preview (soft edge, `docs/design/modules/soft-edges.json`):
  injected as `WantManagerDeps.searchPreview`; the documented stub `noSearchPreview` answers
  null.

## Outputs

- **Event** `want-manager.changed` v1 `{ wantIds }` (1 UUID per call): published by the caller
  after its transaction commits, on create, replace, pause, resume and delete. Key
  `want-manager.changed:<wantId>@<versionHash[0:16]>` (rule 8: natural ID plus its version; the
  hash is sha256 of the want's content, `src/domain`), or `…@deleted`. A replay of the same
  content republishes the same key. Never emitted for a preferences change.
- **Internal view** `want_manager.v_wants` (`nabvy_pipeline`; `security_invoker`; rows while
  shadow or on): every want with its criteria as one JSON array and `paid` from
  `v_entitlements`; no user ID. Row type `WantManagerPipelineWant`.
- **Internal view** `want_manager.v_want_terms_by_centre`: `centreId`, `family`, `wantCount`,
  `paidWantCount` over active wants with a centre. The family is the criterion's own, else the
  catalogue item's, else the catalogue ID; a sized part (RAM, storage) names no term.
- **Internal view** `want_manager.v_want_parts`: distinct `centreId`, `partType`,
  `catalogueId`, `family` over active wants with a centre.
- **Internal view** `want_manager.v_want_areas` (for `details-selector`): `centreId`, the
  want's point rounded to a 0.05° grid, `radiusKm`, `acceptsDelivery`. Distinct rows.
- **User-facing view** `want_manager.v_want_manager_wants` (`nabvy_app`; `security_invoker`;
  rows only while `on`): `id`, `centreId`, `centreVerified`, `radiusKm`, `priceCapMinor`,
  `currency`, `active`, `cadenceSeconds`, `deliverySpeed`, `deliveryMethods`, `alternatives`,
  `pcContainment`, `alternativesMaxPriceMinor`, `instantAlternatives`, `instantTopPicks`,
  `filter`, `criteria`, `createdAt`, `updatedAt`: the caller's own wants, no coordinates (the point
  is shown as its centre). Lives in this module's schema because no `app` schema exists yet.
- **Functions** (`@nabvy/want-manager`): `upsertWant(q, input, deps?)`, `setActive(q, input,
  deps?)`, `deleteWant(q, input)`, `previewWant(q, input, deps?)`, `listWants(q, userId)`,
  `getPreferences(q, userId)`, `setPreferences(q, input)`, all inside `withUser`;
  `wantOwners(q, wantIds)` (at most 500) inside `withPipeline` for the modules that deliver to a
  user; `onAccountDeleted(q, payloads)`; the pure `wantVersionHash`, `changedKey`, `deletedKey`,
  `activeWantCap`.

## Tables

Schema `want_manager`:

- `wants`: `id` (UUID v7), `user_id`, `lat`, `lng`, `radius_km` (1–1000), `centre_id`,
  `centre_verified`, `price_cap_minor`, `currency` (`GBP | EUR`), `active`, `cadence_seconds`
  (the seven-step ladder), `delivery_speed` (`instant | batched_15 | batched_60 | daily`),
  `delivery_methods` (`collection`, `posted`; 1–2), `alternatives` (`off | variants |
  variants_plus_tier`), `pc_containment`, `alternatives_max_price_minor`, `instant_alternatives`,
  `instant_top_picks`, `filter` (JSONB, `WantManagerFeedFilter`), `version_hash`. Row-level
  security on `user_id`.
- `criteria`: `id`, `want_id` (cascade), `user_id`, `position` (0–9, unique per want),
  `part_type` (`gpu | cpu | ram | storage`), `catalogue_id`, `family`, `min_attr` (JSONB),
  `or_better`. A catalogue part names an ID or a family; a sized part carries `min_attr` (check
  `criteria_shape`). Row-level security on `user_id`.
- `preferences`: `id`, `user_id` (unique), `hide_noise`, `hide_spam`, `hide_multi_quantity`,
  `channels` (`push`, `telegram`, `email`; at most 3), `quiet_hours` (JSONB). Row-level security
  on `user_id`.

`centre_id` and `catalogue_id` are plain values, never foreign keys into another module's schema
(rule 4).

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Free active-want limit while `subscriptions` is off | 3 (`WANT_MANAGER_FREE_ACTIVE_WANT_LIMIT`) | `docs/decisions.md`, "Free-tier limits: 3 active hunts"; the card | Fixed by the decision |
| Cap while `subscriptions` is on or in shadow | the entitlement's `wants`, lowered by a fair-use `maxActiveHunts` | Card: "Hunt limits come from `subscriptions`"; `docs/decisions.md` fair use | Fixed |
| A paused want never counts against the cap | — | Card: "Free limit of 3 *active* wants" | Fixed |
| Cadence ladder | 4 h, 2 h, 1 h, 30 min, 15 min, 5 min, 1 min | `docs/design/cadence-slider.md` | Fixed |
| Form's starting cadence | 15 min (`WANT_MANAGER_DEFAULT_CADENCE_SECONDS`) | The ladder's middle, cheaper than the card's 5-minute example | Starting value |
| Delivery speed default | `instant` | Card: "Instant is the default" | Fixed |
| Alternatives defaults | `variants_plus_tier`; containment off; cap = the want's; instant alternatives off; instant top picks on | Card, last sentence of "Does / does not" | Fixed |
| Area grid for `v_want_areas` | 0.05° (`WANT_MANAGER_AREA_GRID_DEGREES`) | Card: "point rounded to the postcode district"; `location`'s 5 km rounding | Starting value |
| Radius bound | 1–1000 km | The user sets it freely (owner); every input is bounded | Starting value |
| Purge batch | 500 users per call | `CLAUDE.md`, "Batches, not items" | Fixed |

## Fixtures and pass rate

Stage `wants` (`test/fixtures/wants.fixtures.ts`), 5 synthetic cases (no recorded Facebook run
needed: this module never reads listing content, only the user's own wants) —
`create-two-centres`, `free-limit-off-subscriptions`, `fair-use-lowers-cap`,
`replay-and-replace`, `unknown-postcode-and-off`. Each case runs a step list through
`upsertWant`/`setActive`/`deleteWant` and checks the outcome codes, the stored wants and centres,
and the rows of all four internal views. Pass rate 5/5 (2026-09-25).

Other tests: `test/domain.test.ts` (the version hash, the keys, the cap's boundary values),
`test/wants.test.ts` (postcode resolution and the centre, the cap under every source, replacing,
pausing, deleting, preferences), `test/idempotency.test.ts` (a replay writes nothing and keeps
the key; changed content is a new key; the old content is the old key again),
`test/switch.test.ts` (off refuses and empties every view; shadow writes with internal rows only;
on shows the own wants), `test/rls.test.ts` (a user cannot read, update, insert or delete as
another user; no internal view carries a user ID; the pipeline cannot read the user-facing view;
`fair_use_want_cap()` answers nothing outside `withUser`), `test/purge.test.ts`,
`test/contracts.test.ts` (the schema's check lists match the contract enums; the event, the want
and every view row parse; the paid flag, the family term and the rounded area), and
`packages/db/tests/want-manager.test.sql` (grants, the two SECURITY DEFINER functions, the
constraints, RLS isolation, the views' content and the switch filter, on real Postgres —
`pnpm db:dry-run`).

## Decisions

- **2026-09-25: the per-want alternative controls live on `wants`, not `preferences`.** The
  card's open shape question; the card's own text drafts them per hunt, so `wants` carries them
  with the card's defaults, and `preferences` keeps only the per-user hide flags, channels and
  quiet hours. Recorded in `docs/questions/want-manager.md`.
- **2026-09-25: the want's version is a content hash, and a no-op save writes nothing.** The
  event key needs a version (rule 8); `updated_at` would change on every save and re-alert the
  pipeline for nothing. `wants.version_hash` is sha256 of the canonical content (criteria and
  centre included), the key carries its first 16 hex characters, and `upsertWant` compares before
  it writes.
- **2026-09-25: two SECURITY DEFINER functions instead of grants to `nabvy_app`.** The web app
  needs the nearest centre (city-pages' internal views) and the fair-use limit (account's
  pipeline-only `v_standing`) while it runs as `nabvy_app` inside `withUser`. Both follow
  `docs/security.md`'s shape (`language sql`, `stable`, pinned `search_path`, explicit `returns
  table`, revoked from public, granted to `nabvy_app` only); `fair_use_want_cap()` filters on
  `nabvy_core.current_user_id()`, so outside `withUser` it answers nothing.
- **2026-09-25: `v_wants` carries the criteria as one JSON array.** One view for spec-match and
  alert-router instead of a second `v_want_criteria` to join; the array's shape is
  `WantManagerCriterion`.
- **2026-09-25: the postcode is never stored.** Only its point is; the user-facing view shows
  neither, only the centre.
- **2026-09-25: no event for a preferences change.** The card names only `want-manager.changed`
  (want IDs); a notifier reads preferences when it sends.
- **2026-09-25: the cap counts the caller's own active wants under RLS.** Every count and write
  runs as `nabvy_app` inside `withUser`; the pipeline role only purges and reads for the views and
  `wantOwners`.

## Open questions

`docs/questions/want-manager.md`: the `FeedFilter` placeholder; the search preview and the
estimate procedure as stubs; the Free limit (3 in the card, 1 in `subscriptions`' fallback);
the per-want controls' shape; the defaults shown to users; `wantOwners()` as a function; the
user-facing view outside `app`.

## Incidents

None.
