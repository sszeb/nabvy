# Search, map and pickup routes: design

**Date:** 2026-09-24. **Status:** proposal for the owner and the coordinator, revised after the critics' review (hard pickup windows, an in-house route solver, Nabvy-hosted tiles, the catalogue's `location` module, renumbered tasks). Nothing in `/home/user/nabvy` was changed.
**Inputs:** the owner's request of 2026-09-24 (eBay-style filters, an Airbnb-style map, a distance limit with hints just beyond it, and a pickup route planner), the binding decisions in `docs/decisions.md` [R1], and five research reports (filters, map-ux, map-stack, routing-stack, pickups-and-travel-cost).

**Labels used in this document**

- *(estimate: basis)*: a number worked out by the researchers or by me, with its basis.
- *(design choice)*: a value I picked. It can be changed and was not measured.
- *(search summary)*: the researcher could read only a web-search summary of the cited page, because the sandbox blocked the page itself.
- *(computed)*: worked out from Nabvy's recorded run or the owner's listed files. The script is named in the sources.
- Citations: [n] are web sources and [Rn] are repository or scratchpad files. Both lists are at the end.

---

## 1. Summary

The design gives Nabvy eBay-style sorting and filtering over its own stored listings, and an Airbnb-style map whose markers are **town pills placed at town centroids**. Good asks just beyond the user's distance limit appear in a separate **"Slightly further away"** strip (working label). A **private pickup log** records what the user has arranged with sellers, and a **one-day route planner** orders the pickups with an in-house exact solver over road times from a self-hosted OSRM.

The design rests on five findings from the research.

1. **Facebook's radius is not a filter.** In the recorded Chichester run Facebook reported 65 km, yet 14 of 20 listings lay beyond 65 km (up to 109 km) and only 3 lay within 40 km (computed) [R8][R9][R16]. The actor's own tests found the radius "is not a filter" [R7 §2.1]. So Nabvy applies distance itself, on each listing's resolved place ("Where an item really is" [R1]).
2. **The actor's "coarse" coordinates are finer than town level.** They sit on a grid of about 0.61 km by 0.77 km. The row labelled "Chichester" plots 11.6 km south of Facebook's Chichester centre (computed) [R16]. These coordinates therefore never leave Nabvy's internal store. Markers and every distance shown to users use **place centroids** (decisions, "Location precision" [R1]).
3. **A raw "cheapest" sort is junk.** In the fixture, a £25 PC repair-service advert and two headsets top a "gaming pc" search [R7 §5.1]. All sorts and filters run over a clean set: product-matched, noise-filtered, with copy adverts collapsed. Asking-price position appears only at n≥10 [R1].
4. **Out-of-area results are accepted only when they are labelled and kept apart.** Facebook and Airbnb do this. The Department for Education found that unexplained out-of-radius results confused every user who met them [10][23][30]. So hints get their own strip, at most 3 items, each showing its arithmetic, never counted in the main list.
5. **Pickup addresses and times are the user's private data** [R1]. They sit under row-level security with no `v_` view, are geocoded in-house, and are routed on a private server. No third party receives them unless the user taps a navigation link. Basemap tiles for the route view come only from Nabvy's own tile host, so tile requests near a pickup reach no outside service.

### Recommended stack

| Component | Library or service | Licence | Cost |
| --- | --- | --- | --- |
| Map renderer | `maplibre-gl` 6.11.1 [44][45] | BSD-3-Clause | £0 (dependency) |
| React wrapper | `@vis.gl/react-maplibre` 8.1.3 [47][48] | MIT | £0 |
| Clustering of town pills (client) | `supercluster` 9.1.0 [49], or MapLibre's built-in clustering (ISC, inside `maplibre-gl`) | ISC | £0 |
| Basemap tiles | Nabvy's own Protomaps UK extract (PMTiles, zooms 0–14, 1.5 GB [57]) on Cloudflare R2, served as z/x/y by the Protomaps Worker on a Nabvy subdomain [54]. The style is built at deploy time with `@protomaps/basemaps` 5.7.2 [113]; glyphs and sprites are copied from `protomaps/basemaps-assets` into the same bucket, since a full basemap needs a style, a tileset, fontstacks and a spritesheet [112][117] | Code BSD-3-Clause [113][114]; fonts SIL OFL (served data); sprites derived from MIT icons [112]; map data ODbL, attribution required | £0 below 100,000 tile requests a day (about 6,000 map sessions a day at 16 tiles each, computed). Then USD 5 a month (Workers Paid, 10M requests included) plus USD 0.30 per extra million: about USD 6.80 at 1M sessions a month *(estimate: Cloudflare list prices, 16 tiles a session; R2 reads stay within the 10M free Class B operations at the Protomaps calculator's 50% cache hits)* [53][55][56] *(owner decision)* |
| Tile fallback | OpenFreeMap public instance, `positron` style, switched through `MAP_STYLE_URL`, for the listing map only [50][51] | Service; code MIT, data ODbL; no SLA, funded by donations [50] | £0 |
| Spatial queries | PostGIS in Supabase, already installed on `fbapfy` [R1][68] | GPL-2.0-or-later [69]. Part of the database platform the owner chose (`docs/decisions.md`, Platform) and already installed on `fbapfy`; listed in `docs/legal-review.md` | £0 extra |
| Places (town centroids) | OS Open Names, about 44,000 settlements, GB only, refreshed quarterly, loaded by `location` (task 1.2f [R21]) [61][62] | Data: Open Government Licence | £0 |
| Postcode centroids | ONS Postcode Directory GB districts and sectors, loaded by `location` (task 1.2f [R21]); `pointForPostcode()` returns the sector point, so the user's pin refines a pickup. The MIT postcodes.io Docker pair is the alternative [63][64] | Data: OS OpenData / ONSPD. Northern Ireland (BT) postcodes need a commercial LPS licence [63] | £0; storage is sized in `location`'s design (a full 1.7M-postcode table would be about 170 MB, *estimate: 1.7M rows × about 100 bytes, map-stack researcher*) |
| Road distance and time | OSRM 26.9 (car profile, MLD, Great Britain extract) [72][73] | BSD-2-Clause | Runs on the router VM |
| Route optimiser | Written in-house in `route-planner/src/domain`: an exact subset dynamic programme over at most 12 stops (time windows, time at the stop, must-get priority, pinned first or last stop, latest finish, maximum driving time). VROOM 1.15.0 is the upgrade path above about 15 stops (§6.2) | Nabvy code | £0. About 10 ms for 12 stops on Node 22 (computed, `dp_tw_bench.mjs` [R16]) |
| Router VM | Hetzner CX43, 8 vCPU / 16 GB, Germany or Finland: about EUR 15.99 a month *(search summary)* [91]. Or AWS Lightsail London, 16 GB: about USD 84 a month *(estimate: USD 0.1129 an hour × 744 h, AWS Price List API)* [92] | Service | *(owner decision)* |
| Road data | Geofabrik Great Britain extract, about 2.0 GB *(search summary)* [90] | Data: ODbL | £0 |
| Calendar export | Written in-house to RFC 5545 [97] (about 60 lines); `ics` 3.12.0 is the fallback [96] | `ics` is ISC | £0 |
| Hand-off to navigation | Google Maps URLs, Apple Maps unified URLs, Waze deep links [93][94][95] | Public URL schemes | £0 |
| Travel-cost inputs | HMRC advisory fuel rates, HMRC approved mileage rate, National Living Wage [99][100][101] | Public data | £0 |
| Chips, sheets, bottom sheet | shadcn/ui primitives, already in the stack. The map's bottom sheet is built in-house, because shadcn's Drawer is built on `vaul`, which is marked unmaintained [41] | MIT (copied into the repo) | £0 |

**New monthly cost:** the router VM, about EUR 16 on Hetzner or about USD 84 on Lightsail London (bases above), plus tiles: £0 below 100,000 tile requests a day, about USD 6.80 at 1M map sessions a month (basis above). **Extra Apify spend: none.** Nothing in this design starts a collection run: map moves, hints and route plans read only listings already stored (decisions, "Nothing runs unless a user asks" [R1]).

**New npm dependencies:** `maplibre-gl` (BSD-3), `@vis.gl/react-maplibre` (MIT), and optionally `supercluster` (ISC). All 55 packages in their dependency tree are MIT, ISC, BSD-2, BSD-3 or "MIT OR Apache-2.0" (map-stack researcher, installed and walked) [44][47][49]. Turf is not needed: the radius ring is a short spherical-circle helper. (`tslib`, 0BSD, is already in the tree through Next.js's `@swc/helpers`, so licence is not the reason [71]. Whether 0BSD counts as "BSD" goes to `docs/questions.md`, §10 row 26.) Build-time only, for the tile style: `@protomaps/basemaps` 5.7.2 (BSD-3-Clause) [113]; the quarterly tile refresh uses the `pmtiles` command-line tool from go-pmtiles (BSD-3-Clause) on the router VM, not an npm package [114].

### Modules at a glance

| Module | One job | Kind |
| --- | --- | --- |
| `location`, `city-pages`, `listing-location` | Places, postcodes, distances, city pages, and each listing's resolved place | Existing designs; read only. Task 1.2g extends `location` (§7.1) |
| `listing-search` | The search read model and the one filter-and-sort function behind the feed, map and hints | New |
| `travel-cost` | What a trip costs a user: dated rate tables and each user's travel settings | New |
| `router-gateway` | The only code that talks to the router VM (OSRM) | New outside-world adapter |
| `travel-time` | Road time and distance from an origin cell to places, cached | New |
| `deal-hints` | Chooses at most 3 listings just beyond the radius where the ask gap outweighs the extra trip | New |
| `pickups` | The user's own record of arranged pickups, and their reminders | New, private |
| `route-planner` | Plans one day's collection route over the user's pickups | New, private |
| Web features | Deal feed, filter UI, map view, dashboard "Deals near you" map, pickups pages | Read `listing-search` through oRPC procedures |

---

## 2. Deal feed filters and sorting

### 2.1 Rules that hold for every sort and filter

- **One filter function.** `listing-search` holds one SQL builder over its read model. The deal feed, the map, the hints and the dashboard map call it. Hunt alerts stay with `spec-match` and `alert-router`. Both sides apply distance with the same exported predicate, `location.withinKm()` (task 1.2g), so the feed and alerts agree on distance without either depending on the other. The filters researcher recommends the same, and Gumtree and eBay users complain when filters drift or reset [14][2].
- **The clean set by default:**
  - product-matched through the parts record;
  - noise removed (wanted, swap, "I buy" adverts, services);
  - copy adverts collapsed to one card, "also listed in N other towns".

  A muted **"Hidden by Nabvy (n) · show"** link reveals what was removed, so the filtering can be checked.
- **Prices.** Price sorts and ranges consider only `priceKind = fixed` with an amount above 0 [R12]. Free, unknown, ambiguous and £0 prices sit behind a **"No clear price (n)"** chip.
- **Same set, same count.** Every sort orders the same filtered set, and the result count never changes with the sort. eBay's "streamlined" lowest-price sort reportedly cut 30,000+ results to 942, and eBay moderators called a lowest-price problem a glitch [4] *(search summary)*.
- **Stable order.** Each sort has a deterministic key and breaks ties by listing ID.
- **No opaque ranking.** There is no "Best Match" or "Suggested" order. The Precedence row "Labels and scores" forbids unexplained scores [R1].
- **Sold and pending.** Sold listings are always hidden. Pending listings are hidden by default, behind an "Include pending" toggle, in the way Rightmove's "Include Under Offer, Sold STC" works [17].
- **No collection runs.** Nothing in the feed, the filters or the map starts an Apify run.

### 2.2 The sort set

| # | Sort (working label) | Order | Needs from the data | Shown when | eBay equivalent |
| --- | --- | --- | --- | --- | --- |
| 1 | **Newest** (default) | `listedAt` desc, then `fetchedAt` desc, then ID | `listedAt`, exact Unix seconds on every search card [R6] | Always | "Time: newly listed" [2] *(search summary)*; Browse API `newlyListed` [1] |
| 2 | **Nearest** | Straight-line distance from the origin to the listing's place centroid, ascending; then Newest. Listings without a resolved place go last, under "Location unknown" | Resolved place (`listing-location`), display point (`location.v_display_places`), the origin | `location` and `listing-location` are on | "Distance: nearest first", which is reported missing from eBay's app [3] *(search summary)*. Nabvy offers it on phones too |
| 3 | **Lowest price** | `amountMinor` ascending; fixed prices above 0 only | `money` [R6] | Always | "Price + postage: lowest first" [1]. Facebook asks carry no postage (`shippingOffered` false on 20 of 20 recorded rows) [R16] |
| 4 | **Highest price** | `amountMinor` descending | `money` | Always | "Price + postage: highest first" |
| 5 | **Most below similar asks** (working label, §10 row 10; earlier "Lowest vs similar asks", too easily confused with "Lowest price") | Asking-price position percentile ascending, only where the same-spec, same-condition group has n≥10. Other rows follow in Newest order under "No comparison yet (fewer than 10 similar asks)" | `asking-price-position`'s `app.v_asking_price_position` | At least one row in the result has n≥10; otherwise disabled, with the reason given on tap | None. Autotrader's price labels are the nearest UK precedent [16], but Nabvy never calls an ask "worth" or "fair" or a sale price [R1] |
| 6 | **Lowest price + trip** | Ask plus the round-trip cost at the user's travel settings (§4). Road distance is used when `travel-time` is on; otherwise straight line × 1.3, labelled an estimate | `travel-cost`, `location`, optionally `travel-time` | `travel-cost` is on | eBay's "Price + postage" [1] and Autotrader's total price [16]: the honest analogue for collection-only listings |

Left out on purpose:

- Best Match and Suggested, which are opaque;
- Ending soonest, because there are no auctions;
- Farthest first, which has little value;
- Oldest first, a later option for negotiators, as Facebook and Rightmove offer [9][17].

On the map the sort never moves markers; it only orders the list beside the map.

### 2.3 The filter set, and what each needs

| Filter | Values (default) | Reads | Available from | When the source module is off |
| --- | --- | --- | --- | --- |
| **Distance** | 5, 10, 15, **25** (default), 40 or 60 miles, plus "Any distance". Stored as km: 8, 16, 24, **40**, 64, 97. The 40 km default is `docs/modules.md`'s hunt default [R3] and matches eBay's 25-mile default [2] *(search summary)*. The coverage note (§2.9) sits under "Any distance" in the sheet | The listing's place centroid against the origin, in PostGIS (`ST_DWithin` on geography [66]) | The search card: every row carries a Facebook city page [R7 §3] | The chip is hidden, and the feed carries a "distance unavailable" note |
| **Origin** | The hunt's postcode point (default), the user's home postcode, a typed postcode or town, or "Use my location". Chosen inside the distance chip's sheet (§2.5) | `location.pointForPostcode`, `location.searchPlaces`. "Home" is the home saved in `route-planner`'s `planner_defaults` (§7.9), read through its exported `homePoint(userId)` inside `withUser` and offered only when set; the filter stores only `{ kind: 'home' }`, never the point. "Use my location" is rounded to a 0.01° grid (about 1.1 km by 0.7 km at 51°N, computed) in the browser, never stored, and shown in the URL as `here` | n/a | Only the hunt point is offered |
| **Slightly further away** | On (default) or off | `deal-hints` (§4) | Needs details and n≥10 | The strip is hidden |
| **Price** | Minimum and maximum in £. A histogram, as in eBay's 2025 redesign, is optional [6] | `money`, fixed prices above 0 | Search card | n/a |
| **Condition** | New, Like new, Good, Fair, Not stated (all selected). Mapped from Facebook's "New", "Used – like new", "Used – good" and "Used – fair" [R7 §3] | `condition` | **Details only** (19 of 20 recorded rows) [R7]. Rows without details count as "Not stated", because silence is never a "no" [R1] | n/a |
| **Handover** | Collection (`IN_PERSON`, `DOOR_PICKUP`), Meet-up (`PUBLIC_MEETUP`), Seller drop-off (`DOOR_DROPOFF`), Posted (`shippingOffered`) (all) | `deliveryTypes` (card) and `shippingOffered` (details) [R6]. A derived `handover[]` column; the shared `DeliveryMethod` enum is left unchanged [R12] | Card, plus details for "Posted" | n/a |
| **Listed within** | Last hour, 24 hours, 3 days, 7 days, 30 days, Any (Any) | `listedAt` | Card | n/a |
| **Price dropped** | A chip | The price-drop watch view, within one listing ID only; `displayedPreviousPrice` is never used [R1][R7] | Registry history | The chip is hidden |
| **Product match** | "In title" or "Also in description"; listing kind Whole item, Part or Bundle | The parts record view | Details | The feed falls back to a title match, with the note "matching titles only" |
| **Include pending** | Off | `availability.pending` [R6] | Card | n/a |
| **Hidden by Nabvy** | Hidden, with a reveal link | Noise-filter and copy-advert views | Details | Nothing is hidden; the link is absent |
| **No clear price** | Hidden, with a chip showing its count | `priceKind` | Card | n/a |
| **Location precision** | Every place is an area, so ordinary cards need no extra mark ("Chichester area · 13 mi"). A listing whose approximate flag is set reads "Near Chichester · town approximate". Included by default; a "Hide listings whose town is approximate" toggle; "Location unknown (n)" appears as a chip | `app.v_listing_location` (`is_approximate`, `status`) | Card; improved by details | Every place counts as approximate |
| **Suspected too good to be true** | Always shown with its label. A "Hide suspected listings" toggle, default off, appears only once the label leaves shadow mode | The too-good-to-be-true view | Details and reports | n/a |
| **Hunt** | One chip per active hunt (all) | `want-manager` | n/a | n/a |

Not offered:

- a "with photos" filter, because photos are off behind a flag [R1];
- any seller filter, because seller identity is never shown [R1];
- a deal-score filter, because no unexplained score is shown [R1].

**Columns the read model needs.** Each row in `listing_search.search_rows` holds:

- listing ID and source;
- place ID, precision and uncertainty in km;
- `amountMinor`, currency and price kind;
- condition, `handover[]` and `listedAt`;
- pending;
- product keys, match location and listing kind;
- noise flag and copy-advert cluster ID;
- asking-price position percentile, its n, and the group median;
- price-dropped-at;
- too-good-to-be-true flag;
- collectable;
- `t1_fetched_at` (the T1 of the input it processed) and `indexed_at` (§7).

No title or other card text is stored here: the redacted title, town label and asking price are joined at read time from `app.v_listing_card` (§7.3). Nothing here is finer than the place. The storage plan in `docs/decisions.md` already gives price, listed time, town, coordinates, availability and category real columns [R1]. Handover, condition and the resolved place are added.

### 2.4 How distances are shown

- **Miles, rounded to whole miles**, with a floor of "under 2 mi". UK users think in miles; storage stays in km (`Hunt.radiusKm` [R11]).
- **Measured from the place centroid**, so the distance shown matches the marker. It can never locate a seller more precisely than the town. Exact distances make trilateration possible, and snapping positions to a grid is the known defence [31].
- **Labelled by kind.** In the preview and on the deal page, a straight-line distance reads "about 13 miles (straight line)". When `travel-time` is on, a road figure follows: "about 17 road miles, 28 min". A straight-line distance is never presented as a driving distance.
- **Place labels.** All cards read "Chichester area · 13 mi": every place is an area, so it needs no extra mark. A listing whose approximate flag is set reads "Near Chichester · town approximate". No "~" is used anywhere. Pill accessible names keep "approximate area" (§3.5).
- **Phone card, three lines:**
  1. the title, at most two lines;
  2. "Asking £400", plus "▼ low ask" at n≥10;
  3. "Portsmouth area · 13 mi · 2 h ago", or "· 28 min drive" when road data exists.

  The list header states the basis once: "Distances in a straight line from PO19". The full sentences ("lower than 11 of 14 similar asks (same spec and condition)", "also listed in 11 other towns", "about 17 road miles") appear in the preview and on the deal page.

### 2.5 Mobile interaction, modelled on eBay

From top to bottom:

1. **The search box** (the hunt).
2. **A chip row:** `[Filters · n] [25 mi of PO19 ▾] [Newest ▾] [Price ▾] [Condition ▾] [Handover ▾] [Listed ▾]`. "Filters · n" is pinned at the left and does not scroll; the other chips scroll. At the end of the row it would start about 596 px from the left, past the edge of a 375–390 px phone *(estimate: 14 px system font at about 7.3 px per character, 12 px chip padding each side, 16 px chevron, 8 px gaps, 16 px row inset)*. On phones only two or three filters fit per line, so they scroll [12] *(search summary)*. The distance chip names the origin and opens one sheet: distance options first, then "From: PO19 (hunt) · Home · My location · Type a postcode or town".

The floating "Map"/"List" pill (§3.1) is the only switch between list and map; the list is the default.

Behaviour:

- **The sort chip** shows the current sort. It opens a single-select bottom sheet that applies on tap.
- **Single-value chips** (Distance, Listed, Price dropped) apply on tap. eBay's Playbook calls filter-on-tap chips "the default and preferred version" [8] *(search summary)*.
- **"Filters · n"** opens a full-height sheet with batch apply. The apply button carries a live count ("Show 23 items"), and every option shows its own count, so the user never reaches a dead end. NN/g recommends batch apply for users with criteria in mind, and per-value counts to avoid zero results [13] *(search summary)*.
- **Applied filters.** On phones, a set filter shows inside its own chip as a filled chip ("Good, Like new ×"), and a "Clear all" chip appears at the end of the row. The separate applied-filters row is desktop only. Baymard finds 28% of sites lack such an overview [12] *(search summary)*.
- **Nearest on phones.** Nabvy keeps it. eBay's app reportedly lost "Nearest first" [3] *(search summary)*, and Facebook offers no sort or filter on mobile web [9] *(search summary)*.

### 2.6 Desktop interaction

The same chip row sits above the results. "Filters · n" opens a right-hand panel instead of a sheet, because the app shell already has a left navigation sidebar [R1]. The sort control sits at the right of the results count, as on eBay and Rightmove [1][17] *(search summary)*. With the map shown, the chip row spans both panes and drives both.

### 2.7 State, URL and memory

- **The URL holds the current state**, for example `?sort=nearest&r=40&price=100-600&cond=good,like_new&hand=collection&within=7d&origin=hunt:<id>`. Links can be shared and the Back button works. A shared link never carries coordinates: "Use my location" appears only as `origin=here`.
- **The server remembers the last-used filter per user** (`listing_search.feed_state`). eBay filters reset when the query changes, and Gumtree's app forgets postcode and distance [5][14] *(search summary)*; Nabvy avoids both.
- **The view is remembered too.** `feed_state` and the URL also keep the view (`view=map`), so a map-first user returns to the map.
- **"Use my location" is never stored.** Before `search.saveState` or `hunts.saveFromFilter` stores a filter, an origin of kind `here` is replaced by `{ kind: 'place', placeId }` for the nearest display place. Coordinates from `here` are never written to any table or log.

### 2.8 Saved filters on hunts

- **"Save as hunt"** is Nabvy's version of eBay's "Save this search" [7] *(search summary)*. It sits at the foot of the filters sheet, where Vinted places its save button [15] *(search summary)*. It stores the whole `FeedFilter` on the hunt: a new `filter` field on `Hunt` [R11], typed by `listing-search`'s contract.
- **Hunts are changed only explicitly.** "Save as hunt" creates a new hunt, or updates one the user names. It never happens implicitly, because Gumtree users complain that tweaking parameters overwrites saved searches [14].
- **Alerts follow the saved filter.** `spec-match` matches a hunt's alerts on the saved filter's distance, price, condition and handover fields. What alerts are sent depends on the saved filter; what is collected stays per centre and term, never per user (Precedence row "Per-user work" [R1]).
- **A "+n new" badge** on each hunt in the sidebar counts listings since the last view (`hunt_views`), after Vinted [15].
- **Hints never alert by default.** A per-hunt toggle, "Also alert me to listings slightly further away", is off by default (conservative).
- **The hunt cap** follows the existing plan limits, for example 3 active hunts on Free [R1].

### 2.9 Empty results and coverage

Nabvy holds listings only around centres that some hunt needs [R1]. Facebook's newest-first feed reaches about 115 km from a centre [R7 §5.1]. A wide radius can therefore look empty because nothing is collected there, not because nothing is for sale. "Any distance" and empty map areas carry a note:

> Nabvy collects listings only around areas people hunt. Add a hunt here to start.

Creating the hunt is the explicit request that starts collection.

---

## 3. Map view

### 3.1 Layout

**Desktop, from 1024 px wide** *(design choice)*:

- a split view: the list on the left, about 55–60% of the width, with **one card column from 1024 to 1439 px and two columns from 1440 px**;
- while the map is shown below 1440 px, the app's left sidebar collapses to its icon rail (`collapsible="icon"`, 3rem). With the full 16rem sidebar, 1024 px would leave cards of about 203–222 px and a map of about 307–346 px *(estimate: shadcn's sidebar widths [111], ignoring page padding)*;
- a sticky map on the right that never scrolls away, as on Airbnb [20];
- a "Hide map" toggle in the results header;
- a count line above the list that doubles as a polite live region: "14 listings within 25 miles of PO19 · sorted by nearest" [36].

