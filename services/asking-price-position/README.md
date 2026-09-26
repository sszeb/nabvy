# @nabvy/asking-price-position

Shows where a listing's ask sits among the asks for the same item, context and condition: rank, n,
median and range, to users only at n ≥ 10. It never says "worth", "fair" or "sale price", shows no
score, suggests no offer and checks no price cut (PARTS_INTELLIGENCE.md:179-181,365-367).

## Switch and priority

Default `off` (rule 11). Off: no position shows; nothing else changes. Shadow: positions are written
and `v_positions` fills (T4 stamped), but users see nothing. Priority: first
(`fb-scrap-engine/docs/HANDOFF.md:188`).

## Inputs

| Input | Module | Use |
| --- | --- | --- |
| `asking-price-index.updated` `{ groupKeys }` | asking-price-index | Re-position every member of these groups |
| `asking_price_index.v_groups`, `v_members` | asking-price-index | Figures (n, median, MAD, p25, p75, `as_of`, label, currency) and each member's ask and outcome |
| `listing_ingest.v_listings` | listing-ingest | Card hash (replay key) |
| `detail_evidence.v_current` | detail-evidence | Evidence hash of the current version (replay key) |
| `listing_suppression.is_suppressed()` | listing-suppression | Suppressed listings get no position and never show |
| `switches.state()`, `is_on()` | switches | This module, `pipeline` and `asking-price-index` |

`v_assessments` and `v_parts` (named on the card) are not read: the index already uses them to form
the groups, and a member of a group is by construction an assessed, parts-recorded version.

## Outputs

- Event `asking-price-position.positioned` `{ listingIds }`: listings whose position was written or
  removed, at most 500 per event, keyed by the listings and the group key@as_of versions.
- Internal view `asking_price_position.v_positions` (`nabvy_pipeline`): listing_id, group_key,
  ask_minor, rank, n, percentile, robust_z, label, median, range_low, range_high, currency,
  new_median, new_n, stats_as_of, positioned_at (T4). Every group size, shown or not.
- User-facing `app.v_asking_price_position`: `listing_id, label, rank, n, median, range_low,
  range_high, currency`; only n ≥ 10, never a suppressed listing, only while this module,
  `asking-price-index` and `listing-suppression` are on.
- Functions: `position(q, { groupKeys }, options)`, `erase(q, listingIds)`, handler
  `updatedHandler`; pure `place`, `robustZ`, `shown`, `positionable`, `newGroupKeyOf`.

## Tables

| Table | Key | Columns |
| --- | --- | --- |
| `positions` | unique (`listing_id`, `group_key`) | ask_minor, rank, n, percentile, robust_z, label, median, range_low, range_high, currency, new_median, new_n, card_hash, evidence_hash, stats_as_of, rule_version, positioned_at |

No seller field or seller key. `nabvy_app` can read only the shown columns, under RLS that repeats
n ≥ 10 and the switches.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Group | The asking-price-index group (item × context × condition × country and currency × window) | The card: "same spec and condition" | Brief |
| Who is positioned | Counted asks, and asks the group set aside (relist, copy, one per seller key, outlier); not asks left out for the listing's own reason | This module | Starting rule |
| Rank | 1 + counted asks strictly lower; ties share a rank | "rank" (the card) | Starting rule |
| Percentile | (lower + ½·equal) / n, one decimal; the 4th of 12 is 29.2 | PARTS_INTELLIGENCE.md:74-79 ("about the 29th percentile") | Starting rule |
| Robust z | (ask − median) / (1.4826·MAD), internal only | Standard MAD consistency constant | Fixed |
| Shown | n ≥ 10 | decisions.md:15; SELLER_DATA.md:329 | Owner's rule |
| Range shown | p25-p75 of the counted asks | As `app.v_asking_price_index_bands` | Brief |
| New-build context | Same item's `new` group median and n, when that group has n ≥ 10; internal | HANDOFF.md:189-190 | Starting rule |
| Replay key | listing × group; card hash, evidence hash, group `as_of`, rule version `p1` | Rule 8 | Rule |

## Fixtures and pass rate

Stage `position`, 4/4 (100%), synthetic rows seeded through the upstream modules' own tables in
PGlite and grouped by the real asking-price-index: `worked-example` (12 used-good 9800X3D + RTX 5080
PCs, the target rank 4, 29.2%, shown; 6 like-new PCs, n = 6, recorded and hidden), `below-ten`
(n = 9, nothing shown), `outlier-and-noise` (the outlier positioned at rank 13, the noise listing
not at all), `new-build-context`. `pnpm db:dry-run` passes `packages/db/tests/asking-price-position.test.sql`.

## Decisions

- 2026-09-26: the label, median and range shown are copied from the index's figures at
  positioning time, so the user-facing view reads only this module's table and needs no SECURITY
  DEFINER function (docs/security.md, "Cross-module reads behind a user-facing view"); the copy is
  keyed by the index's `as_of`, and every `updated` event rewrites it.
- 2026-09-26: positions are recorded at every n (T4 means "position computed, or recorded as not
  shown", rule 10); only the user-facing view applies n ≥ 10.
- 2026-09-26: while asking-price-index is off its views are empty; `position` then does nothing
  rather than read that as every group gone, and the user-facing view hides every row.
- 2026-09-26: percentile and robust z stay internal: the card says "no score".

## Open questions

`docs/questions/asking-price-position.md`: the worked example's "any condition" group, new-build
context wording, the repositioning trigger.

## Incidents

None.
