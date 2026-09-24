# Search, map and pickup routes — condensed design

Condensed from `docs/design/drafts/search-map-routes.md` (coordinator draft, 2026-09-24, revised after critics' review). The draft is notes, not decisions: nothing here is approved until the owner and reviewer sign off. Full detail, sources and worked numbers stay in the draft.

## Summary (one screen)

Gives Nabvy eBay-style filtering/sorting over stored listings and an Airbnb-style map whose markers are **town pills at centroids** — never a listing's real coordinates. Good asks just beyond the user's radius surface in a separate **"Slightly further away"** strip, gated on ≥10 comparable asks. A **private pickup log** plus a **one-day route planner** (in-house exact solver, ≤12 stops, over a self-hosted OSRM) replace typing addresses into a generic app. No scraping, no browser automation, no marketplace cookies anywhere in this design.

New monthly cost: a router VM (~£14–84) and map tiles (free to ~$7 at scale). **No new Apify spend** — nothing here (a map pan, a hint, a route plan) ever starts a collection run. Two new npm dependencies (`maplibre-gl`, `@vis.gl/react-maplibre`, MIT/BSD-3).

The draft proposes **7 new modules** and one extension to an existing module (`location`). It also surfaces a real conflict with the module catalogue (see "What stays open").

## Decisions the draft makes (engineering, not product)

- One shared filter function (`listing-search`) serves the feed, map, hints and dashboard map; hunt alerts keep their own owners (`spec-match`, `alert-router`), reading the same `location.withinKm()` predicate so the two never drift apart.
- Every distance shown to a user is measured from a **place centroid**, never a listing's stored coordinate. Straight-line distance drives filters, sort and the map ring; road distance/time (self-hosted OSRM via `router-gateway`/`travel-time`) drives hints, the "lowest price + trip" sort and the route planner.
- Hint rule: a listing beyond the radius but within `clamp(r/2, 5, 15)` miles, with ≥10 comparables, not suspected (or a confirmed gem), collectable, clean and located, becomes a hint only when its price advantage clears the extra trip's cost by at least `max(£10, 5%)`. At most 3 per search. Ships in **shadow mode** first; goes live only on owner approval.
- Pickups are private end to end: row-level security, no `v_` view over the schema, address/notes/refined point encrypted at rest (needs a new secret, `PICKUPS_DATA_KEY`), routed on a private VM whose access logs and cached times never see a pickup point, served only Nabvy's own map tiles.
- Route optimiser is an **in-house exact DP solver** (optimal at ≤12 stops, ~10 ms), not VROOM — VROOM stays the documented upgrade path if the stop cap ever rises past ~15.
- CI guards (extending the owner's existing rules): no listing coordinate/`locationDetails`/postcode ever leaves an output; no unexplained score or "Best Match"-style ranking; no seller field anywhere; suppression is always applied; a map pan or "search here" never changes the Apify job count.
- **Owner additions recorded in the draft (2026-09-24):** the user's radius has no fixed cap, with an aggregate "Widen to N mi to see M more matching deals" hint, one tap to accept, credit estimate shown first, and Nabvy never widens it itself; and an off-by-default "deal hot spots" heatmap layer, built only from town display points and asking-price position (n≥10), never a listing's coordinate.

## Defaults taken meanwhile (conservative, all reversible by the owner)

25 mile default radius; hints on only after shadow mode; pending listings hidden by default; Town/City place granularity; Northern Ireland listings shown as "Location unknown" rather than geocoded; pickups and their route plans deleted 30 days after the day, visited-listing rows after 90 days, both user-deletable and purged on account deletion; reminders carry a label and time only, never an address; no in-app route sharing; calendar export is download-only, no `webcal` feed; travel cost defaults to the HMRC advisory fuel rate plus the National Living Wage as the value of time; router VM on Hetzner CX43 (EU region, matching Supabase); tiles from Nabvy's own Protomaps extract with OpenFreeMap as the fallback.

## Modules

**New (7):**

| Module | One job |
| --- | --- |
| `listing-search` | The one read model and SQL builder behind the feed, map and hint candidates |
| `travel-cost` | Dated HMRC-style rate tables and each user's trip-cost settings |
| `router-gateway` | The only HTTP client for the private router VM (OSRM table/route/health) |
| `travel-time` | Cached road distance and time per origin cell and place, ferry-aware |
| `deal-hints` | Chooses at most 3 "slightly further away" listings per search |
| `pickup-routes` | The user's private pickup records, reminders and one-day route planning (folds this draft's `pickups` and `route-planner`) |

**Existing, extended:** `location` gains `searchPlaces()`, per-place `uncertainty_km` and the shared `withinKm()` predicate (task 1.2g) — but the draft's assumptions (OS Open Names, PostGIS, per-place display points) go well beyond what the current `location` card describes (postcodes.io, 5 km rounding). `want-manager` gains a saved-filter field that "Save as hunt" writes.

**Existing, read only, no change proposed:** `city-pages`, `listing-card`, `spec-match`, `alert-router`.

## What stays open

All product-facing calls in the draft are recorded as owner questions, never decided here: the hint strip's exact wording ("Slightly further away", "low ask", whether "deal/saving/value" may sit beside an ask), the position-sort label, place granularity for big cities, Northern Ireland coverage, every retention period, reminder content, route sharing, the calendar feed, routing self-host vs. hosted and its region, the tile provider, licence exceptions already in the dependency tree, module naming (catalogue vs. build-pack), and the `docs/dashboards.md` "score-coloured pins" clash with the no-unexplained-score rule. The full list (27 items) and the legal-review lines (16 items) are carried into the coordinator's integration notes, not reproduced here.

Two conflicts the draft does not resolve:

- **`pickup-routes` already exists** in the module catalogue, marked "the route method is open until the search-map-routes draft lands." This draft answered that by splitting the job into two new modules, `pickups` and `route-planner`; coordinator decision (2026-09-24): both fold back into `pickup-routes`, which keeps its name.
- The draft treats a `pickup-location` module (its own working name for it: `listing-location`) as an "existing design, read only." Coordinator decision (2026-09-24): the catalogue module is `pickup-location`; this draft's `uncertainty_km`/`area_landmass` columns are folded into its view, named `app.v_pickup_location`.

No conflict was found against `docs/decisions.md`'s Precedence table: the draft's rules (asking-price position only at n≥10, no unexplained score, town-level location precision, no per-user Facebook access) all follow the brief's positions rather than the older build pack.
