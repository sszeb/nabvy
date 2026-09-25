# @nabvy/pickup-location

Resolves where an item really is from every signal in the listing (the location field, and the place names and postcodes in its title and description), keeps the precise evidence internally, and publishes only the town or area, marked approximate when uncertain (`docs/design/modules/pickup-location.md`; `docs/decisions.md`, "Where an item really is").

## Switch and priority

- **Default `off`.** Off, readers get listing-ingest's raw town label snapped to its city page's point through `pointsFor()`, marked approximate, basis `fallback`; no text-derived place, conflict or handover fact is shown. In `shadow` the internal views fill and every user-facing reader (`app.v_pickup_location`, `pointsFor()`) gives exactly what `off` gives. `on` shows rows. The AI lane stays off with `parts-ai` (question 12): versions the rules cannot settle are queued in `ai_queue` and nothing calls a model.
- **Priority:** MVP, critical-path priority [cp 7] (`docs/decisions.md`, "Where an item really is"; the card).

## Inputs

- Events: `detail-evidence.changed` (the `detail` pass), `listing-ingest.first-seen` (the `card` pass).
- Views: `listing_ingest.v_listings` (title, town label, city page, delivery types, card hash), `detail_evidence.v_current` and `v_text` (evidence hash, text, coarse coordinates), `city_pages.v_city_pages` (the gazetteer: page names, towns and points).
- Functions: `location.pointForPostcode()` (a text postcode's point; cached, postcodes.io behind location's switch), `location.distanceKm()` (every distance in this module), `quote-redaction.redact()` (every stored quote), `listing_suppression.is_suppressed()` (the user-facing view), `switches.state()` and `is_on()`.
- Soft, not read in this push: `parts_rules.v_tag_blocks` (this module skips hashtag lines with its own rule), `product-catalogue`'s alias view (the stop-list is a fixed list here).

## Outputs

- Events: `pickup-location.resolved` (listing IDs resolved by a call) and `pickup-location.changed` (listing IDs whose user-visible area, status, note, conflict or handover moved). Payloads carry listing IDs only.
- Internal views (`nabvy_pipeline`): `pickup_location.v_areas` (listing_id, town_or_area, approximate, conflict, basis, status); `v_evidence` (mentions and candidates: role, cue, strength, gazetteer label, rejection, the redacted quote and its offsets; review-console only); `v_handover` (collection, meetup_offered, local_delivery, postage, delivery_only_text, postage_only_text, courier_only_text); `v_ai_usage` (the AI queue).
- User-facing view (`nabvy_app`): `app.v_pickup_location` with exactly `listing_id, town_or_area, approximate, area_id, area_district, area_landmass, status, source, note_code, note_place_label, listed_in_label, lat, lng, uncertainty_km, collection, meetup_offered, local_delivery, postage`. Rows only while this module and `listing-suppression` are `on`, never a suppressed listing, never a listing with no area. `lat`/`lng` are the display point (a gazetteer centroid), never the listing's coordinates; `area_district` is a whole postcode district at most.
- Functions: `run(q, { pass, listingIds }, deps?)`; `pointsFor(q, listingIds)` (the point to measure distance from, for `spec-match`, `notifier` and procedures; on: the resolved display point, otherwise the fallback above); `applyOverride(q, override)` (review-console); `erase(q, listingIds)` (seller-rights); `currentRuleVersion()`.

## Tables

| Table | Key columns | Unique |
| --- | --- | --- |
| `resolutions` | listing_id, pass, evidence_hash, rule_version, status, basis, source, confidence, conflict, approximate, town_or_area, area_id, area_district, lat, lng (display point), note_code, listed_in_label, field_label, field_lat, field_lng, field_distance_km, ai_eligible, input_fetched_at, done_at | (listing_id, pass, evidence_hash, rule_version) |
| `candidates` | resolution_id, seq, kind, value (as found; a full postcode stays here), label, area_id, lat, lng, role, cue, strength, rejection, field_distance_km | (resolution_id, seq) |
| `mentions` | resolution_id, seq, candidate_seq, source, quote_start, quote_end, quote_redacted, role, cue, strength | (resolution_id, seq) |
| `current` | listing_id (PK), resolution_id, pass, evidence_hash, and the resolution's user-visible columns | listing_id |
| `handover` | listing_id (PK), evidence_hash, collection, meetup_offered, local_delivery, postage, the three `*_only_text` flags | listing_id |
| `overrides` | listing_id (PK), area_id, town_or_area, lat, lng, by, reason | listing_id |
| `ai_queue` | listing_id, evidence_hash, reason, queued_at, done_at | (listing_id, evidence_hash) |

