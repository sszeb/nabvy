# `listing-location`: where an item really is (condensed)

Condensed from `docs/design/drafts/listing-location.md` (draft, coordinator/owner, 2026-09-24), the whole draft treated as notes, not decisions.

## One-screen summary

New module, "Listing intelligence" group. For every listing version it resolves the pickup area from the listing's location field *and* its title/description (rules first, AI at most once per version, shared, on redacted text, validated by Zod), and publishes only a town/area/postcode-district with a confidence flag — never a precise point, full postcode or street. It answers the owner's two failure modes: a location only stated in the text ("collection from Bognor"), and a wrong or autofilled field. The catalogue already carries a placeholder card, `pickup-location`, covering roughly the draft's sections 1–4 (signals, resolution pipeline, outputs); this document folds in sections 5–7 and the backlog. Consumers (distance filters, the map, worth-the-trip hints, the pickup planner, alerts, search planning, "too good to be true") all read the resolved display point or the user-facing view, never coordinates. The same field-vs-text-vs-AI pattern is proposed as a reusable shape for `parts-rules`/`parts-ai`/`parts-record`, without merging the modules.

## Decisions and defaults the draft takes

- Rules run first; AI runs at most once per listing version, shared across users, only on the `quote-redaction` copy of the text, output validated against a Zod schema before use.
- Precise points, full postcodes, street names and raw mention text stay internal (`listing_location` schema); only town/area/district reaches a `v_` view or user output.
- Distance and radius are always measured from the resolved **display point** (a gazetteer centroid), never from listed coordinates — mitigates trilateration risk from rounded-coordinate distance queries.
- A landmass mismatch ("ferry crossing") is flagged; worth-the-trip hints never cross one and are offered only for non-approximate statuses.
- Map markers group by area (one pin per area, count + price range); a conflicting listing appears once, at the text place, with "Listed in X".
- The pickup planner gets a **read-only** area hint only; it never fills or suggests an address, and addresses/times stay user-entered, private, and outside any view.
- No per-postcode table: reference data stops at postcode sector/district level (a design choice, not a decision needing the owner — avoids storing ~2.7M precise geocodes).
- Northern Ireland (BT) postcode data is **not loaded** (commercial-use licence gap); NI resolves at town level from OSNI place names only.
- A seller-level location signal is **not built** (needs `seller-key`, itself off in this push).
- Switch path: `off` → `shadow` (once rules ship, task 1.5l) → `on` (after calibration on ≥200 labelled cases and the owner's wording approval, task 1.5o).
- Generalisation to parts (§6): shared *pattern*, not shared code paths beyond a proposed pure-function package `@nabvy/listing-text` (text normalisation, span/window utilities, quote verification, the model-call wrapper) — not yet built; until it exists `listing-location` keeps its own copy and reads no `parts-rules` file. One soft read only: `parts-rules.v_tag_blocks`, to skip keyword-stuffing blocks; carries on without it.

Where the draft touches wording, pricing, tiers or anything else a user sees, it is **not** treated as decided here — see Questions below.

## Modules the draft defines or changes

- **`listing-location`** (new) — resolves listing location from field + text + AI; publishes town/area only. The catalogue's `pickup-location` placeholder is this module under an earlier working name; the draft's own schema (10 tables, view-based consumer access) is materially richer than the current card — needs coordinator reconciliation.
- **`location`** — gains the UK gazetteer reference data (postcode districts/sectors, OS Open Names places, OSNI places, region polygons, aliases, stop-list), `distanceKm()` becomes point-to-point only (never reads listing coordinates), plus `pointForCityPage()`, `nearestDisplayPlace()`, `landmassFor()`; `pointForPostcode()` moves to sector-table lookup, dropping postcodes.io from the write path.
- **`listing-card`** — town-label column becomes `area_label`, falling back to the ingest label when the module is off.
- **`spec-match`** — distance/inclusion sourced from `app.v_listing_location` (or the §5.8 fallback), re-evaluates on `listing-location.changed`, never restricts candidates to the search centre that found them.
- **`alert-router`** — alerts follow the §5.1/§5.5 inclusion rule; unknown-distance listings never alert on a distance criterion.
- **`listing-ingest`** — `card-changed` also fires when the town label or city page changes.
- **`detail-evidence`** — new `detail-evidence.location-moved` event when coordinates move without the evidence hash changing (location sits outside that hash on purpose).
- **`output-guard`** — gains location-specific checks (no coordinates finer than display points, no inward postcodes, in user-facing output).
- **`quote-redaction`** — `redact()` extended to mask full postcodes robustly (case, spacing, O/0, I/1) and house-number-plus-street-name text, not just phone/email/handle/link; today's version is upper-case only and would leak a street address.
- **`warning-signs` / `suspected-labels`** — read the location conflict and handover facts as one evidence line, shown to users only while `listing-location` is `on`.
- **`parts-rules` / `parts-ai` / `parts-record`** — no code change; share the resolution *pattern* only (§6), plus the proposed `@nabvy/listing-text` helper package once the coordinator builds it.

## What stays open

- **Owner wording** for every status, chip, note and the global disclaimer (§4.3) — nothing user-facing ships until approved; shown only in shadow/founder-only screens until then.
- Distance units/rounding, smallest place ever shown, whether a strong text place beats the field for distance, where a conflicting listing sits on the map, radius inclusion for uncertain/conflicting listings, whether those alert, how an unstated location is grouped, whether user reports can move a location, Northern Ireland postcode licensing, a future seller-level signal, pickup-planner scope, where attribution appears, go-live timing, the Derry/Londonderry label, and whether a location conflict alone may support a "too good to be true" mark — 17 items in all, each with a recommended (conservative) default used only in shadow. Recorded as owner questions, not decided here.
- A shared `@nabvy/listing-text` foundation package is proposed but not built; `listing-location` and the parts modules keep separate copies of shared helpers until the coordinator creates it and checks they agree.
- Reconciling the module's name/identity: catalogue card `pickup-location` vs. the draft's own `listing-location`, and the placeholder card's much thinner schema (2 tables, an exported `pointsFor()` function) against the draft's fuller design (10 tables, direct view reads by every consumer). See the integration scratchpad's amendment list for the specific deltas found.
- 12 legal-review points, listed only (no analysis): storing full postcodes/street/premises text internally; showing a description-derived area to users; using a location conflict as fraud evidence; keeping and reverse-geocoding Facebook's grid coordinates; distance/radius as a re-identification vector; NI (BT) postcode licensing; OGL/CC BY attribution; sending redacted text to the AI provider; a possible future seller-level signal; the planner's read-only area hint; redaction gaps in the gateway's current masking; PostGIS's GPL-2.0-or-later licence used as a managed extension.
