# @nabvy/noise-filter

Marks listings that are not real offers of what someone searched for (wanted, buy-in and swap
adverts, laptops, box-only listings, mention-only hits, keyword stuffing, service adverts) with
reason codes, so results can hide them (`docs/design/modules/noise-filter.md`). Nothing is
deleted and nothing is hidden here: `spec-match` applies the reasons with a visible count
(catalogue question 17). A module session edits only this folder,
`packages/contracts/src/modules/noise-filter.ts`, `packages/config/src/modules/noise-filter.ts`,
`packages/db/src/schema/noise-filter.ts`, `packages/db/tests/noise-filter.test.sql` and
`packages/db/migrations/noise-filter/`.

## Switch and priority

Off by default (rule 11 of `_rules.md`; no seed row, so `switches.state('noise-filter')` reads
`off`). While it is off, `classify` acknowledges and writes nothing and both views return no rows;
the same while the global `pipeline` switch is off. What users lose: nothing is marked, so every
listing shows (the card's "When off"). Shadow writes and fills the internal view; the user-facing
view shows rows only while the module is `on`. `erase` runs whatever the switch says. Priority:
first, free (the card); critical-path priority [cp 8].

## Inputs

- Event `listing-assessment.assessed` v1 `{ listingIds }` (listing-assessment), handled by
  `listingAssessmentAssessedHandler`.
- Views: `listing_assessment.v_assessments` (the kind, parts-record's, and the form);
  `parts_record.v_records` (the parts-rules version the record read) and `v_parts` (each part's
  decided inclusion, `rejected`, quote and offsets); `parts_rules.v_kind_signals` (the actor's
  `wantedTitle` and `wantedDescriptionFirst400Chars` hits, as `wanted_or_swap`) and `v_tag_blocks`,
  both for that version and rule version only; `detail_evidence.v_current` (the current version)
  and `v_text` (title and description); `listing_ingest.v_listings` (the found-by terms, the card
  title while the version has none, and T1 `first_fetched_at`).
- `listing_suppression.is_suppressed()` in the user-facing view. The card's `v_suppressed` is not
  read (`docs/questions/noise-filter.md`).
- Switches `noise-filter` and `pipeline`, through `@nabvy/switches` (fail closed).

## Outputs

- Event `noise-filter.classified` v1 `{ listingIds }` (at most 500): every listing among the batch
  whose current version has a classification, written now or before. Key: sha256 of the sorted
  `listing@evidence@input@rule` lines of the stored rows plus the batch index, so a replay yields
  the same key and any new input a new one.
- Internal view (`nabvy_pipeline`; `security_invoker`; explicit columns; no seller field; empty
  while off): `noise_filter.v_classifications`: listing_id, evidence_hash, input_hash,
  rule_version, reasons, evidence (reason, source, quote, offsets), terms (term, model key,
  status), fetched_at (T1 of the input), classified_at (done time). The latest row of each
  version. Row type `NoiseFilterClassification`.
- User-facing view (`nabvy_app` only): `app.v_noise_filter_reasons` (listing_id, reasons): the
  latest classification of each listing, only when it has a reason; rows only while this module
  and listing-suppression are `on`, never a suppressed listing (`docs/security.md`, "Cross-module
  reads behind a user-facing view": the one cross-module read is the SECURITY DEFINER
  `is_suppressed()`). `nabvy_app` has column-level select on the four columns the view reads and
  a row-level policy with the same conditions. Row type `NoiseFilterListingReasons`.
- Functions: `classify(q, { listingIds, now })`; `erase(q, listingIds)` for `seller-rights`; the
  pure `classifyOne`, `advertReasons`, `serviceReasons`, `termStatuses`, `termReasons`,
  `inputHash`, `ruleVersion`, `compile`.

## Tables

Postgres schema `noise_filter`. No user rows; the pipeline role inserts, reads and deletes, and
may update only `classified_at`.

| Table | Key columns | Unique keys |
| --- | --- | --- |
| `classifications` | `listing_id`, `evidence_hash`, `input_hash`, `rule_version`, `reasons`, `evidence`, `terms`, `fetched_at` (T1 of the input), `classified_at` (done time) | `(listing_id, evidence_hash, input_hash, rule_version)` |

Checks pin the hash and version formats, the reason codes (the same list as the contract; a test
compares them) and the JSON shapes.

## Rules and thresholds

All in `packages/config/src/modules/noise-filter.ts`; every one a starting value until more
recorded runs calibrate it. A reason needs positive evidence; unknown is never noise.

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| `wanted` | a title `wanted_or_swap` signal whose quote is wanted, WTB, want to buy, looking for, l/f | `part-patterns.json:5`; `docs/questions.md` 2026-09-24 (0.4) | starting value |
| `buy_in` (title) | quote is I/we buy, I'm buying, buyer of, buy(ing) your/all/any/broken, cash for your, cash paid for, sell (me) your; "buying", "cash for", "cash paid" only when they open the title | as above | starting value |
| `buy_in` (description) | a description `wanted_or_swap` signal inside the first 400 characters and the first sentence, quoting a buy-in phrase, when the title offers no part; "wanted" there gives `wanted` | `part-patterns.json:6`; the card (trader boilerplate, `dataset.json:3648`) | starting value; row 11 is the negative case |
| `swap` | a title swap word that opens the title or is followed by "for" within four words, with no sale word (or, sale, sell, welcome, considered, ono...) in the title | the card ("a sale that welcomes trades is not a wanted advert") | starting value; no recorded swap advert |
| Negation | a signal right after no, not, non, don't, without, never (within 12 characters, nothing but punctuation between) is dropped | "no swaps" | starting value |
| `laptop` | parts-record's kind is `laptop` | the card | fixed by the card |
| `box_only` | listing-assessment's form is `box_only` | the card | fixed by the card |
| `mention_only` | every found-by term names a model (3–5 digits, optional Ti/Super/XT/XTX/GRE) that some part names and no offered, unrejected part names | `HANDOFF.md:171-173`; `EVIDENCE_LEDGER.md:556-559` | starting value |
| `keyword_stuffing` | every found-by term's model occurs only inside parts-rules' tag blocks (and no part names it) | the card | starting value |
| `service` | a title service phrase (builder, service(s), repair service or shop, "and repair", PC or computer repair) after "spares or repairs", "for repair", "needs repair" are blanked; or a service offer in the description's first 400 characters when nothing is offered | `dataset.json:6713-6714` | starting value; one recorded service advert |
| Batch size | 500 listing IDs per handled batch and per event | rule 7 | fixed by the rule |

Facebook's category is never read.

## Fixtures and pass rate

Stage `classify` (`test/fixtures/classify.fixtures.ts`), 4 of 4 at the last recorded run
(`test/fixtures/pass-rates.json`). Every case runs the rows through listing-ingest,
detail-evidence, parts-rules, parts-record, parts-ai (recorded responses), parts-record again and
listing-assessment, then this module, on the real migrations in PGlite.

- `recorded-run`: the whole recorded run (`fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k`)
  with parts-ai's recorded responses: row 20 (repair service) is `service`; rows 11 and 12 (priced
  headset sales, row 11 with "We buy and part-exchange" boilerplate) and row 14 (Legion desktop)
  have no reason; nor has any other PC sale.
- `mention-only`: the evidence ledger's "5080" phrases on recorded PCs: mention only; mention
  plus a generic term; a tag-block hit; a term the listing never names; an offered 5080.
- `wanted-and-swap`: wanted, buy-in (title and first sentence) and swap adverts, and their
  negatives: "no swaps", "swaps considered", "for sale or swap", "spares or repairs", the
  recorded headsets.
- `laptop-and-box`: a laptop kind, the Legion desktop, a box-only listing.

The 14 recorded "5080" mentions of `HANDOFF.md:171-173` are not in the fixtures tree (the recorded
run searched "gaming pc"); the `mention-only` case is built from their phrases. Other tests:
`domain.test.ts` (every rule, its negatives and the boundary of each threshold),
`idempotency.test.ts` (a replay in any order writes nothing and keeps the done time; a new term
gives a new row and key; inputs returning to an earlier state reuse the earlier row; the handler
publishes once; batches over 500 are refused; erasure), `switch.test.ts` (off, paused pipeline,
shadow, on, suppression, listing-suppression off, `nabvy_app`'s reach, parts-rules off),
`contracts.test.ts` and `packages/db/tests/noise-filter.test.sql` (grants, key, checks, latest
rows, the user-facing view's columns, suppression and row policy, switch states, the foundation's
view check). No reader of this module exists yet, so "a reader's fixtures pass with it off" waits
for `spec-match`.

## Decisions

- **2026-09-25: reasons need positive evidence.** An unknown kind, a module that is off, a term
  the listing does not name or that the rules cannot place: none is noise. With `parts-rules` off
  no signal is read, so no wanted, buy-in or swap reason is given.
- **2026-09-25: the actor's wanted pattern is the gate, narrow words decide.** parts-rules'
  `wanted_or_swap` signals (the actor's patterns) are the only candidates for the three advert
  reasons; this module's word lists pick which count, as the narrow pattern of
  `docs/questions.md` (0.4) does, and the kind `wanted_or_swap` alone is never a reason.
- **2026-09-25: a classification is append-only; the views show the latest.** The key is the
  version plus `input_hash` (everything read, including the found-by terms, since mention-only is
  a cross-listing stage under rule 8) and the rule version. When inputs return to an earlier
  state, that row's `classified_at` moves forward rather than a duplicate row being written; this
  is the only update, and the only one the pipeline role may make.
- **2026-09-25: the done time is `classified_at`**, the handler's hop time; a replay writes
  nothing, so it never moves. T1 of the input is stored as `fetched_at` (rule 10).
- **2026-09-25: mention-only and keyword stuffing need every found-by term** (see
  `docs/questions/noise-filter.md`); the per-term statuses are kept in `v_classifications.terms`.
- **2026-09-25: the service rule reads the description only when nothing is offered**, so a
  trader's "we also do repairs" under a PC sale never marks it.
- **2026-09-25: not-a-PC is not a reason**; `spec-match` reads the kind.
- **2026-09-25: the user-facing view reads only this module's table** plus `is_suppressed()`;
  `nabvy_app` gets column-level select on `id`, `listing_id`, `reasons` and `classified_at`
  behind a row policy, as `app.v_pickup_location` does.
- **2026-09-25: view rows are Zod in contracts**, as listing-assessment's are; `contracts.test.ts`
  compares the keys with the Drizzle view declarations.
- **2026-09-25: no RLS on user rows.** There are none; the pipeline role writes, `nabvy_app` reads
  through the row policy only.

## Open questions

`docs/questions/noise-filter.md` (never `docs/questions.md` itself: `docs/session-conventions.md`).

## Incidents

None.
