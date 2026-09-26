# @nabvy/spec-match

Matches wants against listings by the parts they contain, including parts inside PCs, and runs
spec searches on demand; silence is never a "no" (`docs/design/modules/spec-match.md`). It sends
no alerts and computes no prices. A module session edits only this folder,
`packages/contracts/src/modules/spec-match.ts`, `packages/config/src/modules/spec-match.ts`,
`packages/db/src/schema/spec-match.ts`, `packages/db/tests/spec-match.test.sql` and
`packages/db/migrations/spec-match/`.

## Switch and priority

Off by default (rule 11 of `_rules.md`; no seed row, so `switches.state('spec-match')` reads
`off`). While it is off, the handlers acknowledge and write nothing, both views return no rows and
`search()` returns `spec-match.off`; the same for writes while the global `pipeline` switch is
off. What users lose: no matches, no spec search and no alerts from wants (the card's "When
off"). Shadow writes and fills `v_matches`; `app.v_spec_match_results` and `search()` show
results only while the module is `on`. `erase` and the account purge run whatever the switch
says. Priority: first (the card); critical-path priority [cp 6].

## Inputs

- Events, each handled by `listingEventHandlers` → `matchListings` (T5 `t5Matched`):
  `listing-assessment.assessed`, `noise-filter.classified`, `copy-advert.clustered`, all
  `{ listingIds }`. `want-manager.changed` `{ wantIds }` → `wantManagerChangedHandler` →
  `matchWants` (the backfill). `account.deleted` `{ userId }` → `accountDeletedHandler`.
- Views: `want_manager.v_wants` (criteria, cap and currency, point, radius, handover; active
  wants only); `listing_assessment.v_assessments` (container, GPU state, coverage, exclusions);
  `parts_record.v_records` (kind, the version when assessment is off) and `v_parts` (each part's
  decided inclusion, `rejected`, catalogue ID, attributes, quote and offsets, conflict);
  `listing_ingest.v_listings` (price, currency, T0, delivery types, availability, T1 for the
  backfill window) and `v_sightings` (search terms and centres, for the match origin);
  `noise_filter.v_classifications` (search) and `app.v_noise_filter_reasons` (results).
- Functions: `wantOwners` and `getPreferences` (want-manager); `distanceKm` (location);
  `suppressed` (listing-suppression); `redact` (quote-redaction); `isActive` (account); `isOn` and
  `state` (switches). `listing_suppression.is_suppressed()`, `quote_redaction.quote()` and
  `switches.is_on()` in the user-facing view.
- Injected (soft edges; each stub returns no data): `pointsFor` (pickup-location), `spamFlags`
  (`app.v_copy_advert_flags`, copy-advert 1.7c), `multiQuantityFlags`
  (`app.v_multi_quantity_filter_flags`), `positions` (`v_positions`, asking-price-position).

## Outputs

- Event `spec-match.matched` v1 `{ matchIds }` (1–500): only matches whose verdict changed (a new
  pair, or a verdict different from the pair's previous one). Key:
  `spec-match.matched:<sha256 of the sorted IDs>:<batch>`. A replay writes nothing and emits
  nothing.
- Internal view `spec_match.v_matches` (`nabvy_pipeline`; `security_invoker`; empty while off):
  match_id, want_id, listing_id, evidence_hash, card_hash, input_hash, rule_version, verdict,
  criteria, inside_pc, origin, backfill, matched_at (T5). The latest row of each want and listing;
  no user ID; quotes verbatim (readers that show them redact them). Row type `SpecMatchMatch`.
- User-facing view `app.v_spec_match_results` (`nabvy_app` only; `security_invoker`, so row-level
  security gives each user their own rows): exactly `match_id, want_id, listing_id, verdict,
  inside_pc, origin, backfill, criteria, matched_at`. The latest verdict of each of the user's
  wants and listing, never `no_match`; every quote through `quote_redaction.quote()` (null while
  quote-redaction is off); rows only while this module and listing-suppression are `on`, never a
  suppressed listing. Row type `SpecMatchResult`.
- Functions (`@nabvy/spec-match`): `matchListings(q, { listingIds, now }, deps?)` and
  `matchWants(q, { wantIds, now }, deps?)` inside withPipeline; `search(q, input, deps?)` inside
  withPipeline after the procedure's session check (spec search over the shared views: no fetch,
  no model call); `results(q, { userId, wantId? }, deps?)` inside withUser; `erase(q,
  listingIds)` for `seller-rights`; `onAccountDeleted(q, payloads)`; the pure `evaluate`,
  `partCriterion`, `priceCriterion`, `distanceCriterion`, `catalogueFit`, `verdictOf`,
  `compareBy`, `ruleVersion`. `search` and `results` return `SpecMatchResults`: standalone parts
  first, then the collapsed "inside a PC" section, with visible counts of what the user's
  preferences hid (noise, spam, multi-quantity).
- Error codes: `spec-match.too_many_listings`, `spec-match.too_many_wants`,
  `spec-match.invalid_input`, `spec-match.off`, `spec-match.account_inactive`.

## Tables

Postgres schema `spec_match`.

- `matches`: one row per verdict of a want against a listing for one set of inputs. Unique
  `(want_id, listing_id, input_hash, rule_version)`; `input_hash` is the SHA-256 of the want's
  criteria, cap, point, radius, handover and centre, the listing's evidence and card hashes, and
  the verdict, criteria, `inside_pc` and origin computed from them. Also `user_id` (the want's
  owner, for row-level security only), `evidence_hash`, `card_hash`, `verdict`, `criteria` (jsonb
  `SpecMatchCriterionResult[]`), `inside_pc`, `origin` (`own_search | other_search`), `backfill`,
  `matched_at` (T5). Written by `nabvy_pipeline` only; `matched_at` is its one updatable column
  (an earlier row made the latest again).

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Only included parts count | parts-record's `inclusion = offered`, not `rejected` | Card | Fixed |
| `no_match` on a part | Needs listing-assessment's `coverage.fullDescription`: another part of the type named, an exclusion of it, or GPU state `none`/`integrated` | Card; `fb-scrap-engine/README.md:223-241` | Fixed |
| Silence | `not_stated` (`not_named`); partial text `not_stated` (`partial_text`) | Card | Fixed |
| GPU and CPU fit | Catalogue ID or a variant of it (`…:rtx-5080` fits `…:rtx-5080:16gb`); a family fits the model segment; a mobile chip never fits a desktop want | product-catalogue's ID shape | Starting value |
| "Or better" | Another card is `not_stated` (`ambiguous`) | No catalogue ranking yet | Starting value (question) |
| RAM | Any included stick of at least the size; generation `ddrN` against `ddr`; one of the two unstated is `partly_named` | parts-rules' attributes | Starting value |
| Storage | One drive of at least the size matches; several that only add up are `ambiguous` | Conservative | Starting value |
| Price | Only in the want's currency, never converted; the cap itself matches | Card; `docs/decisions.md:19` | Fixed |
| Distance | `location.distanceKm` from pickup-location's point; the radius itself matches; unknown is `not_stated`; a posting listing matches a want that accepts posting | Card | Fixed |
| Posting delivery types | `SHIPPING`, `SHIPPING_ONSITE`, `SHIPPING_OFFSITE` | Not in the recorded run | Starting value (question) |
| Stored pairs | A part criterion matches or is partly named | Card ("ask the seller") | Starting value (question) |
| Backfill window | 7 days of first-seen listings, marked `backfill` | Card | Fixed |
| Batch | 500 IDs per call and per event | Rule 7, rule 9 | Fixed |
| Search candidates | 500 most recently seen listings with an included part of a wanted type | Rule 9 | Starting value |
| Position sort | Only positions shown at n≥10; the rest last | `docs/decisions.md:15`; card | Fixed |

## Fixtures and pass rate

Stage `match` (`test/fixtures/match.fixtures.ts`), recorded run
`2026-09-24-VkryjpwS6U2GBDh3k`, every listing's point at Chichester through the injected
`pointsFor`:

- `worked-rtx-5080` (synthetic over `1783301919382894`): the RTX 5080 named in the description
  only; catalogue and family wants, a GBP cap either side of the ask, an EUR cap (`not_stated`),
  a 10 km radius around London (`no_match`), and 32GB DDR5 plus an RTX 4080 (`no_match` on the
  GPU).
- `worked-pc-5060` (synthetic over `2264485254402498`): the "Pc" listing with an RTX 5060 in the
  description only; 32GB RAM against its 16GB is `no_match`; 16GB DDR5 is `partly_named`.
- `unstated-gpu` (synthetic over three recorded rows): no GPU at all (`not_named`), another card
  over partial text (`partial_text`), "no graphics card included" over full text (`excluded`).
- `recorded-run-ten-wants`: ten real wants over all 20 listings; 19 matches, 8 of them (42%) from
  the description only.

Latest pass rate: 4/4. Unit tests cover each threshold's boundary (`test/domain.test.ts`).

## Decisions

- 2026-09-26: a pair is stored once a part criterion matches or is partly named, then re-matched
  on every new input, so a later "no" is recorded (`docs/questions/spec-match.md`).
- 2026-09-26: containers are always matched and marked `inside_pc`; want-manager's
  `pcContainment` is left to alert-router.
- 2026-09-26: the whole verdict uses the criterion values; `no_match` is not a user-facing result.
- 2026-09-26: preferences (hide noise, likely spam, multi-quantity) apply when results are read
  (`search`, `results`), with visible counts, never when verdicts are written: a verdict is the
  same for everyone. Noise hides only while noise-filter is `on`; spam only from shown flags, so
  in shadow the preference does nothing.
- 2026-09-26: quotes are stored verbatim and redacted when read: in the user-facing view by
  `quote_redaction.quote()`, in `search()` by `redact()` while quote-redaction is on; null while
  it is off.
- 2026-09-26: worth-the-trip hints are not computed yet: no travel cost is set.
- 2026-09-26: `search()` runs inside withPipeline after the procedure's session check, and checks
  the account's standing; `results()` runs inside withUser.

## Open questions

`docs/questions/spec-match.md`: stored pairs, PC containment, "or better", verdict values,
posting, the condition filter, the soft seams, worth-the-trip hints, match origin, where search
runs.

## Incidents

None.
