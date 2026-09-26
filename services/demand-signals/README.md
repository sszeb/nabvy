# @nabvy/demand-signals

Publishes demand per search centre and catalogue family per week, from first-party wants plus
wanted and swap adverts, with every count under 10 suppressed; never anything by user or seller
(`docs/design/modules/demand-signals.md`).

A module session edits only this folder, `packages/contracts/src/modules/demand-signals.ts`,
`packages/config/src/modules/demand-signals.ts`, `packages/db/src/schema/demand-signals.ts`,
`packages/db/tests/demand-signals.test.sql` and `packages/db/migrations/demand-signals/`.

## Switch and priority

Off by default (rule 11 of `docs/design/modules/_rules.md`). Off: `publishWeek` acknowledges and
writes nothing, no event is returned, and `v_cells` is empty (the table keeps what it holds).
Shadow and on: a closed week is written and `v_cells` shows it. Users lose nothing while it is
off: nothing reads it yet, and no user-facing view exists in any state (card, "When off").
Priority "Also" or "Later" (card, `fb-scrap-engine/docs/HANDOFF.md:199-200`,
`PARTS_INTELLIGENCE.md:219`); critical-path priority [cp 1] in round 8.

## Inputs

All read as `nabvy_pipeline` through the owners' views, at publish time:

- `want_manager.v_want_terms_by_centre` (`want-manager`): `centre_id`, `family`, `want_count`
  over active wants with a centre. No user ID is read (the view has none).