**Mobile (the PWA)** opens on the **list** by default (or on the view the user last chose, §2.7), with a floating "Map" pill at the bottom centre ("List" in map mode). This pill is the only list/map switch. The Department for Education found that opening on a map made users expect a list and miss the filters, so it went back to a list first [24].

Map mode is a full-screen map with a **non-modal bottom sheet** at three heights, after Material 3's standard sheet and Apple's sheet guidance [28][29]:

- **peek**: the count only; the sort is the chip above;
- **half**: cards for the view, or for the selected town;
- **full**: the list.

The grabber is a real button labelled "Resize results". Each press cycles the heights, and the arrow keys step through them. The sheet is built in-house; it does not use the shadcn Drawer, which is built on `vaul` (unmaintained [41]) and is modal.

**Tablet, 768–1023 px:** the mobile pattern, with the sheet as a side panel *(design choice)*.

### 3.2 Markers

**The unit is the town, not the listing.** Every listing in a town shares one place point, so no zoom level can split them. Nabvy's marker is therefore a **town pill**, like Zoopla's number pin for several properties at one address [25], rather than one Airbnb price pill per listing.

| Marker | Shows | Notes |
| --- | --- | --- |
| **Town pill, one listing** | "£400", the asking price, the same figure the card labels "Asking £400" | Pin and list show the same price, as on Airbnb [19] |
| **Town pill, several listings** | "3 · from £400" | The price is the cheapest fixed ask in that town under the current filter |
| **Asking-price position badge** | A small ▼ glyph with the text "low ask" (working wording), shown only when a listing in the pill has asking-price position at n≥10 in the lowest quarter of its same-spec, same-condition group *(design choice)*. On a pill with several listings, the badge reads "3 · from £400 · 1 low ask", and the qualifying card carries its own "▼ low ask". The badge is never placed next to the "from" price unless that listing is the one that qualifies | Never colour alone [32]; never "worth" or "fair" [R1]. The preview and deal page carry the full sentence, for example "Asking £400 · lower than 11 of 14 similar asks (same spec and condition)" |
| **Mini-pin** | An unpriced dot for towns beyond the 30 highest-ranked on screen under the current sort *(design choice)* | Airbnb's mini-pins are clicked about 8 times less often than full pins, and limiting full pins raised bookings [18] |
| **Cluster** | A count only, for example "12". Tapping zooms to the level where it splits | Its accessible name reads "12 listings in 4 towns, zoom in" |
| **Hint pill** | A dashed outline plus a "+8 mi" chip, outside the radius ring | §4.4. Towns outside the ring get only hint pills, never normal pills (§3.4) |
| **Radius ring** | The chosen distance as a circle around the origin; users understood radius circles well [23] | Drawn by a small in-house spherical-circle helper, not Turf |
| **Hunt areas** | Hunt outlines appear on the dashboard map. On the feed map they appear only for hunts whose centre or radius differs from the current origin and distance, so the default view never draws two identical rings | Only the user's own hunts; other users' coverage is never drawn |

**Marker states:**

| State | Look |
| --- | --- |
| Default | White pill, dark text |
| Hover or focus on a linked card | Dark fill, raised |
| Selected | Dark fill plus heavier weight, and a soft approximate-area circle |
| Visited | Muted text, as Airbnb greys viewed pins [19] |

States never rely on colour alone, and pill edges keep 3:1 contrast [35].

**Copy adverts** appear once, at the town nearest the origin, with "also listed in 11 other towns" on the card. Otherwise one advert would put a pin in every town.

### 3.3 Linking cards and markers

Hover and keyboard focus behave identically; Map UI Patterns calls this "data brushing" [26].

- **Card hovered or focused:** its town pill is highlighted and raised. Several cards share one pill, so the pill shows "1 of 3".
- **Pill hovered or focused:** that town's cards on screen are outlined.
- **Pill clicked:** the town is selected.
  - On desktop, the list filters to that town and scrolls to it, with a "Chichester area ×" chip.
  - On phones, tapping a pill keeps the sheet at peek and shows a one-card-high carousel above it. Each card is about 112 px: the title, "Asking £400", and "Portsmouth area · 13 mi · 2 h ago". Swipe to move through that town's listings, then on to the next town in the current sort; the matching pill highlights as each card comes into view. Tapping a card opens the listing, tapping empty map closes the carousel, and dragging the sheet up gives the full list. For keyboard users, the carousel's previous and next buttons follow the same order. A half sheet would cover about 50% of a 667 px-tall viewport, against about 19% for the carousel *(estimate: 112 px card plus 16 px margin)*; the swipeable bottom-card pattern with markers kept in sync is shown in react-native-maps' AnimatedViews example [110].
  - Escape clears the selection and returns focus to the pill.
- **The desktop preview** over the map shows:
  - the title;
  - "Asking £400";
  - "Chichester area · about 13 miles in a straight line";
  - how long ago it was listed;
  - any labels;
  - save, hide and report;
  - "Open on Facebook".

  It shows the neutral photo placeholder while the `listing-photos` flag is off [R1], and never any seller identity.
- **Same actions in list and map.** The list and map offer the same actions, as Rightmove does [R-map-ux].
- **Visited state** is stored per user on the server (`listing_visits`).

### 3.4 Search as the map moves

- **The distance stays the search area.** While a distance is set, the distance stays the search area. Panning and zooming change only which of those results are in view: the desktop list header reads "8 of 14 within 25 mi of PO19 · in this view", and the mobile peek shows the same. Towns outside the ring get no normal pills, only hint pills. This keeps the owner's rule that users see only items within the distance they choose [R1].
- **"Search here".** When the map centre leaves the ring, a "Search here" button appears. It moves the origin to the place nearest the map centre (`FeedOrigin` kind `place`; the chip reads "25 mi of Petersfield ▾") and keeps the distance.
- **Map area only with "Any distance".** The viewport becomes the search area ("Map area ×", the filter's `area` becomes the viewport's bounding box, as in Airbnb [18]) only when the distance chip is "Any distance". In that mode the ring and hint pills are hidden. Distances on the cards are still measured from the origin.
- **Desktop:** an "Update the list as I move the map" checkbox, on by default. It never removes the distance limit: with a distance set it updates the "in this view" list; with "Any distance" it re-runs the search for the viewport. When it is off, a "Search this area" button appears after a move. This is Airbnb's web pattern, with Map UI Patterns' combined control [20][21].
- **Mobile:** the "in this view" count updates as the map moves; with "Any distance", a "Search this area" button appears after a pan or zoom and nothing refreshes automatically, following Airbnb's app ("Redo search in this area") [109].
- **Binding rules:**
  - A map move only queries listings already stored, through `listing-search`, with a short debounce of about 300 ms *(design choice)*.
  - A map move **never** queues an Apify run [R1]. A CI test asserts that the gateway job count is unchanged (§9).
  - Areas with no results show "No listings here yet" with "Add a hunt here".
- **The URL keeps the map state** (bounds and selected town), so Back and shared links restore the view.

### 3.5 Approximate location rules, enforced by CI

- A marker sits at its place's display point from `location.v_display_places`. It is never placed at the listing's coordinates, and never at jittered real coordinates [R1]. Airbnb likewise shows only a general area, within about half a mile, before booking [22].
- The map payload carries place ID, name, display point, count, cheapest ask, low-ask count, hint flag and visited flag. It carries **no listing coordinates, no `locationDetails`, and no postcode or street found in a description** [R1].
- Every pill's accessible name and preview says the location is approximate: "Chichester area" and "Approximate area · the seller gives the exact pickup place". Department for Education users assumed a pin was the exact place they would go [23].

### 3.6 Accessibility, with the list as the full alternative

The UK government design system has no map component, partly because of unresolved accessibility problems [42][43]. The list is therefore the accessible equivalent of the map: every action on the map can also be done from the list. Acceptance checklist, from the map-ux research:

1. **Skip and label the map.** A "Skip map" link comes before the map. The map element has a name, for example "Map of 14 listings in 6 towns, approximate locations" [32][43].
2. **Real buttons.** Pills and clusters are HTML buttons (DOM markers), not canvas-only symbols, each with a full accessible name. For example: "Portsmouth area, 3 listings, lowest asking price £400, about 13 miles in a straight line, approximate location". Tab reaches the first marker, the arrow keys cycle through the rest, and Enter selects, following Google's accessible-marker model [27].
3. **Pan and zoom without dragging.** On phones, show zoom + and − and a "Move map" button that reveals the four pan arrows (still a single-pointer alternative for WCAG 2.5.7). On desktop, the arrows are always shown. MapLibre's keyboard handler adds arrow-key panning and Shift with = or − to zoom [33][39].
4. **Target size.** At least 24 × 24 CSS pixels (WCAG 2.5.8), with 44 px height suggested on touch screens [34].
5. **Contrast and colour.** 3:1 contrast for pill edges and states (1.4.11), and no state carried by colour alone (1.4.1) [35][32].
6. **Announced counts.** A polite live region announces result counts after a filter change or a map search (4.1.3) [36].
7. **Previews.** They close with Escape, stay open while the pointer is over them, and return focus to their pill (1.4.13) [38].
8. **Focus never hidden.** The sheet and sticky controls never fully cover the focused card; use scroll padding (2.4.11) [37].
9. **Reduced motion.** Never pass `essential: true` to camera animations, so MapLibre honours reduced motion [40].
10. **No WebGL2.** MapLibre v6 requires WebGL2 [45]. Without it, the list shows with a notice.
11. **Automated checks.** axe on the list and map pages, plus a keyboard-only Playwright test: choose a town, open a preview, close it.

