# @nabvy/relist-merge

Recognises, internally only, when an item comes back under a new listing ID, so the index counts
it once and users get one alert per item (`docs/design/modules/relist-merge.md`).

A module session edits only this folder, `packages/contracts/src/modules/relist-merge.ts`,
`packages/config/src/modules/relist-merge.ts`, `packages/db/src/schema/relist-merge.ts`,
`packages/db/tests/relist-merge.test.sql` and `packages/db/migrations/relist-merge/`.

## Switch and priority

Off by default (rule 11). While it is off, `merge` acknowledges and writes nothing, and `v_groups`
returns no rows; the same while the global `pipeline` switch is off. Users lose nothing shown
wrongly: each listing ID stands alone, so there are more alerts and double counts. Shadow behaves
like on: the module has no user-facing output. `erase` runs whatever the switch says. Build,
internal (`fb-scrap-engine/docs/design/SELLER_DATA.md:144`).

## Inputs

- Events `listing-ingest.first-seen` v1 and `detail-evidence.changed` v1, `{ listingIds }`,
  handled by `firstSeenHandler` and `detailChangedHandler`. A new listing usually merges on the
  second, when its description arrives.
- View of `listing-ingest`: `v_listings` (source, city page, listed time T0, first fetch T1, last
  sighting).
- Views of `detail-evidence`: `v_fingerprints` (hash of the current normalised description) and
  `v_text` (its length).
- Soft, injected through `MergeEvidence` (defaults return nothing): `photo-review`'s
  `v_photo_hashes` (`photoMatches`) and `seller-key`'s `restricted_listing_keys` (`sellerKeys`).
  Neither module exists yet; nothing here imports them (`docs/questions/relist-merge.md`).
- Switches `relist-merge` and `pipeline`, through `@nabvy/switches` (fail closed).

## Outputs

- **Event** `relist-merge.merged` v1, payload `{ listingIds }` (1–500 listing UUIDs): every member
  of every group that holds a listing of the batch, so readers reload whole groups. Key
  `relist-merge.merged:<version>:<batch>`, where the version hashes each group's ID with the hash
  of its sorted member IDs (rule 8), read back from stored rows.
- **Internal view** (`nabvy_pipeline`; security_invoker; empty while off):
  `relist_merge.v_groups`: group_id, listing_id, basis, matched_listing_id, input_fetched_at,
  merged_at, group_created_at (`RelistMergeGroup`).
- **Restricted and user-facing views:** none. A relist group ID, "relisted", "seen before" or any
  history across listing IDs is never shown to users (`fb-scrap-engine/docs/design/SELLER_DATA.md:153-155,289-290,337`).
- **Functions** (`@nabvy/relist-merge`): `merge(q, { listingIds }, evidence?)`,
  `erase(q, listingIds)`, `firstSeenHandler(deps)`, `detailChangedHandler(deps)`, `noEvidence`,
  and the pure helpers `withinReach`, `blocked` and `onePerGroup` (one row per item, for index
  readers).

## Tables

Schema `relist_merge`:

