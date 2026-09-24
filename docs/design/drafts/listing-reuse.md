# Every listing is reused: the shared pool, gems and similar picks

**Design draft, 2026-09-24.** Implements "Every listing is reused" (`docs/decisions.md:167-171`) on the atomic-module catalogue (`SP/atomic/modules.md`; SP is this session's scratchpad). All thresholds are **starting values**, calibrated in shadow on the rtx3090 test hunt, unless marked as fixed by a decision.

## 1. What the real data shows

Nabvy's store has one real listing run: job 6 in `apify_gateway.jobs`. It was a `gaming pc` search in Chichester, newest first, page 1, with details, and returned 20 listings for $0.0177 settled. The recorded fixture is `fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/`. No real `rtx3090` run is stored yet. Counts come from aggregate SQL over `apify_gateway.items`:

| Finding | Count |
| --- | --- |
| PCs or PC bundles | 17 of 20 |
| Off-target by-catch: gaming headsets (£95, £50) and a "Builder and repair" service (£25) | 3 |
| PCs that name a GPU | 14 of 17: 7 in the title, **7 only in the description** |
| Distinct GPU models among those 14 | **11** (GTX 970 ×2, 1080, 1650, 1660, 1660 Super, RTX 2070 Super, 3060 Ti, 3070 ×2, 3090 Ti, 5060, 5070 ×2) |
| PCs sold as bundles with a monitor or peripherals | 6 |
| Listings in categories other than "Electronics & computers" (Miscellaneous, Video Games, Household) | 3 |
| Title arriving URL-encoded (`MSI+AlphaSync+GTX+1660…`) | 1, description too |

Corrected from a first, manual read that undercounted both rows above (13 of 17, one bundle model unmarked as ×2; and 3 bundles). Both are now asserted straight from `fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/dataset.json`, not re-typed by hand, so a future re-derivation can't silently drift (pinned as a fixture assertion, §8). The seventh description-only GPU is "Mid-range Gaming PC - specs in description" (£750), whose description names "MSI SURPRIM 3070 8GB" — a second, independent RTX 3070 ask alongside the Lenovo Legion's (title, £400), hence 3070 ×2.

The six bundles: "Gaming PC bundle" (£200, keyboard and mouse in the description; "bundle" in the title); "Gaming PC Bundle - Gaming PC + Monitor + KBM" (£400; "Bundle" and "Monitor" in the title); "Gaming pc and curved Samsung monitor" (£1,300; "monitor" names itself in the title, even with no "bundle" word) — and three where the title gives no clue at all: "Gaming PC" (£2,500, Video Games category — description only: "Comes with; -Logitech mouse -Corsair k70 keyboard -LG 34inch curved ultra wide monitor"); "HP Omen gaming pc" (£530 — description only: "Also comes with G-Lab keyboard and mouse"); and "High end gaming pc with everything shown!!!!!!" (£2,000 — description only: "comes with everything pictured desk, gaming chair, razor v4 pro mouse, steel series apex pro mini [keyboard], artisan zero mouse pad, Samsung g7 odyssey 240hz monitor with monitor arm"). Those three never name "bundle", "monitor" or any peripheral anywhere in the title; their extras surface only inside the description's spec or item list, so a form classifier that reads the title alone — even one that also matches "monitor" or "bundle" as keywords, not only the literal word "bundle" — files all three as plain "PC", and their monitor- and keyboard-inclusive price contaminates the bare-PC group for RTX 5070 and generic-RTX: exactly the "bundle priced as one part" false-gem risk this design exists to prevent.

The actor's evidence points the same way. Only 9% of a `3090` feed mentioned 3090 (`docs/fb-actor-reference.md:490`, citing EVIDENCE_LEDGER.md:121-123).

**So:** by-catch is the majority of every run; it spreads at about one ask per product per run, so groups fill across runs, centres and days; many products show only in the description; form (card, PC, bundle) must be separated before grouping; and Facebook's category is no filter. The £1,650 RTX 3090 Ti PC is neither an RTX 3090 nor a card, but it is exactly what a "similar alternative" is for.

## 2. How the pool works end to end

The pipeline already works per listing and does not depend on which search found a listing. Most of the work is making that explicit and tested.

| Module | Already does | Small addition |
| --- | --- | --- |
| `listing-ingest` | Stores each listing once; sightings | Record term, centre and run on each sighting |
| `details-selector` | Chooses listings for details | Select against **all** active wants (`v_want_parts`), within the existing budget |
| `details-queue`, `spend-governor` | Shared deduplicated queue; budgets | A capped `gem-confirm` lane (§7) |
| `parts-rules`, `parts-ai`, `parts-record` | One record per listing version | No hunt or term context passed in; normalise `+` in titles **and descriptions**, wherever the pack's cleaning step runs (a `+`-encoded description with no GPU in the title, such as this run's MSI AlphaSync listing, would otherwise stay unresolved); `parts-ai` on by-catch in pack categories only |
| `listing-assessment` | Container, form, GPU state | Form classification scans the **full description, not only the title**, for undeclared bundle contents — a monitor brand or model, "comes with" or "included" wording, a named keyboard or mouse — before a listing enters a group; a PC whose description lists any of these is filed as "bundle", never "PC", even when the title carries no "bundle" word |
| `noise-filter` | Wanted, swap, service, stuffing, laptop, mention-only, box only, for parts | Headset and repair-service fixtures |
| `asking-price-index` | Groups asks, computes bands | `sample_origin` per member (`on_target` or `by_catch`: member's product against the finding term via `product-catalogue.resolve()`); median, MAD, IQR in `stats`; internal `v_group_health` (n, by-catch share, newest ask, centres) |
| `asking-price-position` | Positions at n≥10 | Internal robust z in `v_positions`, never in an `app.` view |
| `warning-signs`, `suspected-labels`, `copy-advert`, `listing-location` | "Too good to be true" signals and labels | `warning-signs` publishes its far-below threshold in a view for `gem-finder` to read |
| `spec-match` | Matches wants to listings | Backfill on `want-manager.changed`; match origin (`own_search`, `other_search`) |
| `alert-router` | Dedupe, quiet hours, digests | One release batch per listing version (§3) |
| `want-manager`, `product-catalogue` | Preferences; items and aliases | Alternative controls (§5); `v_similar` from the pack |

**New module `gem-finder`**
- **Job:** decide which positioned listings are gems.
- **Inputs:** `.positioned`, `asking-price-index.updated`, `noise-filter.classified`, `warning-signs.found`, `suspected-labels.changed`, `listing-lifecycle.status-changed`; the matching views and the resolved location.
- **Outputs:** `.candidate`, `.confirmed`, `.dropped`; internal `v_candidates`, `v_gems`; `app.v_gem_finder_picks` (listing, product, n, window, position share, bias-note flag); calls `details-queue.enqueue(lane: 'gem-confirm')`.
- **Tables:** `candidates`, `verdicts` (each check's outcome with evidence), `confirm_requests`.
- **Off-switch:** `switches.is_on('gem-finder')`, with states off, shadow and on. It ships in shadow and stays there while "Too good to be true" is in shadow. When it is off, matching, positions and alerts carry on, and nothing is badged.

**New module `similar-picks`**
- **Job:** find curated alternatives for each hunt from the pool.
- **Inputs:** `v_similar` (product-catalogue), `v_wants` and preferences (want-manager), `v_gems`, `v_positions`, `spec-match.matched`.
- **Outputs:** event `.found` (to `alert-router`, only when the user has opted in). Views `app.v_similar_picks` (want, listing, relation label) and `v_feedback`.
- **Tables:** `picks`, `feedback` ("not relevant", "hide this model").
- **Off-switch:** `switches.is_on('similar-picks')`. When it is off, the hunt page hides the section.

`similar-picks` is not the catalogue's `similar-items`, which serves barcode-less scans after the MVP.

## 3. Cross-hunt matching

- **Any listing, any hunt.** `spec-match` joins each batch of assessed and classified listings against `v_want_parts`, indexed by product key and family. Cost grows with listings, not users, and there is no per-user fetch or AI (Precedence row "Per-user work"). Distance uses the resolved location from `listing-location`.
- **At any time:** on arrival from any run; again on change (price drop, description filled by a detail fetch); and on a new or edited hunt, when `spec-match` backfills available listings first seen within 7 days, shown in the app and the next digest, never as instant alerts.
- **By-catch is a bonus, not coverage.** Every hunt still has its own search. `search-planner` never drops a term because by-catch appears to cover it.
- **Fairness of timing.** Each listing version gets one `eligible_at`, when its match batch completes, and every matching user's alert is created in that same `alert-router` batch. The hunt that triggered the run gets no priority (tested). Send order is shuffled per batch, so no user is systematically first. No tier-based delay: "Speed is a property of the cell, never an artificial delay" (`docs/decisions.md:221`). Only a user's own settings (quiet hours, digest, limits) delay that user. A gem goes to all matching users at once, with no cap (owner decision 6).

## 4. Gem detection

**Group.** The `asking-price-index` group: product key, spec, condition and form. Members are counted per listing, not per sighting. Copy-advert clusters and merged relists count once. Noise-classified listings are excluded. The group's statistics leave out the candidate itself (leave-one-out).

**Form scan.** `listing-assessment`'s form classification (card, PC, bundle, box) reads the full description, not just the title, for undeclared bundle contents — a monitor brand or model, "comes with" or "included" wording, or a named keyboard or mouse — before a listing enters a group. A PC whose description lists a monitor or peripherals is filed as "bundle", never "PC", even when the title carries no "bundle" word (§1 recorded three such listings in this one run).

**Statistics (starting values unless marked fixed):**
- **Sample size:** n ≥ 10 asks in the window. Fixed by the decision.
- **Window:** asks last seen within 30 days.
- **Position:** p is the share of group asks below this ask. A gem needs p ≤ 0.10.
- **Robust centre and spread:** the median m and MAD, floored at 5% of m. Robust z = (ask − m) / (1.4826 × MAD). A gem needs z ≤ −1.5 and ask ≤ 0.75 × m.
- **Dispersion guard:** no gems in a group whose IQR/m > 0.6. This keeps mixed groups such as "gaming PC, GPU unknown" out.
- **By-catch eligibility guard:** a group is gem-eligible only once it has at least one `on_target` member (§6's `sample_origin`) — a group built entirely from by-catch, with no on-target search ever anchoring it, cannot mint a gem however well it passes the statistical checks above. This is the gap `ops-metrics`' on-target-versus-by-catch comparison (§6) cannot close on its own: that check needs n≥10 on both sides, so it never fires on a small, 100%-by-catch group, and it is an aggregate report, not a gem-eligibility gate.
- **Upper bound:** a listing that `warning-signs` marks "price far below comparable asks" is never a gem; it takes the "Too good to be true" path instead. The two thresholds are coordinated, not merely coexisting: `warning-signs` computes its far-below fact from the same `asking-price-index` group `gem-finder` reads — the same n≥10 comparable set, the same median m — and its cut must be calibrated strictly more extreme than gem's ask ≤ 0.75×m (a lower ask-to-median ratio), so the veto range sits entirely inside, never straddling, the gem range. The design draft's starting value for this same rule is 0.6×m (`docs/design/drafts/modules.md:774`), which already satisfies this with a 0.15×m margin; whichever value each module lands on in its own shadow calibration (§9 decision 1) must preserve that ordering — `warning-signs`' cut at or below 0.6×m, `gem-finder`'s cutoff at or above 0.75×m — checked explicitly at the end of the rtx3090 shadow run, not assumed from the starting values alone.

The median and MAD ignore stray £1 and £9,999 asks, where a mean and standard deviation would not.

**Staleness (starting values):**
- A group is stale, with no gems, unless at least 3 of its asks were seen in the last 7 days.
- A candidate must have been first seen, or have dropped in price, within 48 hours, and `listing-lifecycle` must say it is available.
- A gem drops out of top picks after 72 hours or when its status becomes unknown.

**Checks before a candidate becomes a gem** (all must pass): the candidate's group was built by the full-description form scan above, not title-only classification; `noise-filter` class normal (not box only, for parts, wanted, swap, service, stuffing or mention-only); no "Too good to be true" facts, active or shadow (postage, courier or delivery only on a collection listing; risky payment; a `listing-location` conflict; a copy-advert cluster across distant places); no report-based mark; the by-catch eligibility guard above.

**Detail fetch.** The title decides identity; most "Too good to be true" signals need the description. A candidate without one goes to the `gem-confirm` lane, first when its title leaves the product ambiguous (3090 or 3090 Ti; VRAM variants), the form ambiguous (card, PC, box, bundle) or the noise class uncertain ("read description"). Default (owner decision 3): every candidate needs a description before it is badged. The fetched version reruns the normal chain and `gem-finder` re-evaluates it. At the lane's cap the candidate stays unbadged but is still matched and positioned.

## 5. Top picks and similar alternatives

- **Feed:** a "Top picks" strip of up to 3 gems within the user's distance that match one of their hunts or an alternatives-enabled hunt, then the normal feed. A listing with a "Suspected …" label is never a top pick; it appears with its label in normal results.
- **Deal card:** badge "Top pick" (owner's wording to confirm) and a position line that is always asking-price position, never "worth" or "fair" (Precedence row "Price wording"): *"Asking £{ask}. Lower than {share} of {n} similar asks ({condition}) seen in the last {days} days. These are asking prices, not sale prices."* The §6 bias note follows where it applies. No "safe" or "checked" reassurance: the absence of a label is not a safety claim.
- **Hunt page:** *"While hunting your {product} we also found …"*. Each card carries its curated relation label ("Same model, Ti version", "One tier up", "PC with this card") and is priced in its own group, never against the hunted product's asks.
- **Alerts:** a gem of the hunted product is a normal alert tagged "Top pick"; alternatives go in-app and into the digest by default.

**Where similarity comes from.** A curated `similarity` section in the category pack (`packages/packs/gpu-pc/`), resolved by `product-catalogue` into `v_similar`, with three relations: variants (Ti, Super, VRAM versions of one family), ordered tiers within a generation, and containment (a PC containing product X). Each entry records curator, date and a rationale in words. The pack schema rejects numeric performance fields, and `output-guard` fails CI on "% faster", "faster than", "worth" or "fair value" in `app.` views. Benchmark data would need a real, licence-compatible source and an owner decision. Feedback goes to `review-console` and never edits the pack automatically.

**User controls** (per hunt, in `want-manager` preferences): alternatives off, variants only, or variants plus one tier either side (default); include PCs containing this card (default off); maximum price for alternatives (default the hunt's); instant alerts for alternatives (default off) and top picks (default on); "Hide this model" and "Not relevant" on each alternative card.

## 6. Price knowledge compounding

- **Faster groups.** Every run adds asks to many groups. The recorded run touched 11 GPU models from one term, and a `3090` feed is 91% other items. Groups reach n≥10 sooner in aggregate, and products nobody searched for gain a price picture at no cost.
- **Search-relevance skew.** By-catch is the slice Facebook judged relevant to *another* term, not a random sample of the product's asks. For example, PCs from an rtx3090 search skew high-end, and some mentions are "not a 3090". Mention-only and noise are excluded, but the skew remains.
- **Other biases:** geography (only centres with hunts are searched) and survivorship (unsold, often overpriced asks linger; counting listings, not sightings, within the window limits it).
- **Showing it honestly:** `sample_origin` is stored for every member. When a group's by-catch share is 50% or more, the position line adds *"Many of these asks were found by searches for other items, so the mix may not be typical"* (owner's wording to confirm). The line always states n and the window. `ops-metrics` compares on-target and by-catch medians where both have n≥10; a gap over 15% in many groups goes to the owner, who decides whether to exclude by-catch from positions.

## 7. Cost

- **No extra searches.** `search-planner` and `check-scheduler` are unchanged. By-catch never adds a term, a page or a run.
- **Models.** Rules are free. `parts-ai` makes at most one call per listing version, shared by all users. It runs on by-catch only in pack categories; headsets and sofas get rules only.
- **Routine details.** Selecting against all wants may raise the number of selections, within `spend-governor`'s existing details budget.
- **`gem-confirm` lane:** starting cap 2% of the $150 monthly cap ($3.00), about 3,250 `graphql` details at about $0.00092 each (`docs/fb-actor-reference.md:102`); priority below pasted links, above routine selection; deduplicated, so one fetch serves every user. Shadow measures candidate rate, fetches per day and share confirmed.

## 8. Fixtures and tests

- **Recorded run (`2026-09-24-VkryjpwS6U2GBDh3k`):** headsets and the repair service are noise or off-category; all 11 GPU models resolve (17 of 20 listings are PCs or PC bundles; 14 of 17 name a GPU, 7 in the title and 7 only in the description; GTX 970, RTX 3070 and RTX 5070 each appear ×2; 6 are bundles with a monitor or peripherals), including the 7 description-only GPUs and the `+`-encoded title and description; the 3090 Ti PC stays out of any RTX 3090 card group; bundles group apart. These counts are asserted directly against the dataset file, not re-typed by hand, so a future re-derivation can't silently drift.
- **Undeclared bundles:** "Gaming PC" (£2,500) and "HP Omen gaming pc" (£530) — bundle contents named only in the description, no "bundle" word anywhere in the listing — resolve to form "bundle", never "PC".
- **`+`-encoding:** the MSI AlphaSync listing's title and description are both `+`-encoded end to end; both normalise and resolve to GTX 1660, not the title alone.
- **Trigger independence:** one listing found by two terms gives an identical parts record and group membership.
- **Cross-hunt:** a listing found by term A matches user B's hunt with the same `eligible_at` as the triggering user; backfill is in-app and digest only.
- **Gem maths:** n=9 no, n=10 yes; MAD floor; outliers leave the median unmoved; leave-one-out; dispersion guard; stale group and stale listing.
- **Gem/veto boundary:** an ask at 0.70×m with z=-1.6 becomes a gem candidate, never a veto; an ask at or beyond `warning-signs`' far-below cut (starting value 0.6×m) is vetoed, never a gem, even when p and z alone would pass it.
- **Vetoes:** box only, for parts, wanted, service, postage only, location conflict, copy-advert and far-below-floor never become a gem.
- **By-catch eligibility:** a group at n=10, 100% by-catch, sourced entirely from higher-end searches, never badges a gem, even though it passes every statistical check.
- **Detail lane:** ambiguous titles enqueue; enqueuing twice gives one item (key `source + sourceListingId + contentHash`); at the cap the candidate stays unbadged.
- **Similarity and wording:** only curated relations appear; the pack schema and `output-guard` tests pass; the bias note appears exactly at the threshold.
- **Off-switches and privacy:** with either new module off, matching and alerts carry on; seller identity never appears in an `app.` view.

Synthetic price series used only for the maths are labelled synthetic in `fixtures/series/` and never reach users. Pass rates stay at or above the previous run.

## 9. Owner decisions, with defaults

| # | Decision | Default |
| --- | --- | --- |
| 1 | Gem thresholds (p, discount, z, dispersion, freshness) | The starting values above, in shadow until calibrated on rtx3090, coordinated with `warning-signs`' far-below cut (§4 Upper bound) so neither swallows the other |
| 2 | Wording: "Top pick", "While hunting your … we also found …", relation labels, bias note | Drafts above; not shown to users until confirmed |
| 3 | Must every gem have a description before it is badged? | Yes |
| 4 | Include by-catch asks in positions | Yes, with origin stored and the bias note |
| 5 | `gem-confirm` budget share and priority | 2% of the monthly cap ($3.00), below pasted links |
| 6 | Timing: tier priority, or a cap on users alerted per gem | No priority, no cap, shuffled batch |
| 7 | Alternatives as instant alerts | Off, in-app and digest only |
| 8 | Backfill window for new hunts | 7 days, available listings, no instant alerts |
| 9 | PCs as alternatives for card hunts | Off by default, user can switch on |
| 10 | Who curates similarity tiers | The pack author drafts; the owner approves the first gpu-pc list |
| 11 | Top picks for users without a matching hunt | No; only hunts and alternatives-enabled hunts |

## 10. Backlog tasks (for `docs/backlog.md`)

Each is done when its §8 tests pass, plus the standard definition of done.

- **0.4a Pack similarity section** (packs, contracts, `product-catalogue.v_similar`): CI rejects a performance field.
- **1.3a Sighting origin** (`listing-ingest`).
- **1.4a Pool-wide detail selection** (`details-selector`): select against all active wants (`v_want_parts`), within the existing budget.
- **1.4b Gem-confirm lane in the details queue** (`details-queue`): a capped `gem-confirm` lane (§7).
- **1.4c Gem-confirm budget share** (`spend-governor`): the lane's starting cap and priority (§7, §9 decision 5).
- **1.5b By-catch extraction, rules tier** (`parts-rules`): no hunt or term context passed in; normalise `+` in titles and descriptions.
- **1.5c By-catch extraction, AI tier** (`parts-ai`): runs on by-catch only in pack categories.
- **1.6a Sample origin and group health** (`asking-price-index`): `sample_origin` per member; median, MAD, IQR in `stats`; internal `v_group_health`.
- **1.6b Robust positions** (`asking-price-position`): internal robust z in `v_positions`, never in an `app.` view.
- **1.6c `gem-finder`, in shadow:** verdicts recorded on the rtx3090 hunt.
- **1.7a Noise vetoes** (`noise-filter`): headset and repair-service fixtures.
- **1.7b Warning-signs threshold view** (`warning-signs`): publishes its far-below threshold in a view for `gem-finder` to read (§4 Upper bound).
- **1.8a Cross-hunt matching and backfill** (`spec-match`): backfill on `want-manager.changed`; match origin (`own_search`, `other_search`).
- **1.8b Fair release batching** (`alert-router`): one release batch per listing version (§3).
- **1.8c `similar-picks`:** curated alternatives for each hunt from the pool.
- **1.8d Hunt alternative controls** (`want-manager`): alternatives off, variants only, or variants plus one tier either side, and the other per-hunt controls in §5.
- **1.9a Pool metrics** (`ops-metrics`): by-catch share, on-target versus by-catch gap, `gem-confirm` spend.
- **4.1c Top picks and "also found" UX:** Playwright covers the strip, badge and controls.

Each task above is one module, one branch `task/<id>-<module>`, one pull request, matching "Atomic modules" (`docs/decisions.md:70-78`); tasks that shared a module list in an earlier draft of this table (1.4a, 1.5b, 1.6a, 1.7a, 1.8a and 1.8b) are split above so the backlog doesn't contradict that rule.

**[CHECK-IN]** after 1.6c: review shadow verdicts and cost with the owner before 4.1c goes live.

## 11. Items for legal review

- Showing a listing found by one user's hunt to other users: the same data use as any alert, to be added beside the data-sharing points in `docs/legal-review.md`.
- The wording of "Top pick" and the position line must not imply a valuation, a guarantee or that the item is safe (consumer protection; user-facing wording review).
- GPU model and brand names in relation labels (nominative trade mark use).
- Description text used for gem checks: only the town or area may reach output, under the existing location-precision rule.