### 3.7 Performance

| Item | Plan | Basis |
| --- | --- | --- |
| **Server work** | Spatial filtering runs on the `places` table (tens of thousands of rows); listings join by `place_id` through a btree index, so spatial cost does not grow with the number of listings | Map-stack researcher; GiST index and `&&` bounding-box queries per Supabase's PostGIS guide [68]; `ST_DWithin` uses indexes [66]; `<->` gives indexed nearest-first [67] |
| **Map payload** | One feature per town in the viewport. If more than **300 towns** match, the server groups towns by a zoom-sized grid and returns one cluster feature per group, placed at the display point of the group's town with the most listings, so every coordinate sent is a display point (guard 1) | 300 is a *design choice*. About 150 bytes of JSON per feature *(estimate)*, so about 45 KB raw at 300 features |
| **Markers on screen** | Client clustering (supercluster, radius 50 px, up to about zoom 11 *(design choice)*). The radius grows until at most **150 DOM markers** are on screen *(design choice)* | Keeps DOM markers, which need buttons for accessibility, within a small budget |
| **Bundle** | The map loads only when the user opens it (`next/dynamic`, `ssr:false`), so the list view ships without it | MapLibre 6.11.1 main thread is about 295 KB gzip; the first open may transfer up to about 450 KB, because the worker's shared chunk is copied to `public/` (measured from the npm tarball by the map-stack researcher; inference for Next.js) [44][46] |
| **Next.js worker** | A prebuild/predev script copies `maplibre-gl-worker.mjs` and `maplibre-gl-shared.mjs` into `public/maplibre/`, then calls `setWorkerUrl`. CSP: `worker-src 'self'`, with the tile host in `connect-src` | MapLibre's install docs: under Turbopack the map otherwise mounts but never requests a tile [46] |
| **Targets** | Lighthouse above 90 on the deal feed, as `docs/web-app.md` requires [R2]; feed and map procedures under 300 ms at p95 with 200k search rows | *Design targets*, to be measured in 4.1e and 4.1f |
| **Caching** | The service worker (Serwist) caches the MapLibre chunks, and caches tiles only as they are viewed: no prefetching and no offline areas | Keeps R2 and Worker requests down; on the fallback, OpenFreeMap's terms bar automated collection without permission [51] |

### 3.8 Tiles and attribution

- **Style URL from config.** The style URL comes from `@nabvy/config` (`MAP_STYLE_URL`), so a provider switch needs no code change.
- **Default:** Nabvy's Protomaps extract: 1.5 GB for zooms 0–14, measured with `pmtiles extract --dry-run` by the map-stack researcher [57], on Cloudflare R2 and served as z/x/y by the Protomaps Worker on a Nabvy subdomain (the Worker's cache needs a zone on Nabvy's own domain [54]; Cloudflare is already planned for DNS and Turnstile [R19][R17]). The style is built at deploy time with `@protomaps/basemaps` [113], and glyphs and sprites from `protomaps/basemaps-assets` sit in the same bucket [112][117].
- **Refresh:** each quarter, a job on the router VM runs `pmtiles extract` (go-pmtiles, BSD-3 [114]) on the Protomaps daily planet build with a Great Britain bounding box, uploads the result under a new name, and switches the style's source after a smoke test.
- **Fallback:** OpenFreeMap `positron` (POIs removed, a clean base) [50]. OpenFreeMap is free, with "no limits on the number of map views", no keys and no cookies; it is provided as-is, funded by donations, may be discontinued without notice, and several users reported 403 errors on 2026-05-23 [50][51][52]. The private route layer is never drawn on fallback tiles; the route view then shows the stop list and navigation links only.
- **Failure.** If the map fails to load, the list and filters keep working.
- **Not the OSM servers.** The OpenStreetMap tile servers are unsuitable for a commercial app under their own policy [58].
- **Attribution.** "© OpenStreetMap" and the tile source (Protomaps, or OpenFreeMap on the fallback) stay visible in MapLibre's attribution control, compact on mobile [50].

### 3.9 The dashboard "Deals near you" block

Task 4.1b's map [R10] reuses this component: the last 24 hours' alerts as town pills, with the user's hunt radius rings. `docs/dashboards.md` plans "score-coloured pins" [R4]. That clashes with three rules:

- asking-price position only at n≥10;
- no unexplained score;
- no colour alone.

This design uses neutral pills, with the text-and-icon badge only at n≥10. The conflict goes to `docs/questions.md` (§10), and the conservative option is taken meanwhile.

**Keeping the dashboard fast.** On the dashboard the block first renders as a list of town pills (name, count, lowest ask) with a "Show map" button. MapLibre loads through `next/dynamic` only on that tap, or when the block scrolls into view after the page is idle (`IntersectionObserver` plus `requestIdleCallback`). This keeps it out of the first load that Lighthouse measures for 4.1b ("Lighthouse performance above 90 on mobile" [R10]). MapLibre 6.11.1's `maplibre-gl.mjs` is 148,891 bytes gzip and `maplibre-gl-shared.mjs` 146,553 bytes gzip (measured from the npm tarball [44]); that loading it on first paint would push the score below 90 is an inference, not a measurement.

---

## 4. Distance and "slightly further away" hints

### 4.1 Straight-line and road distance

| Use | Distance | Why |
| --- | --- | --- |
| Distance filter, Nearest sort, map ring, "within 25 mi" | **Straight line**, origin to place centroid, PostGIS geography | Cheap, predictable, the same as the hunt radius, and needs no router [66] |
| Road label on cards (optional), hints, "Lowest price + trip", route planner | **Road** distance and time from OSRM, cached per origin cell and place by `travel-time` | Straight line understates trips, and water is a real case: Ryde on the Isle of Wight is 29.6 km from Chichester in a straight line but needs a ferry (computed by the filters researcher) |
| Fallback when `travel-time` is off | Straight line × **1.3**, labelled "estimate" | Road distance averages about 1.4 times straight line in England, falling to about 1.2 above 45 km (Ballou 2002; Cole 1968; Levinson and El-Geneidy 2009, as summarised in [102]) |

**Ferries.** OSRM's car profile routes over ferries, and a request can exclude them [74][76]. A place is marked **"needs a ferry"** when `crossing` is set (the listing's landmass from `app.v_listing_location` differs from `location.landmassFor(origin)`), or when OSRM's route to it uses a ferry leg, which `travel-time` detects on routed legs. That place is never hinted, and its card says "ferry crossing", because fares and timetables are not modelled.

**Traffic.** OSRM gives free-flow times. `travel-time` applies OSRM's `scale_factor` [74] at **1.2** *(design choice, to be calibrated on the Chichester test against the tester's real drive times)*.

### 4.2 The hint rule

For a signed-in user with origin **H**, radius **r** (miles) and travel settings, a listing becomes a **candidate** only if **all** of these hold.

**Gates**

1. **Band.** Its place centroid is beyond r and within r + B, where **B = clamp(r ÷ 2, 5, 15) miles** *(design choice. The researchers proposed +50% capped at +15 miles; half the radius with a floor of 10 and a cap of 25; and +25%. I take half the radius with the lower cap of 15 miles, since the owner asked for "slightly further", and a 5-mile floor so small radii still get a band)*. At r = 25 the band runs to 37.5 miles; at r = 5, to 10; at r = 60, to 75.
2. **Comparables.** Asking-price position exists at **n≥10** for the same spec and condition [R1].
3. **Not suspected.**
   - No "Suspected too good to be true" label [R1].
   - While that module is in shadow mode, the ask is at least **60%** of the group median *(assumption, pickups researcher)*.
   - A listing below that line is a gem candidate [R1]. It can be hinted only after the gem checks confirm it (the `gem-finder` verdict in `listing-reuse.md` [R22]) and while it carries no "Suspected too good to be true" mark. Until then it is not hinted.