Not built in this push (the card's fuller list): `page_stats`, `ai_calls`, `quarantine`. They belong to the AI lane and `search-planner`, both later (`docs/questions/pickup-location.md`).

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Batch size | 500 listing IDs | rule 7 | fixed |
| `agreeKm` | 10 km | draft §3.6: text places lay within about 2.5 km of the coordinates; label error up to 11.6 km | starting value |
| `conflictKm` | 25 km | draft §3.6: above the largest label error, about the spacing of UK towns | starting value |
| `deliveryFarKm` | 100 km | draft §3.6 row 9a (estimate) | starting value |
| Cue window | 40 characters before a mention | draft §3.4 | starting value |
| Candidates per version | 20 | draft §7.1 | starting value |
| Decision table | rows 1–4, 5, 6, 7, 8 (a, c, d, e), 9, 9a and 10 of draft §3.6, with `location.distanceKm()`'s 5 km rounding | draft §3.6 | rules; row 5a (an outdated description) not built |
| Cues | `src/domain/index.ts`, `CUES`: origin, delivery area, pickup, seller base, meetup, near, "area" after the place, a bare "in/from/at" (medium) | draft §2.3 | starting value |
| Stop-list | 23 English words that are also place names; counted only with a cue | draft §3.3 | starting value |
| Tag blocks | a description line with three or more hashtags is skipped | parts-rules' rule | starting value |
| Handover | field first (`IN_PERSON` → collection yes; a shipping type → postage field); text adds and never overrides | draft §2.4 | starting value |

## Fixtures and pass rate

Stage `resolve`, 7 synthetic cases built from the recorded run's first listing (`fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k`, listing 1816901372840238) with title, description, location, page, coordinates and delivery types replaced, run through listing-ingest and detail-evidence on the real migrations in PGlite over the seeded city pages: the Chichester field with "collection from Bognor" (a recorded conflict, shown at Bognor Regis); a postcode in the text (never in any view, district only); the town-label fallback; the display point is the page centroid, not the listing's coordinates; a conflicting listing appears once, at the text place; the handover facts; no field and no text. Every case also checks every view for the postcode and its inward code and that no shown point equals a listing's coordinates. **Pass rate: 7/7 (100%)**, `test/fixtures/pass-rates.json`. Domain tests cover the cues, the thresholds at 10 and 25 km, and the handover rules; the switch test shows `shadow` gives `pointsFor()` results identical to `off`.

## Decisions

- **2026-09-25: the gazetteer is city-pages.** `location` carries no gazetteer yet (the draft's `nearestDisplayPlace()`, `pointForCityPage()` and `landmassFor()` are not built), so the allowed display places are the city pages' names (the part before the first comma) and their towns, all at the page's point. A two-word label's first word is an alias when it has six letters or more and is not stop-listed ("Bognor" for "Bognor Regis"). Names shared by several pages are settled by the field (same page, else nearest to the field point); shared names on one page or one point are one place. `area_landmass` is null and `uncertainty_km` is null until `location` carries the data. A page without a point (as Chichester in the seed) is a display place with no point, so a listing there is `field_only`, approximate, and absent from the user-facing view until the page gains a point.
- **2026-09-25: "conflict" is a recorded disagreement, `conflicting` a status.** The card's Bognor case wants a conflict; the draft's row 4 wants no flag for a place 10–25 km away. `conflict` is true whenever the text place and the field disagree (beyond `agreeKm`, or on another page when no distance can be measured); the status is `from_description` up to `conflictKm` and `conflicting` beyond it. `suspected-labels` reads the flag.
- **2026-09-25: a text postcode is never a display point.** Its point (from `location.pointForPostcode()`, injected in tests) decides agreement; what is shown is the nearest gazetteer place within `conflictKm` and the whole district in `area_district`. The full postcode stays in `candidates.value`; the stored quote passes through `redact()` first.
- **2026-09-25: two passes, one current row.** The `card` pass (title and town label, from `first-seen`) resolves early and never sends anything to AI or marks `conflicting`; the `detail` pass replaces it and never gives way to a later card pass. Among detail passes a newer input (`v_current.last_seen_at`) replaces an older one, never the reverse. The idempotency key is (listing, pass, evidence hash, rule version).
- **2026-09-25: distances use `location.distanceKm()`**, which rounds to 5 km, so agreement means a rounded 10 km or less (a raw 12.4 km agrees) and conflict a rounded 30 km or more. The module computes no distance of its own (the card).
- **2026-09-25: the user-facing view is guarded twice.** `app.v_pickup_location` is `security_invoker` over `current` and `handover`; `nabvy_app` gets column-level select on exactly the shown columns and a row-level policy with the same switch, suppression and area conditions as the view, so a direct table read shows no more than the view. Schema `app` is created idempotently here; backlog 0.9e extends `view_violations()` to it.
- **2026-09-25: the AI lane is a queue only.** `PickupLocationOutput` fixes the model output shape (facts and text, strict); `ai_queue` records the versions the rules could not settle (`uncertain`, `delivers_elsewhere`); no caller talks to a model, no `cost-meter` or `spend-governor` call exists yet.
- **2026-09-25: an override is a gazetteer area.** `applyOverride()` takes an `area_id`, moves the current row to that place's point (`decided_by = 'review'`, `confirmed`, not approximate) and is applied again on every later pass.

## Open questions

`docs/questions/pickup-location.md`.

## Incidents

None.
