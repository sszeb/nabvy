# @nabvy/asking-price-index

Groups current asks into comparable groups and computes each group's figures. It shows no position
and never says "worth" or "fair" (`nabvy/docs/decisions.md:15`).

## Switch and priority

Default `off` (rule 11). Off: no bands, and readers (asking-price position, "far below similar
asks" facts) have no figures. Shadow: groups and figures are written and the internal views fill,
but no band is shown. Priority: first; it underpins asking-price position (the card).

## Inputs

| Input | Module | Use |
| --- | --- | --- |
| `listing-assessment.assessed`, `listing-ingest.card-changed`, `copy-advert.clustered`, `relist-merge.merged` | those modules | Re-index the batch's listings |
| `listing_ingest.v_listings`, `v_sightings` | listing-ingest | Ask, currency, money kind, availability, binding, city page, last seen, search terms, centres that found it |
| `detail_evidence.v_current`, `v_text` | detail-evidence | Current version, Condition attribute, title and description (condition cross-check) |
| `listing_assessment.v_assessments` | listing-assessment | Form: `part`, `system`, `bundle` |
| `parts_record.v_parts` | parts-record | Catalogue IDs of parts the listing offers (not mentions, not rejected) |
| `noise_filter.v_classifications` | noise-filter | Noise hits are left out |
| `city_pages.v_centres` | city-pages | Country of the listing's centre |
| `relist_merge.v_groups`, `copy_advert.v_members` | relist-merge, copy-advert | Collapse keys |
| `product_catalogue.v_items`, `v_aliases` | product-catalogue | Label and on-target search terms |
| `listing_suppression.is_suppressed()` | listing-suppression | Suppressed listings never count |
| `restricted_listing_keys` (soft), `v_promoted` (soft) | seller-key, seller-boosts | Injected through `IndexEvidence`; default none |

## Outputs

- Event `asking-price-index.updated` `{ groupKeys }`: groups whose figures changed.
- Internal views (`nabvy_pipeline`): `v_groups` (group and figures, `thin`, `copy_collapse`),
  `v_members` (ask, counted, exclusion, sample origin, seen at), `v_implied` (PC median minus
  standalone median, both sides' n and quartiles, never one combined range), `v_group_health`
  (n, members, by-catch share, newest ask, city pages).
- User-facing `app.v_asking_price_index_bands`: `group_key, label, n, median, range_low,
  range_high, currency`; only n ≥ 10, only while this module and `listing-suppression` are on.
- Functions: `index(q, { listingIds }, options)`, `erase(q, listingIds)`, handlers
  `assessedHandler`, `cardChangedHandler`, `clusteredHandler`, `mergedHandler`.

## Tables

| Table | Key | Columns |
| --- | --- | --- |
| `groups` | `group_key` | catalogue_id, context, condition, country, currency, window_days, label |
| `members` | unique (`group_key`, `listing_id`) | ask_minor, counted, excluded, sample_origin, collapse_key, city_page_id, seen_at, card_hash, evidence_hash |
| `stats` | `group_key` | n, median, mad, p25, p75, min, max, thin, copy_collapse, as_of |

No seller field or seller key is stored. `nabvy_app` can read only the band columns
(`group_key, label, currency` of groups; `group_key, n, median, p25, p75` of stats), under RLS that
repeats n ≥ 10 and the switches.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Group key | catalogue × context × condition × country and currency × window | PARTS_INTELLIGENCE.md:262-263 | Brief |
| Window | 30 days since last seen | PARTS_INTELLIGENCE.md:262-263 | Brief |
| Outlier fences | Q1 − 1.5·IQR, Q3 + 1.5·IQR (type-7 quantiles), from 4 asks | Tukey; PARTS_INTELLIGENCE.md:264-265 | Starting value |
| Collapse | One ask per relist group, else copy cluster (newest seen) | PARTS_INTELLIGENCE.md:264-265 | Brief |
| Left out | Suppressed, noise, sold, £0, non-fixed money, unverified binding, promoted | EVIDENCE_LEDGER.md:194-195; actor README.md:451; SELLER_DATA.md:223-225 | Brief |
| Condition | Attribute; new or like new with used text → `used_good` | The card; `dataset.json:2178,2244` | Starting rule |
| Context | part with one item → standalone; system → in_pc; bundle or several items → bundle | The card | Starting rule |
| One ask per seller key; thin share | on; 1/3 | SELLER_DATA.md:163-165 | Starting value, inert until seller-key |
| Band minimum | n ≥ 10 | decisions.md:15 | Owner's rule |
| Split-half drift | ≤ 25% of the median | PARTS_INTELLIGENCE.md:386-388 | Starting value |
| Never used as a reference | The displayed "was" price | PARTS_INTELLIGENCE.md:88 | Brief |

## Fixtures and pass rate

Stage `index`, 7/7 (100%), synthetic rows seeded through the upstream modules' own tables in
PGlite: `worked-example-groups` (standalone, PC and bundle kept apart; `v_implied`),
`relist-and-copy-collapse`, `eur-kept-apart`, `split-half-stability` (n = 12, one outlier cut,
stable), `exclusions`, `new-with-used-text` (from the recorded run's "New" listing that says "Only
used for 1 month"), `copy-advert-off`.

## Decisions

- 2026-09-26: figures are rewritten only when they change, so `as_of` is the version readers key
  on and a replay announces nothing (rule 8).
- 2026-09-26: while `copy-advert` is off its view is empty, each listing counts on its own, and each
  stats row records `copy_collapse = false` ("copy collapse unavailable", copy-advert.md section 3).
- 2026-09-26: the band label is stored on the group when it opens, so the user-facing view reads
  only this module's tables and needs no SECURITY DEFINER function (docs/security.md).
- 2026-09-26: the country comes from the listing's centre, else the centre whose search found it;
  never from the currency.

## Open questions

`docs/questions/asking-price-index.md`: condition cross-check grade, soft seller-key and
seller-boosts seams, the worked example's figures, the band label, country, stability tolerance.

## Incidents

None.