- `groups`: `id` (UUID v7), `created_at`, `updated_at`.
- `members`: `id`, `group_id` (→ `groups`, cascade), `listing_id` (listing-ingest's, a plain
  value), unique `listing_id` (one group per listing), `basis` (`origin | description | photo`),
  `matched_listing_id` (null only for the origin), `input_fetched_at` (the listing's T1),
  `merged_at` (server time), `created_at`, `updated_at`. No seller field and no seller key.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Description match | Same `v_fingerprints.fingerprint` (current description, lower case, whitespace collapsed) | The card; `SELLER_DATA.md:148` | Starting value |
| Photo match | Shared photo sha256, through `photoMatches` (none until photo-review) | `SELLER_DATA.md:148-149,156-158` | Waits for photo-review |
| Reach | Same source, same known city page, gap between sighting intervals ≤ 7 days (`RELIST_MERGE_WINDOW_DAYS`), for both kinds of evidence | `SELLER_DATA.md:148-149`; the card | Starting value (questions file) |
| Short text | A description under 40 characters never merges (`RELIST_MERGE_MIN_DESCRIPTION_CHARS`) | This module: stock lines are shared by different items | Starting value |
| Seller key | Only breaks ties; different keys block only when both numeric or seen in the same run; checked against every member of the group joined | `SELLER_DATA.md:150-152` | Fixed by the brief |
| Choice | A shared key, then description before photo, then the smallest gap, then the lowest listing ID | The card: "description matching first" | Starting value |
| Origin | The earlier listing (listed time, else first fetch) of the first pair | This module | Fixed |
| Stability | A member never moves; two groups never merge | This module (questions file) | Starting value |
| Event batch | 500 listing IDs (`RELIST_MERGE_EVENT_BATCH_SIZE`) | Rule 7 | Fixed |
| Retention | Groups kept until the owner sets a period | Catalogue question 23 | Open |

## Fixtures and pass rate

Stage `merge` (`test/fixtures/merge.fixtures.ts`), on the real migrations in PGlite, from the
recorded run `fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/` stored as collected
gateway jobs, ingested by `listing-ingest` and recorded by `detail-evidence`. Synthetic relists are
recorded rows under a new listing ID, listed some days later (`test/support/database.ts`,
`relist`); seller keys and photo matches are injected from the case.

- `recorded-run`: 20 listings, 20 distinct descriptions (checked by hand): no group, nothing
  announced.
- `relist-within-window` (synthetic, 3 days): one group, the original as origin.
- `relist-outside-window` (10 days), `relist-other-city`, `short-description` (28 characters):
  no group.
- `relist-reformatted` (upper case, doubled spaces): merges on the normalised fingerprint.
- `relist-chain` (3 and 8 days): the second relist is out of the original's reach and joins
  through the first; the group of three is announced.
- `seller-key-block` (different numeric IDs): no group. `seller-tokens-other-runs`: merges.
- `seller-key-tiebreak`: a listing reaching two unmergeable earlier ones joins the one sharing its
  seller token, not the nearer one.
- `photo-match` (new text, injected photo match): merges on photo.

Pass rate 11/11 (2026-09-24). Every merged group in these cases was checked by hand against its
`notes.md`. Other tests: `domain.test.ts` (the window boundary at exactly 7 days, city page and
source, every seller-key rule, the ranking, stable members, the group version, and the synthetic
index case: PC 4070's median moving from £1,050 to £1,000 when n goes from 26 to 25,
`SELLER_DATA.md:66-68`), `idempotency.test.ts` (a replay writes nothing and returns the same keys;
the pair reached from either side makes one group; a grown group announces a new version; bad
input refused; both handlers publish once), `switch.test.ts` (off, paused pipeline, shadow,
detail-evidence off, erase, upstream modules carry on with this module off; no reader module
exists yet), `contracts.test.ts` (the event and every view row parse; no seller-like or key
column) and `packages/db/tests/relist-merge.test.sql` (grants, the unique key and checks, the
view's columns, empty while off, the foundation's view check). `pnpm db:dry-run` passes on
Postgres 16 locally.

## Decisions

- **2026-09-24: both input events.** The card names `first-seen` and `detail-evidence.changed`.
  A first-seen listing from a search run has no description yet, so it merges when its details
  arrive; first-seen still catches listings known first through a details run.
- **2026-09-24: one advisory lock per call.** `merge` takes a transaction-scoped advisory lock, so
  two deliveries never open two groups for one pair. Batches are 100–500 listings, so the lock
  serialises little.
- **2026-09-24: `matched_listing_id` and `input_fetched_at` beside the card's columns.** The card
  lists `members (group_id, listing, basis, merged_at)`. The matched listing lets the hand check
  the card asks for see why each member joined; T1 is rule 10's input stamp.
- **2026-09-24: erasure dissolves the group.** Rather than re-pointing matches around an erased
  listing, `erase` removes every group that holds one; its other listings stand alone again.
- **2026-09-24: view rows are Zod in contracts.** `drizzle-zod` is not a dependency yet, as in
  `detail-evidence`.
- **2026-09-24: the gateway's conventions test lists this module's test support** beside
  listing-ingest's and detail-evidence's, since it seeds collected jobs into the gateway's tables
  in PGlite (never a live database). A one-line change in
  `services/apify-gateway/test/conventions.test.ts`.
- **2026-09-24: no RLS.** No user rows; the pipeline role alone has grants, `delete` only for
  `erase` (rule 12). The module is outside the T-stamp chain: it stores the T1 of its input and
  its own `merged_at` (rule 10).

## Open questions

`docs/questions/relist-merge.md` (folded into `docs/questions.md` by the coordinator): the photo
and seller-key seams, the window for description matches, short descriptions, stable
memberships, retention (catalogue question 23), empty upstream views.

## Incidents

None.