- `listing_assessment.v_assessments` (`listing-assessment`): the latest assessment of each
  listing, its `kind` (parts-record's, `wanted_or_swap` for a wanted or swap advert) and its
  `confirmed_parts` (catalogue IDs).
- `listing_ingest.v_listings` (`listing-ingest`): `id`, `city_page_id`, `listed_at` (T0),
  `first_fetched_at` (T1). No title, price or seller field is selected.
- `city_pages.v_area_membership` (`city-pages`): the nearest centre of the listing's city page.
  The card's `v_centres` is read through it (the membership view joins the centres).
- `product_catalogue.v_items` (`product-catalogue`): a catalogue ID's family; empty while that
  module is off, when the catalogue ID stands for its family (want-manager's own fallback).
- `copy_advert.v_members` (`copy-advert`, soft): a listing's active cluster, so a wanted advert
  posted in many towns counts once per cell and week. Off or empty: each advert counts once.
- `switches.state('demand-signals')` (`switches`).

The card's `want-manager.changed` and `copy-advert.clustered` are not consumed: a week is built
once, after it closes, from the views as they then stand (Decisions).

## Outputs

- **Event** `demand-signals.published` v1 `{ weekStart }` (the Monday's ISO date), returned by
  `publishWeek` for the caller to publish after commit, whenever the week has cells at this rule
  version. Key `demand-signals.published:<weekStart>@<ruleVersion>`: a replay returns the same key.
- **Internal view** `demand_signals.v_cells` (`nabvy_pipeline`; `security_invoker`; rows while
  shadow or on): `week_start`, `centre_id`, `family`, `wants`, `adverts`, `suppressed`,
  `rule_version`, `published_at`. Row type `DemandSignalsCell`. No user ID, seller field, listing
  ID or location finer than the centre.
- **User-facing views:** none (card; `docs/questions/demand-signals.md`).
- **Functions** (`@nabvy/demand-signals`): `publishWeek(q, { weekStart }, now)`,
  `publishLastClosedWeek(q, now)`, `listCells(q, weekStart)`, `runWeekly(deps, now)` (the weekly
  job's body), and the pure `weekStartOf`, `lastClosedWeek`.

## Tables

Schema `demand_signals`:

- `cells`: `id` (UUID v7), `week_start` (a Monday, check), `centre_id` (city-pages' ID as a plain
  value), `family`, `wants`, `adverts` (each null or at least 10, checks), `suppressed` (true
  exactly when both counts are null, check), `rule_version` (`ds-<n>`), `published_at`. Unique on
  `(week_start, centre_id, family, rule_version)`. `nabvy_pipeline` has select and insert only.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Suppression threshold | 10 (`DEMAND_SIGNALS_SUPPRESSION_THRESHOLD`); each count under it is stored as null; also a table check | Card ("cells under 10 suppressed", question 20); `docs/decisions.md` (aggregates only at n≥10) | Fixed by the rule |
| A cell is suppressed | when both counts are null | `docs/questions/demand-signals.md` | Starting value |
| Week | Monday 00:00 UTC to the next Monday, half-open; only a closed week is published | Card: "per centre per week" | Fixed |
| A wanted or swap advert | latest assessment's kind `wanted_or_swap` | parts-record's kinds (`PartsRulesKind`) | Fixed by the input |
| An advert's week | T0 (`listed_at`), else T1 (`first_fetched_at`) | rule 10 | Starting value |
| An advert's centre | nearest centre of its city page (`v_area_membership`) | want-manager's nearest-centre rule | Fixed |
| An advert's families | each confirmed part's catalogue family, else its catalogue ID; once per family | want-manager's family fallback | Fixed |
| Copied adverts | one unit per active copy-advert cluster per cell | Card; `copy-advert.md` section 7 | Fixed |
| A week's wants | active wants when the week is published | Only a current view exists | Starting value |
| Rule version | `ds-1` (`DEMAND_SIGNALS_RULE_VERSION`) | Rule 8 | v1 |

## Fixtures and pass rate

Stage `cells` (`test/fixtures/cells.fixtures.ts`), 6 synthetic cases, built from the card's rules
and the input views' shapes (no recorded run holds wanted adverts in these numbers:
`PARTS_INTELLIGENCE.md:219`, 0.39% of listings): `suppression-boundary`, `copy-cluster-once`,
`copy-advert-off`, `week-bounds-and-kind`, `two-families-one-listing`,
`switch-off-writes-nothing`. Each seeds wants and adverts into the input modules' own tables on
the real migrations in PGlite, publishes one week and checks the cells `v_cells` shows. Pass rate
6/6 (2026-09-25).

Other tests: `test/domain.test.ts` (weeks, the threshold's boundary 9/10, cluster counting,
ordering), `test/idempotency.test.ts` (a replay writes nothing and keeps the key, also after the
inputs changed; the weekly job; the table refuses a duplicate cell and any count under 10),
`test/switch.test.ts` (off writes nothing and empties `v_cells`; shadow and on show rows; no grant
to `nabvy_app`; every input off writes nothing), `test/privacy.test.ts` (no user ID or listing ID
in any output, no user, seller, listing or location column, the event carries the week only, a
lone want is a suppressed cell, `nabvy_core.view_violations()` empty), `test/contracts.test.ts`,
and `packages/db/tests/demand-signals.test.sql` (grants, checks, the switch, the view
conventions, on real Postgres: `pnpm db:dry-run`).

## Decisions

- **2026-09-25: a count under 10 is never stored.** The cell keeps null and the table's checks
  refuse a smaller value, so a small count cannot leak through a later view or a direct read.
- **2026-09-25: a week is written once.** The first publish of a week at a rule version writes
  every cell under the week's advisory lock; a replay, a retry or a concurrent duplicate writes
  nothing, even if the inputs have changed since. A rule change is a new `rule_version`.
- **2026-09-25: no event consumed.** The week is built once from the views after it closes, so
  `want-manager.changed` and `copy-advert.clustered` would have nothing to do here.
- **2026-09-25: the weekly task file is not added here.** `trigger/package.json` is shared; the
  module exports `runWeekly` for a thin `schedules.task` (question file).
- **2026-09-25: counts only, no listing IDs stored.** The table holds no listing or user row, so
  there is nothing for `erase()` or the `account.deleted` purge to remove, and neither is exported.

## Open questions

`docs/questions/demand-signals.md`: who sees demand data; what "cells under 10 suppressed"
means for a two-count cell; the want snapshot; what a wanted or swap advert is; the unconsumed
events; the weekly task file; suppressed listings.

## Incidents

None.
