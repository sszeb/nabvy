# Listing reuse: shared pool, price learning, cross-hunt matching, gems and similar picks

**Condensed from `docs/design/drafts/listing-reuse.md` (design draft, 2026-09-24).** Implements "Every listing is reused" (`docs/decisions.md`, owner's decision, 2026-09-24). The draft is notes, not decisions; where it decides a product matter (wording, categories, what users see), that is recorded as an owner question below, not shipped as a default.

## Summary

Every listing Facebook returns — on-target or by-catch — joins one shared pool: it prices its own product, it is matched against every user's want (not only the hunt that found it), and, if its ask sits far enough below its own group's comparable asks, it can become a "gem" (badged "Top pick") or a curated "similar alternative" for another hunt. No extra Apify spend: by-catch never triggers a new search, term or page. Two new modules (`gem-finder`, `similar-picks`) and targeted additions to thirteen existing ones carry this out. Gem and alternative wording, and the default scope of alternatives, are drafted but unconfirmed — see "What stays open".

## Decisions the draft makes, and the defaults it takes

- **Shared pool, no extra cost.** Every sighting feeds price data for its own product and is matched against `v_want_parts` regardless of which hunt's search found it. `search-planner` and `check-scheduler` are unchanged: by-catch never adds a term, a page or a run.
- **Gem definition.** A group-level statistic, not a listing-level one: n≥10, leave-one-out, relist and copy-advert collapsed to one member. Position p≤0.10; robust z≤−1.5 (median/MAD, MAD floored at 5% of median); ask≤0.75×median; dispersion guard IQR/median≤0.6; a by-catch-eligibility guard (a group needs at least one `on_target` member — a 100%-by-catch group never mints a gem, however well it scores statistically). Staleness: at least 3 of a group's asks seen in the last 7 days; a candidate first-seen or price-dropped within 48h with an available lifecycle status; a badge drops out after 72h or on an unknown status. All are starting values, calibrated in shadow on the rtx3090 hunt.
- **Gem/veto coordination.** `warning-signs`' "far below" veto must stay strictly more extreme (at or below 0.6×median) than `gem-finder`'s 0.75×median cutoff, so the veto range sits entirely inside, never straddling, the gem range — checked explicitly at the end of the shadow run, not assumed from the starting values alone.
- **Detail-fetch gate.** Every gem candidate needs a full description before badging. An ambiguous candidate enqueues to a capped `gem-confirm` lane (starting cap 2% of the $150 monthly cap, about $3.00/month; priority below pasted links, above routine selection), deduplicated by the standard idempotency key; at the cap it stays unbadged but still matched and positioned.
- **Cross-hunt fairness.** One `alert-router` release batch per listing version; every matching user's alert is created in that same batch, send order shuffled per batch, no tier-based delay — the hunt that triggered the run gets no priority.
- **By-catch counted in positions.** Included, with `sample_origin` (`on_target`/`by_catch`) stored per member; a bias note is added when a group's by-catch share is 50% or more; `ops-metrics` compares on-target vs. by-catch medians and escalates a gap over 15% (in many groups) to the owner.
- **Similarity is curated, not computed.** A `similarity` section in the category pack (three relations: variant, tier, containment; each entry carries a curator, a date and a worded rationale). No numeric performance field — enforced by the pack schema and an `output-guard` CI check that fails on "% faster", "faster than", "worth" or "fair value" in `app.` views. Each alternative is priced in its own group, never against the hunted product's asks.
- **Backfill window.** A new or edited want backfills matches against listings first seen within 7 days; shown in-app and in the next digest only, never as an instant alert.

## Modules it defines or changes

New:
- **`gem-finder`** (Listing intelligence) — scores positioned listings from the pool against the gem checks above; ships in shadow, stays there while "Too good to be true" is in shadow.
- **`similar-picks`** (User features and delivery) — curated cross-hunt alternatives (variant, tier, containment) per hunt, each priced in its own group; not the same module as `similar-items`.

Changed (full cards/amendments in the integration scratchpad):
- **`listing-ingest`** — records the finding term and centre on each sighting.
- **`details-selector`** — selects details candidates against all active wants, not only the triggering hunt, within the existing budget.
- **`details-queue`** / **`spend-governor`** — add the capped `gem-confirm` lane and its budget share and priority.
- **`parts-rules`** — drops hunt/term context from extraction; normalises `+`-encoding in descriptions as well as titles.
- **`parts-ai`** — runs on by-catch only within pack categories; other by-catch gets rules only.
- **`asking-price-index`** — adds `sample_origin` per member; median, MAD, IQR in `stats`; an internal `v_group_health` view.
- **`asking-price-position`** — adds an internal robust z-score to `v_positions` (never surfaced in an `app.` view).
- **`listing-assessment`** — form classification scans the full description, not only the title, for undeclared bundle contents.
- **`noise-filter`** — adds headset and repair-service fixtures.
- **`warning-signs`** — publishes its far-below threshold in a view for `gem-finder` to read.
- **`spec-match`** — backfills on `want-manager.changed`; records `match_origin` (`own_search`/`other_search`) per match.
- **`alert-router`** — one release batch per listing version (the fairness rule above).
- **`want-manager`** — adds per-hunt alternative controls (scope, PC containment, max price, instant-alert toggles).
- **`product-catalogue`** — adds `v_similar`, resolved from the pack's similarity section.

## What stays open

- **Wording and default scope are owner questions, not decisions** (two new entries in `docs/questions.md`): the "Top pick" badge, the position line, the by-catch bias note, the hunt-page "While hunting your … we also found …" line and relation labels; and the default scope of alternatives (instant alerts, PC containment, who sees top picks).
- **`listing-location`.** The draft's §2 and §4 cite a module `listing-location`; coordinator decision (2026-09-24): this is the catalogue's `pickup-location` module under the draft's own working name.
- **`want-manager`'s per-hunt controls don't fit its current per-user `preferences` table.** A shape decision (extend `wants`/`criteria`, or add a per-want preferences table) is needed before task 1.8d starts; flagged, not resolved, in the integration scratchpad's amendment.
- **Who curates the first similarity list.** Default: the pack author drafts, the owner approves the first gpu-pc list — that approval has not happened yet.
- **All statistical thresholds** in "Gem definition" above are starting values, pending shadow calibration on the rtx3090 hunt.
- **Four legal points**, no analysis, added in `docs/legal-review.md`'s format in the integration scratchpad: showing one user's hunt result to other users; "Top pick"/position-line wording and consumer protection; GPU model and brand names in relation labels (nominative trade mark use); description text used for gem checks staying town/area-level only.