4. **Collectable.** `handover` includes Collection or Meet-up.
5. **Clean.** Product-matched, not noise, and one per copy-advert cluster.
6. **Located.** The location status is not `unknown`, the approximate flag is not set (as `listing-location`'s consumer rules require [R21]), and no ferry is needed.
7. **Already held.** It is in the stored pool. Hints never start a run [R1].

**Arithmetic**

| Symbol | Meaning | Default (the user can change every one) | Basis |
| --- | --- | --- | --- |
| P_ref | Median ask of the comparable group (n≥10) | n/a | `asking-price-position` |
| p | This listing's ask | n/a | `money` |
| G = P_ref − p | How far the ask is below the median of similar asks | n/a | n/a |
| d | Straight-line miles from H to the place centroid | n/a | `location` |
| u | The place's uncertainty in miles: half the diagonal of the OS Open Names bounding rectangle, with a floor of 1 mile | n/a | *Design choice*; OS Open Names carries a bounding rectangle per entry [62] |
| c | Road miles per straight-line mile | **1.3** | [102] |
| x_road | Extra one-way road miles beyond the limit: max(0, R_road − c·r) when routed, otherwise c·max(0, d + u − r) | n/a | Adding u makes the trip look longer, so fewer hints are shown (conservative) |
| v | Average speed when not routed | **35 mph** | *Assumption* (pickups researcher), to be calibrated against OSRM |
| k | Pence per mile | **HMRC advisory fuel rate for a 1,401–2,000cc petrol car: 14p a mile from 1 March 2026**, held as a dated configuration row. Presets: "HMRC business rate" (55p, from 6 April 2026) and "Custom" (pence a mile, or mpg and fuel) | [100][99]. GOV.UK's index shows the advisory-rates page updated on 2026-08-21, so newer rates exist; they were not read. Check before launch |
| w | Value of time | **£12.71 an hour** (the National Living Wage from April 2026); the user can set £0, "don't count my time" | [101] |
| K | Extra trip cost: 2·x_road·k + T·w, where T is the extra round-trip time (OSRM duration, or 2·x_road ÷ v) | n/a | n/a |
| M | Margin needed: max(£10, 5% of P_ref) | **£10 or 5%** | *Assumption*, calibrated in shadow mode |

**A candidate becomes a hint when G − K ≥ M.** Hints are ranked by G − K, and **at most 3 per search** are shown *(design choice)*. `hints.forFeed` runs once per filter; later pages never add hints.

**Worked numbers at the defaults** (computed, `hint_defaults.py` [R16]):

- **Per extra straight-line mile:** 2.6 road miles there and back, 4.5 minutes, 36p of fuel, **£1.31 in total**.
- **5 extra miles:** 13 road miles and 22 minutes, £6.54 (fuel only £1.82; HMRC rate plus time £11.87).
- **10 extra miles:** 26 road miles and 45 minutes, £13.08.

**Worked fixture example** (r = 25 miles; Basingstoke's seed point is 32.5 miles from the Chichester centre, computed [R15][R16]; u = 2 miles *(assumption)*). x = 9.5 miles, so there and back is 24.7 road miles and 42 minutes, and K = **£12.43**.

| Case | Group median (**synthetic, not market data**) | Result |
| --- | --- | --- |
| Basingstoke, asking £750 | £850 | G = £100 and M = £42.50. G − K = £87.57, so the listing **is hinted** |
| Basingstoke, asking £750 | £700 | The ask is above the median, so **no hint**. The hint would need an ask of £652 or less |
| Woking, asking £300 | £700 | The ask is 43% of the median, so gate 3 fails until the gem checks confirm it; **no hint** meanwhile |

### 4.3 Defaults the user can change

The settings live in **Settings → Travel**, and each hint card links to them:

- the distance limit r and the hint band B (or hints off);
- the cost preset (fuel only, HMRC business rate, or custom);
- fuel type and engine band;
- the value of time (including £0);
- the margin M;
- under "Advanced": c and v.

`travel-cost` holds the dated rate rows and reminds the coordinator to review them each quarter, on 1 March, 1 June, 1 September and 1 December, when HMRC's advisory fuel rates change [100].

### 4.4 How hints appear

- **List view:** a separate horizontal strip, headed **"Slightly further away"** (working label, §10), after the 6th card of the in-radius list, or after the last card when there are fewer than 6. It is never counted in the list and never reordered by the sort. When the in-radius list is empty, the strip sits at the top under "Nothing within 25 mi yet". Facebook's separate "outside your search" section and Airbnb's near-miss carousels are the precedent; Autotrader's promoted adverts inside a 25-mile search show the harm of mixing [10][30][11].
- **Each hint card states its reason in three lines** (wording for owner decision 9):
  1. "Asking £100 below the median of 12 similar asks";
  2. "+8 mi beyond your 25 mi · trip about £12 extra";
  3. the link "How this is worked out". It opens the full arithmetic: 25 extra road miles and 42 min there and back, same spec and condition, and the rates.

  "+N mi" is the card's own rounded distance minus the limit (Basingstoke: 33 − 25 = 8). The uncertainty u affects only the cost K. Until the user saves travel settings, the cost reads "at 14p a mile and £12.71 an hour · change". "Estimates, not advice" appears once under the strip.
- **Map:** hint pills sit **outside** the radius ring, with a dashed edge and a "+8 mi" chip, in text and not only colour. Their accessible name begins "Slightly further away:". The map's first view fits the ring plus any hint pills, with 40 px padding, so hints are visible without panning.
- **Switching off:** hints can be turned off in the filters sheet and in Settings.

### 4.5 Asking-price rules still apply

- No hint, badge or sort position without n≥10 [R1].
- The wording is always about asks: "asking £100 below the median of 12 similar asks". It never says "worth" or "fair", and never presents an ask as a sale price [R1]. Whether "deal", "saving" or "value" may appear beside an ask is the owner's wording decision (§10 row 9).
- "Estimates, not advice" appears once under the hint strip, and beside the trip cost elsewhere [R2].

### 4.6 Shadow mode, then live

`deal-hints` first runs in **shadow mode** (its `switches` state) on the rtx3090 test hunt:

- it logs candidates with G, K and M through `product-events`' `track()`, and shows nothing;
- the owner then approves going live;
- M, c, v and the traffic factor are tuned against click-throughs, `listing-feedback` verdicts, and OSRM road distances.

This follows the owner's own shadow-first approach for labels [R1].

### 4.7 Later: hints near a planned pickup day

When the user has a planned pickup day, the cost that matters is the **detour from that route**, not a round trip from home. The wording would read "About 6 miles off Saturday's pickup route". `deal-hints` would call `route-planner`'s exported detour function inside the same user's context, and no pickup address would ever reach a view. This is out of scope for the first build (task 4.1n, optional).

---

## 5. Pickup arrangements

### 5.1 What the user records

Each pickup is one record, entered by the user. The fields follow the common model in courier planners: an address or point, a time window (a fixed time is a window of zero width), a service time, notes, a stop type, and an amount to collect [103][104].

| Field | Values | Notes |
| --- | --- | --- |
| Label | Short text, for example "RTX 3090 – Bognor" | The user's own words |
| Where | A postcode (required), optional address text, and an optional **pin the user drags** to refine the point | Geocoded **in-house** by `location.pointForPostcode()` (the postcode sector's point [R21]); the pin overrides it. Never prefilled from listing data [R1] |
| Stop type | Collection, or Meet-up point | Route4Me's model has a MEETUP stop type [104]; Facebook listings can offer `PUBLIC_MEETUP` [R6] |
| When | **Fixed time** ("at 14:00"; the window is −5 to +10 minutes *(assumption)*), **window** ("14:00–15:30"), **after** or **before** a time, or **not agreed yet** | Fixed times, windows, "after" and "before" are hard constraints. "After 14:00" is the window from 14:00 to the day's latest finish; "before 12:00" is the window from the day's start to 12:00. Only "not agreed yet" has no window. Circuit likewise models "after" and "before" as independent constraints (`earliestAttemptTime`, `latestAttemptTime`) [103] |
| Day | A date | Europe/London |
| Time at the stop | 10 minutes by default *(assumption)*; a "testing the item" preset of 30 minutes *(assumption)* | The solver's service time |
| Agreed price, bring cash | £ amount; a tick box | Starts empty. The ask is shown beside it as a hint, never copied in. Circuit has a similar field (`paymentOnDelivery`) [103] |
| Size | Small, fits in the boot, or large | Later a boot-capacity constraint in the solver |
| Must get | A tick box | The solver serves must-get stops first when not everything fits (§6.2) |
| Notes | Free text | Private |
| Status | Arranged, Tentative, Collected, Cancelled, No-show | See §5.5 |
| Linked listing | Optional listing ID | Used to show the title and the "Open on Facebook" link only |

**The sheet shows three fields.** Everything else sits under "More details".

- **"Postcode or paste the seller's message".** Pasted text is parsed in the browser for a UK postcode; only the postcode, and address text the user chooses to keep, is saved. The pasted text is never stored, logged or sent.
- **"Day"**, as one-tap chips: Today, Tomorrow, the next Saturday and Sunday, and the user's existing pickup days ("Sat 26 Sep · 2 pickups"), plus "Other date". None is preselected, so the §9.1 prefill test still holds.
- **"Time"**, with "At" preselected and a numeric field (typing "1030" gives 10:30), plus Between, After, Before and Not agreed yet.

### 5.2 Entry points

1. **From a deal card:** "I've arranged a pickup". A sheet opens with **only** the listing title and link filled in. Location, day, time and price start empty; a test enforces this (§9).
2. **From a hint card or the map preview:** the same action.
3. **By hand:** "+ Add pickup" on `/app/pickups`, for anything the user arranged elsewhere, with no listing link needed.
4. **From a planned day:** "Add another pickup to this day".

After saving, a snackbar reads "Saved to Sat 26 Sep · 3 pickups · Plan route". The day page plans automatically once it has 2 or more pickups.

### 5.3 Privacy

The owner's rule [R1] is built as follows:

- **Owned only by `pickups`.** Records sit under row-level security in the `pickups` schema, with **no `v_` view** (a test checks the schema has none). `route-planner` reads them only through `pickups`' exported functions, inside `withUser`.
- **Encrypted text.** Address text, notes and the refined point are encrypted at the application level with an AES-256-GCM helper in a shared foundation package (for example `@nabvy/crypto`, created by the coordinator; until it exists, `pickups` keeps its own copy), never imported from another module ("never imports another module's internals" [R1]). They are decrypted only inside the module's functions. This needs a new secret, `PICKUPS_DATA_KEY` (recorded in `docs/questions.md` as missing, §10).
- **Not in logs or analytics.** No address, postcode, point or time appears in logs, Sentry events, `track()` payloads, or the admin "Users" tab; the admin tab shows counts only.
- **Geocoded in-house.** Pickup postcodes are geocoded only by `location.pointForPostcode()` over Nabvy's loaded tables, with no external call and no cache row. If `location` is off, the pickup is saved without a point and route planning is unavailable. It never falls back to postcodes.io.
- **Routing sees coordinates only.** The router VM receives bare coordinates, with no labels, user ID or listing ID, for OSRM's table and route calls only; the order is solved in process (§6.3). Its access logs are off (§6.6).
- **Tiles from Nabvy only.** Basemap tiles for the route view come only from Nabvy's own tile host, so tile requests near a pickup reach no outside service (§3.8).
- **Shared only at the user's tap.** Addresses reach Google, Apple or Waze only when the user taps a navigation link. The link is built on the device.
- **Private by default, like Google Maps saved lists** [R-map-ux]. There is no sharing feature and no public page. Sharing with a household member is an owner decision (§10).

### 5.4 Reminders

`pickups` schedules reminders as delayed Trigger.dev runs. Each is idempotent on (pickup ID, kind, time).

| Reminder | When | Content |
| --- | --- | --- |
| Evening before | 19:00 the day before, when the day has pickups *(design choice)* | "3 pickups tomorrow · first at 10:30" |
| Leave by | From the plan: planned departure for that leg (the later departure when the plan absorbs a wait, §6.5) minus 10 minutes. With no plan: 60 minutes before the agreed time *(design choices)* | "Leave by 10:02 for 'RTX 3090 – Bognor' at 10:30" |
| Not agreed yet | 18:00 the day before, for pickups with no time | "One pickup tomorrow has no agreed time" |

- **Channels:** the user's alert channels (web push, Telegram, email). The dispatcher asks `pickups` for the text, using a thin `pickup.reminder-due` event.
- **Content:** a reminder carries the **label and time, never the address**. The address is shown in the app after sign-in (conservative, §10).
- **After a re-plan:** the reminders are rescheduled.

### 5.5 Statuses and what follows them

- **Collected:** the app offers "Record what you paid" in inventory, as the existing "bought for" capture [R1]. It is offered, never automatic.
- **Cancelled or No-show:** the app offers the one-tap reports the owner designed, for example "seller said postage only", "asked for a bank transfer" or "item already sold" [R1]. The report carries only the listing ID and the report kind, through that module's own procedure; the pickup's location never leaves `pickups`.

### 5.6 Retention

The retention period for pickup data is not set [R1]. Meanwhile the conservative default is to **delete a pickup, and every route plan and day that includes it, 30 days after its day** *(interim; §10 row 15)*, and at once on account deletion. The user can delete a pickup at any time. The period is an owner decision (§10).

---

## 6. Route planner

### 6.1 The one-day haul

| Part | Model | Solver input (VROOM equivalent [80]) |
| --- | --- | --- |
| **The day** | Start point: home (from `planner_defaults`, §7.9), current location (taken once, at the tap), or a custom point. End point: home, open (end at the last stop) or custom. Start time and latest finish. Optional maximum driving time. These show as editable chips above the plan ("From home · 09:00 · back by 18:00 ✎"), not as a form before it | Start, end (none for an open end), day window, maximum drive time (VROOM: one vehicle with `start`, `end`, `time_window`, `max_travel_time`) |
| **A stop** | One pickup from `pickups` for that day, with a status of Arranged or Tentative | Point index, service time, window, must-get flag (VROOM: one job) |
| **Fixed time or window** | Hard | Window (VROOM `time_windows`) |
| **After or before** | Hard | Window [after, dayEnd] or [dayStart, before] (VROOM `time_windows` [[after, dayEnd]] or [[dayStart, before]]) |
| **Not agreed yet** | None | No window; the plan proposes a slot (§6.5) |
| **Must get** | Priority | Served first when not everything fits (VROOM `priority` 100; other stops 0) |
| **Limit** | At most **12 stops** a day *(design choice: the navigation links, the UI and the exact solver's run time set the limit)* | n/a |
| **Times** | Absolute Unix seconds, converted from Europe/London only at the edges | The solver works in absolute seconds |

### 6.2 The optimiser and the routing engine

| Option | Time windows | Licence | Verdict |
| --- | --- | --- | --- |
| **In-house exact solver** over an OSRM matrix | Yes. Hard windows, time at the stop, priority, pins, latest finish and maximum drive time are constraints. The objective, in order: most must-get stops, then most stops, then least driving time, then earliest finish. Each (visited set, last stop) state keeps the Pareto set of (arrival time, driving seconds). "My order" evaluates a fixed sequence and reports each lateness | Nabvy code (TypeScript); OSRM BSD-2 [72] | **Recommended.** Optimal for 12 stops or fewer, runs in Vitest, one service fewer. The single-label variant solved 12 stops in about 10.5 ms on Node 22 (49,152 states; computed, `dp_tw_bench.mjs` [R16]); keeping a few labels per state stays in the same range |
| **VROOM** with **OSRM** | Yes: time windows, service time, working hours, priorities; lists unfitted tasks as `unassigned`; **plan mode** (`-c`) keeps a fixed order and reports `delay` and `lead_time` violations [80] | BSD-2 both [79][72]; vroom-express BSD-2 [115] | Not needed at 12 stops or fewer. The upgrade path if the stop limit rises above about 15 (owner decision, §10 row 25). If used, vroom-express's `logdir` must be a RAM-only tmpfs mount: before every solve it writes the whole request body, with every stop's coordinates, to a JSON file there, and with `logdir` set to `/dev/null` that write fails and every request returns HTTP 500 "Internal error" [115] |
| Valhalla `optimized_route` | No; it solves an unordered travelling-salesman order with fixed first and last stops [83] | MIT | Keep as the alternative router, for example for drive-time areas later |
| GraphHopper (open source) | No matrix or optimisation API in the open-source engine [84] | Apache-2.0 | No |
| OR-Tools | Yes (a VRPTW sample exists), but no router and no JavaScript binding; it needs a Python service [86] | Apache-2.0 | No: TypeScript end to end [R1] |
| openrouteservice (self-hosted) | Yes, through VROOM | GPL-3.0 [85] | No: the licence is not allowed |
| openrouteservice hosted API | Yes | Service. Free key with daily quotas; the figures vary between sources *(search summary)* [98] | Possible stopgap only. Sends user origins and pickup points to HeiGIT *(owner decision)* |
| Google Route Optimization API | Yes | Service. SingleVehicleRouting: 5,000 visits a month free, then USD 10 per 1,000 at the first tier [87] *(search summary)* | Not recommended. About USD 50 a month at 10,000 visits *(estimate: 2,000 plans × 5 stops, routing researcher)*. Its terms restrict some content with non-Google maps [88] |
| Mapbox Optimization v1 | No time windows [89] | Service | No |
| OSRM demo server | n/a | Non-commercial use, at most 1 request a second [78] | No |

### 6.3 How a plan is solved

1. **Collect the day's pickups** through `pickups.listForDay(userId, date)` (decrypted in-module), plus the start and end points.
2. **One OSRM `table` call** through `router-gateway`, with `annotations=duration,distance`, `scale_factor` 1.2, and ferries allowed but detected (§4.1) [74]. There is **no caching**: pickup points are private and never enter `travel-time`'s shared cache.
3. **Solve in process.** `route-planner`'s pure solver takes the OSRM durations and distances, so the traffic buffer and the ferry handling stay under Nabvy's control. It returns the order, ETAs, waits and any stops that cannot fit, each with the lateness that inserting it at its cheapest place would cause.
4. **One OSRM `route` call** for the chosen order, to get the line to draw on the map. The line is recomputed when the plan is opened, never stored in plain form (§7.9).
5. **Cost the plan:** total road miles and time, costed by `travel-cost` at the user's settings.
6. **Store it** as a new `route_plans` version (no coordinates or address text), and emit `route.planned`.

OSRM's default table size of 100 locations is far above 12 stops [73].

### 6.4 Infeasible windows, locking, reordering and running late

- **Infeasible windows.** Stops the solver cannot fit come back as unassigned. Nabvy never drops a stop silently.
  - To explain the miss, the solver reports the lateness that inserting the stop at its cheapest place would cause. The card then says, for example: "Can't reach Pulborough by 10:45 after Portsmouth at 10:30. You'd be about 25 minutes late."
  - The user can move the stop to another day, change its time (after agreeing it with the seller), mark it "Must get" (served first), or drop it.
  - A copyable message for the seller comes from the existing prepared-message templates. Nabvy never contacts sellers.
- **Pin first or last.** A pinned stop is a constraint in the solver: its first or last position is fixed. No problem splitting is needed.
- **Reorder by hand.** Each stop row has a drag handle (≡), the only drag target in the list; dragging elsewhere scrolls, so it never clashes with resizing the sheet. A "⋯" menu on each row offers "Move earlier", "Move later", "Go here first" and "Go here last" (the pins), so nothing needs dragging (WCAG 2.5.7 [33]). Reordering switches the plan to **"My order"**: the solver evaluates the user's fixed sequence and reports each lateness (for example "late by 12 min"). The order is never changed silently. "Plan my day" returns to the optimised order.
- **Running late.** "I'm running late" re-plans the remaining stops from the current time and the current position.
  - The position is taken once, at the tap, used for this plan, and not stored beyond it.
  - The new plan lists the windows that will now be missed and offers the same choices as above.
  - It offers a copyable "running about 15 minutes late" message.
  - Circuit and Route4Me support the same re-plan-after-change and locking patterns [105][103].

### 6.5 What the user gets

- **On the map:** the ordered route as a line over the same MapLibre map, drawn only on Nabvy's own tiles (§3.8). The user's own exact stop points are shown **only to that user**, as a separate private layer that the listing map never shows. Listing markers stay approximate.
- **Stop list:** for each stop, the ETA, the agreed window, a late warning, and the marginal saving if the stop were dropped (for example "dropping this stop saves 14 miles and 25 min").
  - **Waits become later departures.** When the plan has a wait at a stop (VROOM's `waiting_time`, "waiting time upon arrival at this step" [80]), it is shown as a later departure from the previous stop ("Leave Pulborough by 12:47"), never as a wait at the seller's. The Leave-by reminder (§5.4) uses that later time.
  - **Proposing a time.** For a "Not agreed yet" stop, the plan shows "Suggest 15:10–15:30 to the seller" (the ETA rounded to 10 minutes, with a 20-minute window). It offers "Copy message" from the prepared-message templates, and "Set as agreed", which saves the window and re-plans. Nabvy never sends the message.
- **Day totals:** road miles, driving time, finish time and **cost at the user's travel settings**, with the basis stated ("fuel 14p a mile, time £12.71 an hour").
- **Navigation links,** built on the device only when the user taps, using coordinates rather than address text:

  | App | Link | Limit | Nabvy rule |
  | --- | --- | --- | --- |
  | Google Maps | `https://www.google.com/maps/dir/?api=1&origin=…&destination=…&waypoints=a\|b\|c&travelmode=driving` | Up to 9 waypoints; up to 3 on mobile browsers [93] | One link when it fits. Otherwise split into consecutive legs of at most 9 waypoints (desktop) or 3 (phone) |
  | Apple Maps | `https://maps.apple.com/directions?source=…&destination=…&waypoint=…&waypoint=…&mode=driving` | Repeated `waypoint` parameter, iOS 18.4 and later; no maximum documented [94] | Whole route on iOS 18.4+; per-leg links on older iOS |
  | Waze | `https://waze.com/ul?ll=LAT,LNG&navigate=yes` | One destination [95] | "Navigate to next pickup" only |

  The main control is always **"Navigate to next pickup"**, which works in every app. The user's chosen app is remembered.
- **Calendar export (`.ics`):** one VEVENT per stop.
  - DTSTART is the planned arrival and DTEND is arrival plus time at the stop, both in UTC to avoid timezone blocks.
  - LOCATION is the address text the user typed; DESCRIPTION holds the notes and the listing link.
  - A VALARM fires at that leg's departure time.
  - The UID is stable per pickup, SEQUENCE rises on each re-plan, and STATUS follows the pickup's status [96][97].
  - It is served **only as a download** to the signed-in owner, through an oRPC procedure. There is no subscribable feed, because a `webcal` URL is a bearer secret that would expose sellers' addresses (§10).

### 6.6 Hosting plan and cost

**One private VM** runs Docker Compose with two services:

- `osrm-routed` (MLD, car profile, Great Britain extract), started with `--algorithm mld --mmap` (it defaults to CH, so an MLD dataset will not load without the flag [116]), with `--max-table-size` and `--max-viaroute-size` raised and `DISABLE_ACCESS_LOGGING=1` [73][75];
- Caddy, serving HTTPS on 443 only, with a bearer token and access logs off.

The route optimiser runs in process in `route-planner` (§6.2), so no optimiser service runs on the VM.

`router-gateway` reads `ROUTER_BASE_URL` and `ROUTER_TOKEN` from `@nabvy/config`. Both are new entries for `docs/secrets.md` and are recorded as missing in `docs/questions.md` [R17].

**Monthly rebuild** (a systemd timer on the VM, 03:00 on the first Sunday of each month):

- `osrm-routed` always runs with `--algorithm mld --mmap`. Its data is then file-backed page cache that the kernel can reclaim, not about 4 GiB of private memory ("Map datafiles directly, do not use any additional memory" [116]). The VM has an 8 GB swap file.
- Download the Geofabrik Great Britain extract (about 2.0 GB *(search summary)* [90]). Run `osrm-extract`, `osrm-partition` and `osrm-customize` into a new directory under `nice -n 19`.
- Start a second `osrm-routed --algorithm mld --mmap` on port 5001 against the new directory, and health-check a fixture route (Chichester to Portsmouth).
- Restart the main service on the new directory. This takes seconds; meanwhile `router-gateway` falls back to straight line × 1.3. Once the main service runs on the new directory, emit `router.build-changed`, so `travel-time` invalidates its cache. Keep the previous directory for one month as the rollback.
- If the first build's measured peak (`/usr/bin/time -v`) is above 12 GB, stop `osrm-routed` for the build window instead, and let routing fall back to estimates for those hours.

**Sizing** *(estimate: the OSRM wiki's v5.26 planet figures, 61 GiB input, scaled linearly to the 2.0 GB extract, per the wiki's "The sizes scale roughly linear with input data size")* [77]:

- extract peak about 13.6 GiB (415 GiB × 2.0/61), partition about 7.2 GiB, customize about 5.7 GiB;
- serving about 4 GiB (123 GiB × 2.0/61);
- about 10 GB of data files per build, with two builds kept;
- about 2–3 hours of build time on 4–8 vCPU *(estimate: scaled from the README's 30 minutes for a 550.7 MB extract)* [73].

The extract peak plus a fully loaded server comes to about 17.6 GiB, more than 16 GB; this is why serving uses `--mmap`, and why the rebuild never runs two fully loaded datasets at once. The first build records the real figures in the module README.

| Host | Spec | Monthly cost | Where | Basis |
| --- | --- | --- | --- | --- |
| **Hetzner CX43** (recommended) | 8 vCPU, 16 GB, 160 GB | About EUR 15.99 | Germany or Finland; no UK site | Search summaries of Hetzner's June 2026 price adjustment [91]. Verify at order |
| AWS Lightsail, London (eu-west-2) | 4 vCPU, 16 GB, 320 GB | About USD 84 | UK | USD 0.1129 an hour × 744 h, from AWS's Price List API offer file of 2026-09-15 [92] |
| Hetzner CX33 | 4 vCPU, 8 GB | About EUR 8.49 | Germany or Finland | Serving only; builds would need a bigger machine [91] *(search summary)* |

**Also:**

- about 1–2 hours of operations a month *(estimate, routing researcher)*;
- no backups needed, because everything can be rebuilt from the extract and the repo's `infra/router/`.

Nabvy's database already runs in Supabase region eu-west-1 (Ireland) [R1]. Where the router is hosted is an owner decision, and is listed for legal review.

**Development and CI:** a small Geofabrik county extract (for example West Sussex) runs locally; CI uses only recorded OSRM responses [73], and runs the real solver on them.

---

## 7. Atomic modules and contracts

Every module follows `CLAUDE.md`'s shape: `README.md`, `src/index.ts`, `src/handlers/`, `src/domain/`, `src/repo/`, `test/`. Each owns a Postgres schema named after it [R18], keeps its types in `packages/contracts` under its own name, handles batches idempotently (key `source + sourceListingId + contentHash`), and can be switched off through its entry in the catalogue's `switches` module (off, shadow or on) [R20]. Geography columns and GiST indexes go in the module's raw SQL migration: the installed Drizzle emits only `geometry(point)` (map-stack researcher, `packages/db`).

**Timestamps.** `listing-search` sits outside the T0–T7 chain, so each `search_rows` row stores the T1 of the input it processed (`t1_fetched_at`) and its own `indexed_at`, for `ops-metrics` to measure lag [R1].

**Module names** follow the catalogue draft [R20], pending the owner's approval: `hunt-manager` → `want-manager`; `opportunity-router` → `spec-match` and `alert-router`; `ops-monitor` `track()` → `product-events`; `kill_switches` → `switches` (off/shadow/on); `inventory-resale` → `inventory`; `listing-registry` → `listing-ingest`; the price-position module → `asking-price-position`.

```
listing-ingest ──────┐
listing-location ────┤  app./v_ views + thin events
listing-card, listing-suppression,
parts record, noise filter, copy-advert,
asking-price-position, price-drop watch,
too-good-to-be-true ─┤
location ────────────┴──► listing-search ──► web: feed, filters, map, dashboard map
                                 │
travel-cost ─────────────────────┤
router-gateway ──► travel-time ──┴──► deal-hints ──► web: hint strip, hint pills
pickups ──► route-planner (in-process solver) ──► router-gateway ──► router VM (OSRM)
travel-cost ──► route-planner
location.withinKm() ──► spec-match, alert-router (hunt alerts; unchanged owners)
```

### 7.1 Places and distances: `location` and `city-pages` (existing designs)

Place data and distances come from the catalogue's `location` module (task 1.2f in `listing-location.md` [R21]), and city-page data from `city-pages` [R20]. This design adds no `geo` module. Task 1.2g extends `location` with:

- `searchPlaces(q, near?)`: town autocomplete, pg_trgm on `v_aliases` (in-house; public Nominatim forbids autocomplete [65]);
- `uncertainty_km` per place on `v_display_places`, from the OS Open Names bounding box [62];
- `withinKm(origin, displayPlaceId, km)`: the one distance predicate that `listing-search`, `deal-hints` and `spec-match` all use.

This design also calls 1.2f's `pointForPostcode()`, `distanceKm()`, `landmassFor()` and `v_display_places`.

- **Display level:** markers use City and Town places (Suburban Area only if the owner chooses it, §10 row 13), plus any place that is a Facebook city page (Facebook already shows that label publicly). A village or hamlet found only in a description is shown as its nearest such place ("near Chichester"), with its uncertainty increased *(design choice, owner decision §10)*. This rule sits under task 1.2g's `v_display_places`.
- **Off:** no postcode lookup, distance filter, Nearest sort, map or hints. The feed keeps Newest and the price sorts. Pickups are saved without a point and route planning is unavailable (§5.3).

### 7.2 `listing-location` (existing design, read only)

`listing-location` is designed in `listing-location.md` [R21]. This design reads only `app.v_listing_location` (display place, status, the approximate flag `is_approximate`, `area_landmass` for the `crossing` check, and `uncertainty_km`) and uses that module's status and precision values. It sets no contract for it.

- **Off:** `listing-location.md` defines the fallback: a listing falls back to its city-page area, marked approximate [R21].

### 7.3 `listing-search`: the read model and the one filter function

- **Job:** keep a searchable row per live listing version, and answer every feed, map and hint-candidate query through one SQL builder.
- **Tables:**
  - `search_rows`: the columns in §2.3. Indexes: btree on `place_id`, `listed_at desc` and `amount_minor`; GIN on `product_keys`;
  - `feed_state`: user ID, last filter and last view (RLS);
  - `hunt_views`: user, hunt, last viewed (RLS);
  - `listing_visits`: user, listing, first seen (RLS). Kept 90 days *(interim; §10 row 15)*.

  Size *(estimate)*: about 300 bytes a row, so about 150 MB at 500,000 rows.
- **Views:** `v_search_rows`, for admin and analytics. It holds no coordinates beyond the place ID.
- **Events:**
  - in, in batches: `listing.new`, `listing.changed`, `listing-location`'s events, and the parts, noise, copy-advert, asking-price-position, price-drop and too-good-to-be-true events. Each handler reads the source module's `v_` view and upserts rows, which is safe to run twice;
  - out: `search-rows.updated` `{ listingIds[], at }`.
- **Exported functions:**
  - `search(userId, filter, page)`;
  - `mapFeatures(userId, filter, bbox, zoom)`;
  - `facets(userId, filter)`;
  - `candidatesInBand(userId, filter, bandKm)`, for `deal-hints`;
  - `erase(listingIds)`, which deletes its `search_rows` and `listing_visits` rows for those listings.
- **Suppression, redaction and erasure.** Every query behind `search`, `mapFeatures`, `facets` and `candidatesInBand` anti-joins `listing_suppression.v_suppressed` at read time, and returns nothing while `switches.is_on('listing-suppression')` is false [R1][R20]. Card text (redacted title, town label, asking price) is joined at read time from `app.v_listing_card` and never stored in `search_rows`. Labels, position and copy flags are read from their modules' `app.` views, so a module that is off or in shadow shows nothing. On `account.deleted` the module purges the user's `feed_state`, `hunt_views` and `listing_visits` rows.
- **oRPC procedures** (in `apps/web/src/rpc/`, validated with the contracts, inside `withUser`):
  - `search.feed({ filter, cursor })` returns items, count, hidden count, no-clear-price count, unknown-location count and a coverage note;
  - `search.map({ filter, bbox, zoom })` returns place and cluster features;
  - `search.facets({ filter })`;
  - `search.saveState({ filter, view })`;
  - `search.markVisited({ listingId })`;
  - `hunts.saveFromFilter({ filter, name, huntId? })`, owned by `want-manager`.

  Before `search.saveState` or `hunts.saveFromFilter` stores a filter, an origin of kind `here` is replaced by `{ kind: 'place', placeId }` for the nearest display place. Coordinates from `here` are never written to any table or log.
- **Off:** the feed falls back to the plain alert list that `docs/web-app.md` describes [R2]; the map and hints are hidden. Hunt alerts are unaffected.

### 7.4 `travel-cost`

- **Job:** what a trip costs a user.
- **Tables:**
  - `travel_rates`: kind (advisory fuel rate by fuel and engine band, or the HMRC approved mileage rate), pence a mile, effective from, source URL;
  - `user_travel_settings` (RLS): preset, fuel, engine band, custom pence a mile or mpg, value of time, speed, c, and whether time is included.
- **Views:** `v_travel_rates` (public).
- **Events out:** `travel-settings.changed` `{ userId, at }`.
- **Exported functions:** `tripCost(userId, legs[{ roadMiles, minutes }])`, which returns pence and a basis sentence; `params(userId)`, for SQL sorts. Both are pure domain code.
- **oRPC procedures:** `travel.getSettings`, `travel.updateSettings`.
- **Off:** no hints and no "Lowest price + trip" sort. The route planner shows miles and time without £.

### 7.5 `router-gateway`

- **Job:** the only HTTP client for the router VM.
- **Tables:** `router_calls`: kind (table, route or health), location count, latency, status, at. **No coordinates.**
- **Events out:** `router.build-changed` `{ osmBuild, at }`.
- **Exported functions:** `table()`, `route()`, `health()`. Secrets come through `@nabvy/config`.
- **Off, or VM down:** `travel-time` falls back to straight line × 1.3. The route planner still orders the day on straight line × 1.3 at 35 mph, labelled "estimated times", and keeps the per-stop navigation links.

### 7.6 `travel-time`

- **Job:** road distance and time from an origin cell to places, for display and hints.
- **Tables:** `road_times`: origin cell (the origin rounded to 0.01°, about 1.1 × 0.7 km), place ID, OSM build, metres, seconds, `crossing` from `location.landmassFor()` plus OSRM's ferry detection on routed legs, computed at. It holds no user ID, and pickup points never enter it.
- **Views:** none. The cache is internal to the module and read through its function.
- **Events in:** `router.build-changed`, which invalidates the cache.
- **Exported functions:** `roadTimes(originCell, placeIds[])`, a batch call that makes one OSRM table call for missing cells.
- **Off:** straight line × 1.3, labelled "estimate".

### 7.7 `deal-hints`

- **Job:** at most 3 "slightly further away" hints per search, by the rule in §4.2. `hints.forFeed` runs once per filter; later pages never add hints.
- **Tables:** `hint_rules`, versioned parameter sets; shadow and live are the module's `switches` state. Candidates and impressions go to `product-events` through `track()` [R20], so no per-user table is needed.
- **Views:** none.
- **Events:** none. Hints are computed when results are read.
- **Exported functions:** `hintsFor(userId, filter)`.
- **oRPC procedures:** `hints.forFeed({ filter })`.
- **Off:** the strip and the hint pills disappear. The feed is unaffected.

### 7.8 `pickups`

- **Job:** the user's record of arranged pickups, and their reminders.
- **Tables** (RLS; **no views**):
  - `pickups`: the fields in §5.1, with address text, notes and the refined point encrypted;
  - `pickup_reminders`.
- **Events:**
  - out: `pickup.changed` `{ pickupId, userId, at }` and `pickup.reminder-due` `{ pickupId, userId, kind, at }`;
  - in: `route.planned`, whose payload carries `departures[{ pickupId, leaveAt }]`. These are identifiers and timestamps only, so `pickups` never imports `route-planner`.
- **Exported functions:** `listForDay(userId, date)`, `reminderText(userId, pickupId)` (label and time only), `setStatus()`.
- **oRPC procedures:** `pickups.list`, `pickups.create`, `pickups.update`, `pickups.setStatus`, `pickups.delete`.
- **Off:** the "I've arranged a pickup" action and the pickups pages are hidden. Records are kept and reminders paused.

### 7.9 `route-planner`

- **Job:** plan one day's collection route over the user's pickups.
- **Tables** (RLS; **no views**):
  - `pickup_days`: date, start and end kinds and points (encrypted), start time, latest finish, maximum drive time;
  - `route_plans`: version, mode (`optimised` or `my_order`), ordered pickup IDs with ETA, wait and lateness, unassigned pickup IDs with reasons, totals, OSM build, superseded at. No coordinates or address text are stored. The route line is recomputed through `router-gateway.route()` when the plan is opened, or cached only encrypted with `PICKUPS_DATA_KEY`;
  - `planner_defaults` (RLS, no view): home postcode and point (encrypted), day start 09:00, latest finish 18:00, end at home, 10 minutes at each stop *(design choices)*. It is asked for once, on the first plan, with "Use PO19 (your hunt postcode) as home?" offered as one tap.

  When a pickup is deleted (by the user, by the retention job or on `account.deleted`), every `route_plans` and `pickup_days` row for its day is deleted too. On `account.deleted`, `planner_defaults` is deleted.
- **Events out:** `route.planned` `{ planId, userId, dayId, at, departures[] }`.
- **Exported functions:** `planDay()`, `replan()`, `icsFor()`, and `homePoint(userId)` for the feed's "Home" origin (§2.3), called inside the same user's `withUser`. The solver itself is pure code in `src/domain/`.
- **oRPC procedures:** `routes.getDay`, `routes.upsertDay`, `routes.getDefaults`, `routes.updateDefaults`, `routes.plan({ dayId, mode, order?, pins? })`, `routes.replan({ dayId, position? })`, `routes.exportIcs({ dayId })`.
- **Off:** "Plan my day" is hidden. Pickups keep working, with per-stop navigation links.

### 7.10 Contract sketch (`packages/contracts`, module `listing-search`)

```ts
FeedSort   = 'newest' | 'nearest' | 'price_asc' | 'price_desc' | 'price_position' | 'price_plus_trip'
Condition  = 'new' | 'like_new' | 'good' | 'fair' | 'not_stated'
Handover   = 'collection' | 'meetup' | 'drop_off' | 'posted'
FeedOrigin = { kind: 'hunt'; huntId } | { kind: 'home' } | { kind: 'postcode'; postcode } | { kind: 'place'; placeId }
           | { kind: 'here'; lat; lng }                 // rounded to 0.01° by the client; replaced by the nearest 'place' before any store
FeedArea   = { kind: 'radius'; radiusKm } | { kind: 'any' }
           | { kind: 'bbox'; west; south; east; north }  // only with "Any distance" (§3.4)
FeedFilter = {
  huntIds?: Uuid[]; origin: FeedOrigin; area: FeedArea; sort: FeedSort
  priceMinMinor?: int; priceMaxMinor?: int; conditions?: Condition[]; handover?: Handover[]
  listedWithin?: '1h' | '24h' | '3d' | '7d' | '30d'; priceDropped?: boolean
  match?: { inDescription: boolean; kinds?: ('whole' | 'part' | 'bundle')[] }
  includePending: boolean; includeHidden: boolean; includeNoClearPrice: boolean
  hideApproximate: boolean; includeUnknownLocation: boolean; hints: boolean
}
FeedItem   = { listingId; title; askMinor?; currency; priceKind; condition; handover[]; listedAt
               place: { id; name; approximate: boolean }; straightMiles?: int; road?: { miles: int; minutes: int }
               position?: { lowerThan: int; n: int }          // present only when n >= 10
               labels[]; alsoListedIn?: int; visited: boolean
               photo?: { url } }   // present only when the switches flag 'listing-photos' is on
MapFeature = { kind: 'town'; placeId; name; lng; lat /* a v_display_places point */; count; minAskMinor?
               lowAskCount: int; hint: boolean; plusMiles?: int; visited: boolean }
           | { kind: 'cluster'; lng; lat /* display point of the group's largest town */; count; towns: int
               bbox /* computed only from display points */ }
```

`FeedItem.title` is the redacted title from `app.v_listing_card`. `FeedItem` and `MapFeature` carry no seller field or listing coordinate, and `FeedItem` carries no photo URL while the `listing-photos` flag is off. `MapFeature` never carries a photo. The CI tests in §9 check the serialised output, not just the types.

---

## 8. Data needed from listings

| Need | Actor field | Availability | Notes |
| --- | --- | --- | --- |
| Place identity | City page at `sourceFields.search.location.reverse_geocode.city_page { id, display_name }` | **Every row, from search cards** (20 of 20; 18 distinct pages) [R7 §3] | The documented path `locationDetails.reverse_geocode.city_page.id` was present on 0 of 20 rows. Which path is the contract is actor question Q1 [R7 §11]. The `state` field was `""` on all rows |
| Town label | `location` | Every row | Ambiguous: "Hove" is the page "Brighton and Hove"; city "Poole" has page "Upton, Dorset". Prefer the city-page ID [R7 §3] |
| Coordinates | `locationCoordinates { latitude, longitude, precision: "coarse" }`, and the same numbers in `locationDetails` | **Only after details**: 0 of 1,268 search cards had coordinates [R7 §3] | On a grid of 180/2^15° latitude by 360/2^15° longitude, about 0.61 × 0.77 km (computed [R16]). Finer than town, so **internal only**. It can disagree with the label: the "Chichester" row is 11.6 km south of the centre (computed). Every row carries a `conflicts[]` entry for `locationDetails` [R7] |
| Place names or postcodes in the text | `description`, with `descriptionStatus` | After details (all 20 `full_verified` in the recorded run) [R6] | Used internally by `listing-location`; only the derived town may reach a view [R1] |
| Handover | `deliveryTypes` (cards); `shippingOffered` (details) | Cards and details | `IN_PERSON` on 20 of 20; one row also had `PUBLIC_MEETUP`, `DOOR_PICKUP` and `DOOR_DROPOFF`; `shippingOffered` false on 20 of 20 [R16] |
| Condition | `condition` | Details only (19 of 20) | Four labels, with an en dash [R7] |
| Price | `money { amountMinor, currency, kind }` | Every row | `kind` is fixed, free, unknown or ambiguous [R6] |
| Listed time | `listedAt` (Unix seconds) | Every row, exact | T0 [R6] |
| Availability | `availability { sold, pending, … }` | Every row | [R6] |

**Missing, or not usable:**

- **No coordinates on watch stubs,** which run with details off [R6].
- **No reliable town centroids from Facebook.** The seed's coordinates are "town-level approximations from listing data" [R15], and they sit on the same grid (computed: Portsmouth and Basingstoke share longitude −1.0822 [R16]). Nabvy needs OS Open Names.
- **Seed gaps.** The seed has no coordinates for the 5 verified centres, nor for Pulborough, and it lacks Chessington and "Upton, Dorset" [R7 §9.1][R16].
- **No county or region** (`state` is empty).
- **No Northern Ireland gazetteer** in OS Open Names (GB only [61]), and a commercial licence is needed for BT postcodes [63].
- **No postage cost** on Facebook rows, so "price + postage" has no data behind it [R16].
- **Never in listing data,** and never to be taken from it: the seller's pickup address and the agreed time [R1].

**What Nabvy derives:**

- the resolved place, its precision and its uncertainty (`listing-location`);
- the place's display point (`location`);
- `handover[]`;
- the condition ladder;
- road times per origin cell (`travel-time`).

---

## 9. Tests and acceptance

### 9.1 Module tests (fixture-based, per `CLAUDE.md`)

- **`location` extension (task 1.2g):**
  - `searchPlaces` finds all 18 city-page towns of the recorded run, including Chessington and "Upton, Dorset", which are not in the seed;
  - `uncertainty_km` on `v_display_places` matches half the OS Open Names box diagonal, with the 1-mile floor;
  - `withinKm` against hand-checked distances, and the same answer when called from `listing-search` and from `spec-match`'s fixtures;
  - pickup postcodes resolve through `pointForPostcode()` with no external call and no cache row; BT postcodes are refused with a clear message.
- **`listing-location`:** tested in its own design [R21]. This design checks only that `app.v_listing_location` has the columns it reads.
- **`listing-search`:**
  - a stored filter never contains `kind: 'here'`;
  - `erase(listingIds)` removes those listings' rows, and `account.deleted` purges the user's rows;
  - the count is the same across all six sorts;
  - order is stable, with ties broken by ID;
  - price sorts exclude non-fixed and £0 prices;
  - the clean set is the default, with working reveal links;
  - the position sort is disabled when no row has n≥10;
  - sold listings are never returned;
  - each upstream module switched off hides its chip, and the feed still returns;
  - handlers are idempotent when replayed.
- **`travel-cost`:** reproduces the worked numbers in §4.2 (£1.31 per extra mile at the defaults; £6.54 for 5 miles); picks the dated rate by date; handles a value of time of £0.
- **`travel-time`:** recorded OSRM table responses; the ferry flag for a Ryde (Isle of Wight) place; invalidation on a new OSM build; the fallback labelled "estimate".
- **`deal-hints`:**
  - each gate: n<10, suspected, the 60% cap, not collectable, noise, approximate, ferry, outside the band;
  - a confirmed gem below 60% of the median is hinted; an unconfirmed one is not;
  - the three worked cases in §4.2;
  - at most 3 hints per search, and none added by later pages;
  - "+N mi" equals the card's rounded distance minus the limit;
  - hints never appear in `search.feed` items or counts;
  - shadow mode shows nothing.
- **`pickups`:**
  - row-level security: user B reads none of user A's pickups;
  - the schema has **no views** (introspection test);
  - the deal-card prefill carries no location, day, time or price;
  - pasted seller text is parsed in the browser only: no request, log or row carries it;
  - encrypted fields round-trip;
  - `track()` and Sentry payloads carry no address, postcode or time;
  - reminder text carries no address.
- **`route-planner`:**
  - the solver's order equals a brute-force optimum for up to 8 stops on recorded OSRM matrices;
  - 12 stops solve within the test's time budget;
  - "after" and "before" are hard windows; a wait is reported as a later departure from the previous stop, never as a wait at a stop;
  - an infeasible window yields an unassigned stop with a reason and its lateness;
  - pin first and pin last;
  - lateness reports for a hand order ("My order");
  - "running late" re-planning;
  - a day across the clock change on **25 October 2026**;
  - Google links split at 9 waypoints (desktop) and 3 (phone); Apple repeats `waypoint`; Waze gives one link per leg;
  - ICS golden file (line folding, stable UID, SEQUENCE increments);
  - `router_calls` holds no coordinates;
  - `route_plans` and `pickup_days` hold no plaintext coordinate or address (schema introspection plus a fixture scan);
  - deleting a pickup deletes every route plan and day that includes it.

### 9.2 CI guards on user-facing output

These extend the checks the owner already asked for [R1].

1. **Location precision.** Every `lng`/`lat` in `search.feed`, `search.map` and `hints.forFeed` output, town and cluster features alike, equals a `location.v_display_places` point, and each cluster `bbox` is computed only from those points. No `locationCoordinates`, `locationDetails`, postcode or street from a description appears anywhere.
2. **Seller fields:** none in any output.
3. **Photos:** no photo URL while the `listing-photos` flag is off.
4. **Asking-price position:** no position, badge or position sort label where n<10.
5. **No collection from browsing:** a scripted map pan, "Search here" and "Search this area" leave the `apify_gateway` job count unchanged.
6. **Pickup privacy:** no view in the `pickups` or `route-planner` schemas.
7. **Licences.** Fails when a pull request adds or upgrades an npm package (lockfile diff against the base branch, production and development) whose licence expression has no branch among MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC or PostgreSQL. Packages already in the tree outside that list are recorded in `licence-exceptions.json`, each with its owner decision in `docs/questions.md` (§10 row 26). Today these are `lightningcss` (MPL-2.0, via `vite`) and `caniuse-lite` (CC-BY-4.0); with Next.js, also `tslib` (0BSD) and the optional `@img/sharp-libvips-*` (LGPL-3.0-or-later); with Tailwind 4, `lightningcss` again (walked in the installed tree and the npm registry by the critic). The guard also fails on any entry added to that file without a matching question.
8. **Suppression:** a suppressed listing never appears in `search.feed`, `search.map`, `search.facets` or `hints.forFeed`, counts included, and switching `listing-suppression` off empties all four.
9. **Contact details:** no phone number, email, social handle or stored seller name appears in any title or text in these outputs.

### 9.3 Accessibility and performance

- axe on the feed, map and pickups pages.
- A keyboard-only Playwright run covering the map checklist in §3.6.
- A keyboard-only and single-tap test that reorders a stop and pins one without dragging (§6.4).
- Lighthouse above 90 on the feed [R2], and on the dashboard with the "Deals near you" block (4.1b [R10]).
- The map procedure under 300 ms at p95 on 200k seeded rows *(design target)*.

### 9.4 End-to-end acceptance: the team's rtx3090 hunt around Chichester

The team's rtx3090 hunt around Chichester is the owner's first acceptance test [R1].

**Stage A: deterministic, in CI.** Inputs:

- the recorded Chichester run [R8];
- a synthetic comparable-asks fixture, labelled synthetic and never shown as market data, that gives the Basingstoke and Woking listings' spec-and-condition groups n = 12 each, in two variants (group median £850 and £700);
- OS Open Names points for the 18 pages;
- the origin at Facebook's Chichester centre, 50.836, −0.775 [R9];
- r = 25 miles and default travel settings.

The expected results rest on straight-line distances from both the coarse points and the seed points; the two agree on which band every town falls in (computed, `town_points.py` [R16]).

| Check | Expected |
| --- | --- |
| In-radius towns | **Chichester** (or Selsey, as `listing-location` resolves the Chichester row [R21]), **Portsmouth** (12.6 mi coarse; 13.5 mi seed) and **Pulborough** (14.2 mi coarse) |
| Hint-band towns (25–37.5 mi) | **Southampton** (26.5 / 27.8), **Basingstoke** (33.5 / 32.5) and **Woking** (34.6 / 35.8). Epsom (43.3 / 40.6) is outside the band |
| Lowest price | The £25 "Builder and repair" service advert (Southampton) and the £50 and £95 headsets never appear at the top: they are removed as noise or product mismatch, and listed under "Hidden by Nabvy" |
| Hints | Southampton is never hinted (noise). Woking (£300 against a synthetic median of £700) fails the 60% gate, as it is not a confirmed gem. Basingstoke (£750) is hinted at a synthetic median of £850 ("+8 mi beyond your 25 mi"), and not at £700. The "How this is worked out" view shows G, K and the settings |
| Map | Town pills at the in-radius display points and nothing finer; no normal pill outside the ring. With "Any distance", London's listings that survive the clean set form **one** pill (three before filtering: £1,650, £200 and £400). The payload passes guards 1–4, 8 and 9 |
| Nearest order | Chichester first; the order of Portsmouth and Pulborough is pinned once `location` has loaded the OS points |

**Stage B: live, on staging, with the real rtx3090 hunt.** A Playwright script plus a manual checklist; the tester records results in the task's pull request.

1. **Filters.**
   - Set 25 mi and sort by Lowest price, then Nearest, then Newest; the count is the same each time.
   - Remove a condition chip, press Back, and the state is restored.
   - "Hidden by Nabvy (n)" reveals the noise.
   - Sold listings never appear.
2. **Map.**
   - The desktop split view and the mobile bottom sheet both work.
   - Tapping the Portsmouth pill filters the list to that town on desktop, and shows the one-card carousel on a phone.
   - With 25 mi set, pan 20 miles north on desktop. No listing beyond 25 mi of the origin appears as a normal pill or card.
   - Pan to Southampton and press "Search here": the chip reads "25 mi of Southampton", results come from the pool only, and **no gateway job is created**.
   - The map's first view shows the ring and any hint pills without panning.
   - Pan to Leeds and press "Search here": "No listings here yet · Add a hunt here".
   - Keyboard-only: select a town, open the preview, press Escape.
3. **Hint.**
   - The strip shows 0–3 items, each with its arithmetic.
   - If none qualify, the strip is absent, and the admin shadow log lists the candidates with G, K and M.
   - Turning hints off removes the strip and the dashed pills.
4. **A three-stop pickup route.** The tester records three pickups, entered by hand. The postcodes are the tester's own choice, for example public landmarks, never taken from listings. Start and end are at home near Chichester (PO19), in a 09:00–18:00 day.
   - (A) Portsmouth, **fixed 10:30**, 10 minutes.
   - (B) Pulborough, **window 12:00–13:00**, 10 minutes.
   - (C) Basingstoke, **after 14:00**, 30 minutes ("testing").

   Pass criteria:
   - "Plan my day" gives an order where every ETA falls inside its window, with totals in miles, time and cost at the settings shown.
   - C is reached at or after 14:00. With the fallback timings (straight line × 1.3 at 35 mph, an estimate), A → B → C is the only feasible order, and the plan shows "Leave Pulborough by 12:47", not a 37-minute wait at Basingstoke.
   - **Timed.** A tester new to the feature enters three pickups from three deal cards (one fixed time, one window, one "after") and reaches a feasible plan in under 60 s, median of 3 runs, timed from the first tap on the pickup action to the plan showing. Expected: about 50 s, against about 86 s for the earlier multi-field form *(estimate: 1.5 s per tap including the decision and 0.5 s per typed character; not measured)*.
   - Changing B to 10:30–10:45 clashes with A. One of A and B comes back **unassigned**, with a lateness reason and the move, skip or "must get" choices. Marking the other "must get" flips which one is left out.
   - Moving C before B (with the drag handle, or "Move earlier" in the "⋯" menu) shows B late, in "My order".
   - "I'm running late" at 11:50 re-plans the rest.
   - The Google link opens the whole route on desktop, and splits correctly on a phone browser (a synthetic 5-stop day forces the split).
   - The Apple link opens on iOS 18.4 or later; Waze opens per leg.
   - The `.ics` file imports three events with alarms into Google Calendar and Apple Calendar.
5. **Privacy.**
   - A second test account sees none of the pickups.
   - The router VM's access log is empty.
   - Database introspection shows no pickup data in any `v_` view.
   - Reminders show the label and time only.
6. **Measurement.** Record the router's first-build RAM, disk and time; the tester's actual drive times against the ETAs, to calibrate `scale_factor`; and the p95 of the feed and map procedures.

---

## 10. Owner decisions needed

Each item goes into `docs/questions.md` with the conservative option taken meanwhile, as `CLAUDE.md` requires.

| # | Decision | Options and cost | Recommended default |
| --- | --- | --- | --- |
| 1 | Routing: self-hosted or hosted | Self-hosted OSRM with the in-house solver (fixed VM cost; addresses stay on our server). openrouteservice hosted (free with quotas; sends points to HeiGIT) [98]. Google Route Optimization (about USD 50 a month at 10,000 visits, estimated [87]; map-terms issue [88]) | **Self-hosted** |
| 2 | Router host | Hetzner CX43, about EUR 15.99 a month, EU [91] *(search summary)*; or Lightsail London 16 GB, about USD 84 a month, UK [92] | **Hetzner CX43** (EU, like the Supabase database in Ireland); Lightsail if the owner wants UK residency |
| 3 | Tile provider | Protomaps on Nabvy's Cloudflare account: £0 below 100,000 tile requests a day, about USD 6.80 a month at 1M map sessions *(estimate: Cloudflare list prices, 16 tiles a session)* [55][56]; OpenFreeMap, £0 with no SLA, funded by donations [50][51]; MapTiler Flex, reported $25 a month; Stadia Starter, reported $20 a month [59][60] *(search summaries)*. Hosted tile APIs are services, not dependencies | **Protomaps on Nabvy's Cloudflare account** (already planned for DNS and Turnstile [R19][R17]), with OpenFreeMap as the fallback |
| 4 | Sponsor OpenFreeMap | Optional, amount at the owner's discretion [50] | None recorded |
| 5 | Default distance | 25 miles (40 km), matching the current hunt default [R3] | **25 miles** |
| 6 | Hints on by default, band, count, margin | Band clamp(r/2, 5, 15) mi; at most 3; margin max(£10, 5% of median) | **On**, with these values, **after shadow mode** on the test hunt |
| 7 | Travel cost per mile default | HMRC advisory fuel rate (14p, 1 March 2026 [100]); HMRC 55p business rate [99]; or no default | **Advisory fuel rate**, as a dated configuration row, checked each quarter |
| 8 | Value of time default | £12.71 an hour (National Living Wage [101]), or £0 | **£12.71**. Counting time means fewer hints |
| 9 | Hint wording | "Worth the trip" uses "worth", which the price-wording rule restricts [R1]; the three-line hint card text (§4.4); and whether "deal", "saving" or "value" may appear beside an ask | **"Slightly further away"**, with "Asking £X below the median of N similar asks"; no "deal", "saving" or "value" beside an ask until the owner decides |
| 10 | Label for the position sort and the marker badge | "Lowest vs similar asks" and "low ask" are working labels. Candidate: "Most below similar asks" for the sort, keeping "low ask" for the badge, so the sort is not confused with "Lowest price". Both still show only at n≥10 | "Most below similar asks" and "low ask" as working labels, shown only at n≥10; put to the owner as a wording question in `docs/questions.md` |
| 11 | Pending listings | Shown or hidden by default | **Hidden** |
| 12 | "Any distance" preset (was "Whole watched area") | Offer it, or not | **Offered**, with the coverage note |
| 13 | Place granularity | Town/City (plus Facebook city pages) for all; or Suburban Area in big cities; how villages found in text are shown | **Town/City**; villages shown as "near {town}" |
| 14 | Northern Ireland | A place source (OS Open Names is GB only [61]); an LPS licence for BT postcodes [63] | NI listings without a place point appear in the list under "Location unknown", not on the map; BT postcodes not geocoded; NI users pick a town |
| 15 | Retention of pickup data and visited-listing records | The position leading consumer tech companies share for user-entered places and viewing history (decisions, "Policies and conduct match big tech" [R1]), in Nabvy's words; or a fixed period | Interim until the owner decides: pickups, with their route plans, deleted 30 days after their day; visited-listing rows after 90 days; both deletable by the user at any time and purged on account deletion |
| 16 | Reminder content | Label and time; or include the address | **Label and time only** |
| 17 | Route sharing | None; household sharing | **No in-app sharing** |
| 18 | Calendar subscription feed | Download only; or a `webcal` feed (a bearer-secret URL) | **Download only** |
| 19 | Fuel Finder registration | A free government API with OAuth credentials [107]; or HMRC advisory rates only | **Advisory rates only** for now |
| 20 | Hints in alerts | Per-hunt toggle | **Off** by default |
| 21 | Pickups encryption key | A new secret, `PICKUPS_DATA_KEY` | Add it; until it exists, the `pickups` module does not ship |
| 22 | `docs/dashboards.md` "score-coloured pins" | Neutral pills with a text-and-icon badge only at n≥10 | **Neutral pills** |
| 23 | Drive-time filters ("within 30 minutes") | Later, with Valhalla isochrones [83] or TravelTime (prices not published) | **Not now** |
| 24 | Route-planner assumptions | 10 min at a stop, 30 min testing preset, −5/+10 min around a fixed time, traffic factor 1.2, at most 12 stops, day 09:00–18:00 in `planner_defaults` | **These values**, calibrated on the test hunt |
| 25 | Route optimiser | In-house exact solver in `route-planner` (optimal at 12 stops or fewer, about 10 ms, no extra service, tested in Vitest); or VROOM 1.15.0 behind vroom-express on the router VM, with `logdir` on a RAM-only tmpfs mount (`tmpfs: /vroom-logs` in Compose), where each request's coordinates sit for the length of one solve and are then deleted [115]; §5.3 would then say so | **In-house solver**; VROOM only if the stop limit rises above about 15 |
| 26 | Licences already in the tree outside the allowed list | `lightningcss` (MPL-2.0, via `vite` and Tailwind 4), `caniuse-lite` (CC-BY-4.0), `tslib` (0BSD, via Next.js; does 0BSD count as "BSD"?), optional `@img/sharp-libvips-*` (LGPL-3.0-or-later, via Next.js). The brief lists MPL as not allowed | Recorded in `licence-exceptions.json` pending the owner's decision; no new package outside the list (guard 7) |
| 27 | Module names | The catalogue draft's names (§7 intro) or the build pack's | **Catalogue names**, pending approval |

Secrets to add to `docs/secrets.md`, each recorded as missing in `docs/questions.md` until provided: `ROUTER_BASE_URL`, `ROUTER_TOKEN` and `PICKUPS_DATA_KEY`, plus R2 write credentials for the quarterly tile refresh job on the router VM (names for the coordinator to set). `MAP_STYLE_URL` is configuration, not a secret.

---

## 11. Backlog tasks

The ids extend build-pack tasks with letter suffixes, as `docs/backlog.md` does [R10]. Already taken: 4.1a (design system), 4.1b (user dashboard), 4.1c (PR #10, `docs/handoff.md` [R19]), 4.1d (too-good-to-be-true UI [R23]), 1.3a–1.3d (integration plan [R24]), 1.2f and 1.5l–1.5o (`listing-location` [R21]). `listing-location.md`'s consumer task (its 4.1c) is merged into 4.1e, 4.1f and 4.1j here; its Playwright checks join their definitions of done. Every task's definition of done includes the standard items:

- types in `packages/contracts` under the module's name;
- tables in `packages/db` with a raw SQL migration where geography is used;
- a fixture-based test;
- `pnpm typecheck && pnpm lint && pnpm test` clean;
- `pnpm db:dry-run` clean;
- a note in the module README on anything decided;
- the progress row, kept by the coordinator [R1];
- work on branch `task/<id>-<module>`, with one pull request.

| Id | Task | Depends on | Definition of done (beyond the standard items) |
| --- | --- | --- | --- |
| **1.2g** | **`location`: place search, per-place uncertainty and `withinKm`** | 1.2f | `searchPlaces(q, near?)` (town autocomplete, pg_trgm on `v_aliases`); `uncertainty_km` per place on `v_display_places` (from the OS Open Names bounding box, 1-mile floor); `withinKm(origin, displayPlaceId, km)` as the one exported distance predicate; the display level of §7.1 (City and Town, Suburban Area only on the owner's choice). All 18 recorded city-page towns found by `searchPlaces` (test). No external calls in tests |
| **4.1e** | **`listing-search`: filters, sorts and saved filters** | 1.2g, 1.5m, `listing-suppression`, `listing-card`, 4.1 (with the parts, noise, copy-advert, asking-price-position, price-drop and too-good-to-be-true modules optional; their chips hide until they exist) | `FeedFilter`, `FeedSort`, `FeedItem` and `MapFeature` contracts. `search_rows` built by batch handlers, with `t1_fetched_at` and `indexed_at`. `feed_state` (filter and view), `hunt_views` and `listing_visits` with RLS. One SQL builder, anti-joining `listing_suppression.v_suppressed`, with card text from `app.v_listing_card`. `erase()` and the `account.deleted` purge. Procedures `search.feed`, `search.facets`, `search.saveState` and `search.markVisited`, with `here` origins replaced before storing. Chip row (pinned "Filters · n", origin in the distance chip), sheets, desktop panel, filled chips on phones, URL state. The phone card of §2.4 and the hint strip slot. "Save as hunt" (`Hunt.filter`) in `want-manager`. Tests from §9.1. Playwright: filter, remove a chip, Back; the network log shows no coordinates other than display points and no inward postcode; a conflicting listing appears once, with its chip; with `listing-location` off, a listing falls back to its city-page area, marked approximate (from `listing-location.md`'s 4.1c [R21]). Lighthouse above 90 on the feed. Stage A rows for filters pass |
| **4.1f** | **Map view (web feature)** | 4.1e, 4.1a | `maplibre-gl` 6.11.1, `@vis.gl/react-maplibre` 8.1.3 and, if used, `supercluster` 9.1.0, with one-line licence justifications in the PR. The worker copy script and CSP. `MAP_STYLE_URL` in `@nabvy/config`. The Protomaps UK extract on R2 with the Worker on a Nabvy subdomain, the style built with `@protomaps/basemaps` 5.7.2, and glyphs and sprites in the same bucket; OpenFreeMap as the fallback. `search.map`, with server aggregation above 300 towns at display points. Split view (one card column below 1440 px, sidebar icon rail), in-house bottom sheet, the one-card carousel on phones, the distance kept as the search area with "Search here", radius ring, hunt outlines only where they differ, first view fitting ring and hints, card and marker linking. Map markers grouped by area with approximate and conflict styles (from `listing-location.md`'s 4.1c [R21]). Accessibility checklist §3.6. CI guards 1–9 (guard 7 with `licence-exceptions.json`). The dashboard "Deals near you" block reuses the component, loading MapLibre only on "Show map" or when idle and in view. Stage A map rows pass |
| **4.1g** | **`travel-cost`** | 0.2, 0.3 | Dated rate rows with source URLs (the 1 March 2026 advisory fuel rates; 55p/25p approved mileage rates), each checked against gov.uk before merge. Travel settings and UI. `tripCost` and `params`. The "Lowest price + trip" sort switched on. The §4.2 worked numbers as tests. A quarterly review reminder |
| **4.1h** | **Router VM and `router-gateway`** | Owner decisions 1 and 2; the hosting account; secrets `ROUTER_BASE_URL` and `ROUTER_TOKEN` | `infra/router/`: Docker Compose (OSRM and Caddy with a bearer token), the Great Britain build script, the monthly rebuild of §6.6 with a health route, logs off. `osrm-routed --algorithm mld --mmap`; the rebuild never runs two fully loaded datasets at once; measured peak RSS for each step recorded. The quarterly PMTiles refresh job (§3.8). The `router-gateway` module (`table`, `route`, `health`), with `router_calls` holding no coordinates and a switch-off. Recorded-response fixtures. Measured first-build RAM, disk and time in the README. A runbook |
| **4.1i** | **`travel-time`** | 1.2g, 4.1h | `road_times` keyed by origin cell, place and OSM build. Batch `roadTimes`. `crossing` from `location.landmassFor()` plus OSRM ferry detection. Invalidation on `router.build-changed`. The straight line × 1.3 fallback labelled "estimate". Road labels on cards behind the module switch. Tests including Ryde |
| **4.1j** | **`deal-hints`** | 4.1e, 4.1g, `asking-price-position`, the too-good-to-be-true modules and `gem-finder` [R22]; 4.1i optional | The §4.2 rule in versioned `hint_rules`. Shadow mode first (its `switches` state, logging G, K and M through `product-events`), going live only on the owner's approval. The strip after the 6th card, and the dashed map pills. At most 3 per search. The three-line card and "How this is worked out". Hints limited to non-approximate areas and never across a crossing (from `listing-location.md`'s 4.1c [R21]). The per-hunt alert toggle, off by default. The §9.1 tests. Stage A hint rows pass |
| **4.1k** | **`pickups`** | 1.2g, 4.1, secret `PICKUPS_DATA_KEY` | Tables under RLS with no views, and encrypted text fields (shared AES-256-GCM helper, or the module's own copy until `@nabvy/crypto` exists). Procedures. Entry from the deal card, hint card, map preview and by hand. The three-field sheet with in-browser postcode parsing, day chips and the numeric time field; the snackbar to the day page. The prefill test. Reminders via `pickup.reminder-due` (label and time only). Statuses with the inventory and report hand-offs. The retention job (interim, §10 row 15). The §9.1 privacy tests |
| **4.1l** | **`route-planner`** | 4.1g, 4.1h, 4.1k | Tables under RLS with no views, including `planner_defaults`. The in-house exact solver in `src/domain/` and the plan flow (§6.3). Hard "after" and "before" windows; waits shown as later departures; slot proposals for "Not agreed yet". Pins, "My order", drag handle and "⋯" menu, unassigned reasons, running late. Totals with cost. Deep links with splitting. ICS download. The private route layer, only on Nabvy's tiles. `route_plans` without coordinates, and deletion with its pickups. The planner's read-only area hint, never filling the address field (from `listing-location.md`'s 4.1c [R21]). The §9.1 tests, including the brute-force optimum, the clock change and the ICS golden file. The timed Stage B check |
| **4.1m** | **Acceptance: the rtx3090 Chichester hunt, end to end** | 4.1e–4.1l | Stage A in CI and Stage B on staging (§9.4). Results, measured figures and the calibration of c, v, M and `scale_factor` recorded in the PR and in the modules' READMEs. The owner signs off on hints going live |
| 4.1n | *(optional, later)* Hints near a planned pickup day | 4.1j, 4.1l | Detour cost from `route-planner` inside the user's context; the wording "about N miles off {day}'s route"; no pickup data leaves `route-planner` |

**Coordinator edits to the build pack** (these are not module work):

- `docs/dashboards.md`: replace "score-coloured pins" with neutral town pills (decision 22). `docs/dashboards.md` line 17 and backlog 4.1b: "OpenFreeMap tiles" becomes "Nabvy's Protomaps tiles, with OpenFreeMap as the fallback".
- `docs/web-app.md`: the deal feed's "filters by hunt, source, score" becomes the filter and sort set in §2. Add the pickups routes (`/app/pickups`, `/app/pickups/[date]`).
- `docs/modules.md` and `docs/contracts.md`:
  - add the seven new modules (`listing-search`, `travel-cost`, `router-gateway`, `travel-time`, `deal-hints`, `pickups`, `route-planner`) and their tables, and the 1.2g extension of `location`;
  - `Hunt` gains `filter: FeedFilter`;
  - the hunt default "min deal score 60" is raised as a question, since no unexplained score is shown.
- A shared foundation package for AES-256-GCM (for example `@nabvy/crypto`), used by `pickups` and `route-planner`.
- `docs/secrets.md`: `ROUTER_BASE_URL`, `ROUTER_TOKEN`, `PICKUPS_DATA_KEY`, the R2 write credentials for the tile refresh; `MAP_STYLE_URL` as configuration.
- `docs/questions.md`: the 27 decisions in §10.
- `docs/legal-review.md`: the rows in §12.

---

## 12. Items for legal review

One line each, without analysis, on the owner's instruction [R1]. Appended to `docs/legal-review.md` [R25] as rows 23–38, each with its Area (Data, Licences, Wording or Privacy) and "Where it is decided" (this design's section), one line each, no analysis.

| # | Area | Point to review | Where it is decided |
| --- | --- | --- | --- |
| 23 | Licences | OpenStreetMap data (ODbL) in map tiles and road routing: attribution and share-alike | This design, §3.8 and §6.6 |
| 24 | Licences | OS Open Names and ONS/OS postcode data under the Open Government Licence and OS OpenData terms: attribution | `listing-location.md` task 1.2f; this design, §7.1 |
| 25 | Data | Northern Ireland (BT) postcode data and Land & Property Services licensing | This design, §10 row 14 |
| 26 | Licences | PostGIS (GPL-2.0-or-later) in the database platform, against the dependency licence rule | `docs/decisions.md`, Platform; this design, §1 |
| 27 | Licences | OpenFreeMap's terms, when used as the fallback | This design, §3.8 |
| 28 | Licences | Noto fonts under the SIL Open Font License served as map glyphs | This design, §3.8 |
| 29 | Privacy | Where user origins and pickup points are processed: a router VM in Germany or Finland, or in London, or a hosted routing provider | This design, §6.6 and §10 rows 1–2 |
| 30 | Data | Storing sellers' addresses and agreed times that users enter, and their retention period (extends row 20) | This design, §5.3, §5.6 and §10 row 15 |
| 31 | Privacy | Handing pickup coordinates to Google Maps, Apple Maps or Waze through links the user taps | This design, §6.5 |
| 32 | Privacy | Calendar files containing sellers' addresses, and any subscribable calendar feed | This design, §6.5 and §10 row 18 |
| 33 | Privacy | Using the browser's current location for distance and for re-planning a route | This design, §2.3, §2.7 and §6.4 |
| 34 | Data | Showing town-level places and rounded distances for listings, and the trilateration point | This design, §2.4 and §3.5 |
| 35 | Wording | The wording of "Slightly further away" hints, the "low ask" marker badge and "below the median of N similar asks" (extends row 14) | This design, §4.4 and §10 rows 9–10 |
| 36 | Wording | Showing HMRC rates and the National Living Wage as a basis for a user's trip cost | This design, §4.2 and §10 rows 7–8 |
| 37 | Licences | Google Maps Platform's restriction on use with non-Google maps, if Google routing is ever chosen | This design, §6.2 and §10 row 1 |
| 38 | Privacy | Per-user records of visited listings and of hint impressions logged for calibration | This design, §7.3, §7.7 and §10 row 15 |

---

## Sources

### Web sources

Cited from the researchers' reports. Where a researcher read only a search summary, the text above marks it.

- [1] eBay Browse API specification (sort values: price, distance, newlyListed; pickup filters). https://raw.githubusercontent.com/APIs-guru/openapi-directory/main/APIs/ebay.com/buy-browse/v1.1.0/swagger.yaml
- [2] eBay UK help, using search (sorts; postcode and max distance, default 25 miles). https://www.ebay.co.uk/help/buying/search-tips/use-search?id=4006
- [3] eBay community, "Nearest First Gone" (app). https://community.ebay.com/t5/Mobile-Apps/Nearest-First-Gone/td-p/31289746
- [4] EcommerceBytes, eBay's lowest-price sort (Nov 2024). https://www.ecommercebytes.com/2024/11/12/ebays-lowest-price-sort-function-is-broken/
- [5] ChannelX, how eBay Local works in the UK (map view, postcode and distance, address not shown publicly). https://channelx.world/2024/11/how-ebay-local-works-in-the-uk/
- [6] eBay Inc., search redesign (price graph, unified delivery filters). https://innovation.ebayinc.com/stories/ebay-introduces-intuitive-search-redesign-to-elevate-shopper-experience/
- [7] eBay UK help, saved searches. https://www.ebay.co.uk/help/buying/search-tips/saved-searches?id=4051
- [8] eBay Playbook, filter chip. https://playbook.ebay.com/design-system/components/filter-chip
- [9] Facebook Help, Marketplace sort and filter (not on mobile browsers). https://www.facebook.com/help/248514105820200
- [10] Carsnipe, Facebook Marketplace search by location (approximate radius; results from outside your search). https://carsnipe.com/blog/facebook-marketplace-search-by-location
- [11] PistonHeads forum, promoted adverts outside the search radius. https://www.pistonheads.com/gassing/topic.asp?h=0&f=255&t=2037909
- [12] Baymard, applied filters. https://baymard.com/blog/how-to-design-applied-filters (and https://baymard.com/blog/promoting-product-filters)
- [13] NN/g, applying filters. https://www.nngroup.com/articles/applying-filters/
- [14] Gumtree UK help, searching effectively (and app reviews via https://apps.apple.com/gb/app/gumtree-buy-sell/id487946174). https://help.gumtree.com/s/basics?cat=Searching_Replying&article=Searching-Effectively
- [15] Vinted help, filters and saved searches. https://help.vinted.ca/hc/en-ca/articles/360020072420-Filters-saved-searches
- [16] Autotrader help, price labels. https://help.autotrader.co.uk/hc/en-gb/articles/9491528773533-What-are-the-price-labels-on-adverts
- [17] Rightmove FAQ, search filters. https://faq.rightmove.co.uk/support/solutions/articles/7000100590-how-to-use-the-search-filters-to-find-properties-for-sale
- [18] Airbnb, Learning to Rank for Maps (mini-pins; map bounds as search area). https://arxiv.org/abs/2407.00091
- [19] Airbnb 2023 Summer Release (map changes); community reports on pin states; total-price display (the same price in list and pins). https://news.airbnb.com/2023-summer-release/ ; https://community.withairbnb.com/t5/Ask-about-your-listing/AirBnB-Map-Symbols-Small-Unlabeled-White-and-Gray-Shapes/m-p/1874006 ; https://news.airbnb.com/airbnb-is-introducing-total-price-display-and-updating-guest-checkout
- [20] STR Specialist, Airbnb map view search (split view). https://strspecialist.com/airbnb-map-view-search
- [21] Map UI Patterns, search this area. https://mapuipatterns.com/search-this-area/
- [22] Airbnb Help, approximate listing location. https://www.airbnb.com/help/article/2141
- [23] Department for Education design history, showing search results on a map; radius circles. https://becoming-a-teacher.design-history.education.gov.uk/register-of-placement-schools/exploring-showing-search-results-on-a-map/ ; https://becoming-a-teacher.design-history.education.gov.uk/find-teacher-training/map-2/
- [24] Department for Education design history, map (list first). https://becoming-a-teacher.design-history.education.gov.uk/find-teacher-training/map-4/
- [25] Zoopla help, map view (number pins; 100-result cap). https://help.zoopla.co.uk/hc/en-gb/articles/360006033758-How-can-I-search-for-properties-using-Map-view
- [26] Map UI Patterns, marker and list. https://mapuipatterns.com/marker-list
- [27] Google Maps Platform, accessible markers. https://developers.google.com/maps/documentation/javascript/advanced-markers/accessible-markers
- [28] Material 3, bottom sheets. https://m3.material.io/components/bottom-sheets/guidelines
- [29] Apple Human Interface Guidelines, sheets. https://developers.apple.com/design/human-interface-guidelines/components/presentation/sheets/
- [30] TechCrunch, Airbnb near-miss carousels. https://techcrunch.com/?p=3058110
- [31] Pen Test Partners, trilateration of dating-app users. https://www.pentestpartners.com/security-blog/dating-apps-that-track-users-from-home-to-work-and-everywhere-in-between/
- [32] Scottish Government design system, accessible maps. https://designsystem.gov.scot/guidance/maps/building-accessible-maps
- [33] WCAG 2.2, 2.5.7 Dragging Movements. https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html
- [34] WCAG 2.2, 2.5.8 Target Size (Minimum). https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- [35] 1.4.11 Non-text Contrast. https://www.wcag.com/designers/1-4-11-non-text-contrast/
- [36] WCAG technique ARIA22, status messages. https://w3.org/WAI/WCAG22/Techniques/aria/ARIA22
- [37] WCAG 2.2, 2.4.11 Focus Not Obscured. https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
- [38] Deque, 1.4.13 Content on Hover or Focus. https://dequeuniversity.com/resources/wcag2.1/1.4.13-content-on-hover-or-focus
- [39] MapLibre GL JS, KeyboardHandler. https://maplibre.org/maplibre-gl-js/docs/API/classes/KeyboardHandler/
- [40] MapLibre GL JS, AnimationOptions (reduced motion). https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/AnimationOptions/
- [41] vaul README (unmaintained); shadcn Drawer built on it. https://github.com/emilkowalski/vaul ; https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/components/radix/drawer.mdx
- [42] GOV.UK Design System, accessibility. https://design-system.service.gov.uk/accessibility/
- [43] Benjy Stanton, a plan for accessible maps. https://www.benjystanton.co.uk/blog/a-plan-for-accessible-maps/
- [44] npm registry, `maplibre-gl` (6.11.1, BSD-3-Clause; tarball sizes measured by the map-stack researcher). https://registry.npmjs.org/maplibre-gl ; https://github.com/maplibre/maplibre-gl-js
- [45] MapLibre GL JS changelog (v6: ESM only, WebGL2 required). https://github.com/maplibre/maplibre-gl-js/blob/main/CHANGELOG.md
- [46] MapLibre GL JS install docs (Next.js/Turbopack worker). https://github.com/maplibre/maplibre-gl-js/blob/main/docs/index.md
- [47] npm registry, `@vis.gl/react-maplibre` (8.1.3, MIT). https://registry.npmjs.org/@vis.gl/react-maplibre
- [48] react-map-gl releases (MapLibre v6 support). https://github.com/visgl/react-map-gl/releases
- [49] supercluster (9.1.0, ISC). https://registry.npmjs.org/supercluster ; https://github.com/mapbox/supercluster
- [50] OpenFreeMap README (free, no view limits, no keys, attribution; styles). https://github.com/hyperknot/openfreemap/blob/main/README.md
- [51] OpenFreeMap Terms of Service. https://github.com/hyperknot/openfreemap/blob/main/website/content/policies/tos.md
- [52] OpenFreeMap issues #112–#114 (403s on 2026-05-23). https://github.com/hyperknot/openfreemap/issues/112
- [53] Protomaps docs, cost. https://github.com/protomaps/docs/blob/main/deploy/cost.md
- [54] Protomaps docs, Cloudflare deployment. https://github.com/protomaps/docs/blob/main/deploy/cloudflare.md
- [55] Cloudflare R2 pricing. https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/r2/pricing.mdx
- [56] Cloudflare Workers pricing. https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/workers/platform/pricing.mdx
- [57] Protomaps v4 planet build (UK extract sizes measured with `pmtiles extract --dry-run`). https://s3.us-west-2.amazonaws.com/us-west-2.opendata.source.coop/protomaps/openstreetmap/v4.pmtiles
- [58] OSMF tile usage policy. https://github.com/openstreetmap/owg-website/blob/main/policies/tiles.md
- [59] MapTiler Cloud pricing (reported $25 a month Flex). https://www.maptiler.com/cloud/pricing/
- [60] Stadia Maps pricing (reported $20 a month Starter). https://stadiamaps.com/pricing/
- [61] Ordnance Survey, OS Open Names. https://www.ordnancesurvey.co.uk/products/os-open-names
- [62] OS docs, OS Open Names. https://docs.os.uk/os-downloads/addressing-and-location/os-open-names
- [63] postcodes.io licences (BT commercial licence; place types via its schema). https://github.com/ideal-postcodes/postcodes.io/blob/master/docs/licences.mdx ; https://github.com/ideal-postcodes/postcodes.io/blob/master/docs/place/schema.mdx
- [64] postcodes.io self-hosting. https://github.com/ideal-postcodes/postcodes.io/blob/master/docs/self-host.mdx
- [65] OSMF Nominatim usage policy. https://github.com/openstreetmap/owg-website/blob/main/policies/nominatim.md
- [66] PostGIS `ST_DWithin`. https://postgis.net/docs/ST_DWithin.html
- [67] PostGIS `<->` (KNN). https://postgis.net/docs/geometry_distance_knn.html
- [68] Supabase PostGIS guide. https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/database/extensions/postgis.mdx
- [69] PostGIS licence. https://github.com/postgis/postgis/blob/master/LICENSE.TXT
- [71] npm registry, `@turf/circle` (depends on `tslib`). https://registry.npmjs.org/@turf/circle
- [72] OSRM repository and licence (BSD-2). https://github.com/Project-OSRM/osrm-backend ; https://raw.githubusercontent.com/Project-OSRM/osrm-backend/master/LICENSE.TXT
- [73] OSRM README (MLD default; table-size limits; Mexico build time). https://raw.githubusercontent.com/Project-OSRM/osrm-backend/master/README.md
- [74] OSRM HTTP API (table, route, exclude, scale_factor). https://github.com/Project-OSRM/osrm-backend/blob/master/docs/http.md
- [75] OSRM routed options (DISABLE_ACCESS_LOGGING). https://github.com/Project-OSRM/osrm-backend/blob/master/docs/routed.md
- [76] OSRM car profile (ferries). https://raw.githubusercontent.com/Project-OSRM/osrm-backend/master/profiles/car.lua
- [77] OSRM wiki, disk and memory requirements. https://raw.githubusercontent.com/wiki/Project-OSRM/osrm-backend/Disk-and-Memory-Requirements.md
- [78] OSRM wiki, demo server policy. https://raw.githubusercontent.com/wiki/Project-OSRM/osrm-backend/Demo-server.md
- [79] VROOM repository and licence (BSD-2; v1.15.0). https://github.com/VROOM-Project/vroom ; https://raw.githubusercontent.com/VROOM-Project/vroom/master/LICENSE
- [80] VROOM API (jobs, vehicles, time windows, priority, steps, plan mode, violations, unassigned, matrices). https://raw.githubusercontent.com/VROOM-Project/vroom/master/docs/API.md
- [81] vroom-docker README (image, VROOM_ROUTER). https://raw.githubusercontent.com/VROOM-Project/vroom-docker/master/README.md
- [82] vroom-express config (maxlocations, logdir). https://raw.githubusercontent.com/VROOM-Project/vroom-express/master/config.yml
- [83] Valhalla (MIT); optimized_route docs. https://github.com/valhalla/valhalla ; https://github.com/valhalla/valhalla/blob/master/docs/docs/api/optimized.md
- [84] GraphHopper README (matrix and optimisation are commercial). https://github.com/graphhopper/graphhopper
- [85] openrouteservice licence (GPL-3.0). https://github.com/GIScience/openrouteservice/blob/main/LICENSE
- [86] Google OR-Tools. https://github.com/google/or-tools
- [87] Google Route Optimization usage and billing. https://developers.google.com/maps/documentation/route-optimization/usage-and-billing
- [88] Google Maps Platform service-specific terms. https://cloud.google.com/maps-platform/terms/maps-service-terms/index-20240522
- [89] Mapbox Optimization API v1. https://docs.mapbox.com/api/navigation/optimization-v1/
- [90] Geofabrik, Great Britain extract. https://download.geofabrik.de/europe/great-britain.html
- [91] Hetzner price adjustment (2026). https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
- [92] AWS Price List API, Lightsail eu-west-2 offer file (2026-09-15). https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonLightsail/20260915151951/eu-west-2/index.json
- [93] Google Maps URLs (waypoint limits; quoted via https://github.com/jambot24/routesnap/blob/b25e38b4005ebca2257ae9e83ac89d2c348b7b09/routesnap_prd.md). https://developers.google.com/maps/documentation/urls/get-started
- [94] Apple MapKit unified map URLs. https://developer.apple.com/documentation/mapkit/unified-map-urls
- [95] Waze deep links. https://developers.google.com/waze/deeplinks
- [96] `ics` library (ISC; fields UID, SEQUENCE, alarms). https://github.com/adamgibbons/ics ; https://registry.npmjs.org/ics/latest
- [97] RFC 5545, iCalendar. https://tools.ietf.org/html/rfc5545
- [98] HeiGIT / openrouteservice plans. https://account.heigit.org/info/plans
- [99] GOV.UK simplified-expenses calculator code (55p from 2026–27). https://github.com/alphagov/smart-answers/blob/main/lib/smart_answer/calculators/simplified_expenses_checker_calculator.rb ; and https://www.gov.uk/government/publications/increase-to-approved-mileage-allowance-payments-amaps-and-self-employed-simplified-mileage-rates/increasing-mileage-rates
- [100] HMRC advisory fuel rates from 1 March 2026, via a GOV.UK page snapshot. https://www.gov.uk/guidance/advisory-fuel-rates ; https://github.com/0x4D44/readex/blob/main/benchmark/corpus/snapshots/9ec7aaf8edb71ac1.html
- [101] GOV.UK minimum wage rates file (National Living Wage £12.71 from April 2026). https://github.com/alphagov/smart-answers/blob/main/config/smart_answers/rates/minimum_wage.yml
- [102] Lovelace, thesis chapter 5 (circuity: Ballou 2002, Cole 1968, Levinson and El-Geneidy 2009). https://github.com/Robinlovelace/thesis-reproducible/blob/3ee03098e9186c302a2d1bc5a85b3d7bc33a1417/Chapters/Chapter5.tex
- [103] Circuit/Spoke stops API (timing, notes, activity, optimisation order, payment on delivery). https://github.com/api-evangelist/circuit/blob/6c989a045afccafd5ad0345d2147f2e5f01f30d2/openapi/circuit-stops-api-openapi.yml
- [104] Route4Me address schema (time windows, MEETUP stop type). https://github.com/route4me/route4me-json-schemas/blob/master/Address.json
- [105] Route4Me route parameters (lock_last, disable_optimization). https://github.com/route4me/route4me-json-schemas/blob/master/RouteParameters.json
- [107] Fuel Finder API notes. https://github.com/hoyla/fuel-finder/blob/main/README.md
- [109] Popular Science, Airbnb tricks ("Redo search in this area" in the app). https://www.popsci.com/best-airbnb-tricks/
- [110] react-native-maps, AnimatedViews example (swipeable bottom cards synced with markers). https://raw.githubusercontent.com/react-native-maps/react-native-maps/master/example/src/examples/AnimatedViews.tsx
- [111] shadcn/ui sidebar (`SIDEBAR_WIDTH = "16rem"`, `SIDEBAR_WIDTH_ICON = "3rem"`). https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/v4/registry/new-york-v4/ui/sidebar.tsx
- [112] Protomaps basemaps-assets README (fonts SIL Open Font License; sprites derived from MIT-licensed tangrams/icons). https://github.com/protomaps/basemaps-assets ; https://raw.githubusercontent.com/protomaps/basemaps-assets/main/README.md
- [113] npm registry, `@protomaps/basemaps` (5.7.2, BSD-3-Clause). https://registry.npmjs.org/@protomaps/basemaps
- [114] PMTiles and go-pmtiles licences (BSD-3-Clause). https://github.com/protomaps/PMTiles ; https://github.com/protomaps/go-pmtiles
- [115] vroom-express 0.12.0 source (request body written to `logdir` before each solve; HTTP 500 on write failure; `access.log` in the same directory) and licence (BSD-2-Clause). https://raw.githubusercontent.com/VROOM-Project/vroom-express/master/src/index.js ; https://raw.githubusercontent.com/VROOM-Project/vroom-express/master/LICENSE
- [116] osrm-routed options source (`--algorithm` defaults to CH; `--mmap` "Map datafiles directly, do not use any additional memory"). https://raw.githubusercontent.com/Project-OSRM/osrm-backend/master/src/tools/routed.cpp
- [117] Protomaps docs, MapLibre basemaps ("you'll need not only a style and a tileset, but also MapLibre fontstack and spritesheet assets"). https://raw.githubusercontent.com/protomaps/docs/main/basemaps/maplibre.md

### Repository and scratchpad sources

- R1 `/home/user/nabvy/docs/decisions.md`: Precedence rows "Location precision", "Price wording", "Labels and scores", "Per-user work"; "Search, map and pickup features"; "Beta coverage and Apify budget"; "Atomic modules"; "Legal review on request only"; Platform ("Database", eu-west-1).
- R2 `/home/user/nabvy/docs/web-app.md`.
- R3 `/home/user/nabvy/docs/modules.md`.
- R4 `/home/user/nabvy/docs/dashboards.md`.
- R6 `/home/user/nabvy/services/source-adapters/README.md`.
- R7 `/home/user/nabvy/docs/fb-actor-reference.md`: §2.1 radius, §3 location fields, §5.1 feed reach and contents, §9.1 seed, §11 Q1.
- R8 `/home/user/nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json`.
- R9 `/home/user/nabvy/fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/run-summary.json` (centre 50.836, −0.775).
- R10 `/home/user/nabvy/docs/backlog.md`.
- R11 `/home/user/nabvy/docs/contracts.md` (`Hunt`, tables by owner).
- R12 `/home/user/nabvy/packages/contracts/src/core/listing-stub.ts` and `enums.ts`.
- R15 `/home/user/fb-scrap-engine/docs/data/city-pages.seed.json` (on the owner's reading list).
- R16 Scratchpad, computed:
  - `filters-fixture-distances.csv` (distances from coarse coordinates);
  - `map_ux_fixture_check.out.txt` (coarse grid);
  - `town_points.py` (seed-point against coarse distances);
  - `hint_defaults.py` (worked hint numbers);
  - `pickups/worth_trip.py` (the pickups researcher's numbers);
  - `dp_tw_bench.mjs` (exact subset dynamic programme with hard time windows, service times and priorities: 12 stops in about 10.5 ms on Node 22, 49,152 states).

  All are in `/tmp/claude-0/-home-user-nabvy/6ec97e4b-b0e8-55d8-9880-b19e4f1f389e/scratchpad/geo/`.
- R17 `/home/user/nabvy/docs/secrets.md` (`POSTCODES_IO_BASE`).
- R18 `/home/user/nabvy/packages/db/README.md` (one schema per module; `v_` views).
- R19 `/home/user/nabvy/docs/handoff.md` (4.1c assigned to PR #10, lines 58 and 129; Cloudflare DNS for 0.5a, line 139).
- R20 `/home/user/nabvy/docs/design/drafts/modules.md` (the module catalogue draft: `switches`, `location`, `city-pages`, `listing-card`, `listing-suppression`, `spec-match`, `alert-router`, `want-manager`, `product-events`, `asking-price-position`; rule 11 on suppression and switches).
- R21 `/tmp/claude-0/-home-user-nabvy/6ec97e4b-b0e8-55d8-9880-b19e4f1f389e/scratchpad/location/listing-location.md` (tasks 1.2f, 1.5l–1.5o and its consumer 4.1c; `app.v_listing_location` §4.3; `crossing`; precision values).
- R22 `/home/user/nabvy/docs/design/drafts/listing-reuse.md` (`gem-finder`; its 1.3a and 4.1c).
- R23 `/tmp/claude-0/-home-user-nabvy/6ec97e4b-b0e8-55d8-9880-b19e4f1f389e/scratchpad/tgtbt/too-good-to-be-true.md` (its 4.1d).
- R24 `/tmp/claude-0/-home-user-nabvy/6ec97e4b-b0e8-55d8-9880-b19e4f1f389e/scratchpad/atomic/actor-integration.md` §6 (1.3a–1.3d reserved).
- R25 `/home/user/nabvy/docs/legal-review.md` (columns "# | Area | Point to review | Where it is decided"; rows 1–22).
- R-map-ux: the map-ux researcher's findings on Rightmove's "same actions in list and map" and Google Maps saved lists. Underlying sources: https://www.rightmove.co.uk/news/articles/property-news/you-can-now-see-saved-searches-in-map-view-on-my-rightmove/ and https://9to5google.com/2023/09/06/google-maps-saved-places-icon-emoji/

## Owner additions (2026-09-24)

Recorded by the coordinator from the owner's instructions; they take precedence over this draft where they differ (`docs/decisions.md`, "Watching is metered, prices are dynamic").

1. **Radius is the user's.** The user sets it freely and can change it at any time; there is no fixed cap. §4's band and hints stay, and a second, aggregate hint is added: when enough clean, matching listings sit in a ring just beyond the radius, the feed and the want screen offer "Widen to N mi to see M more matching deals" (M counted over the last 7 days, n≥3 as a starting value), with one tap to accept and the credit estimate for the new radius shown first. Nabvy never widens a radius itself.
2. **Deal hot spots.** A map layer, off by default and one tap to show, that shades where deals concentrate. It is built only from town display points (§3.5; never a listing's coordinates), weighted per town by the count of clean, product-matched listings asking below their comparable median (n≥10, as `asking-price-position` requires), over 7 or 30 days. It is drawn with MapLibre's built-in heatmap layer, so no new dependency. With a want selected it counts only that want's matches; without one, all matching deals in view. Hot spots outside the ring feed the widen hint in 1. The layer has a list alternative ("Top areas for deals") for accessibility.
