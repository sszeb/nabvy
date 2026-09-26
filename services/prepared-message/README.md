# @nabvy/prepared-message

Builds the copyable "ask the seller" message and checklist for what a listing leaves unknown
(for example the GPU not stated), from listing-assessment's unknowns and the pack's template,
with listing quotes redacted (`docs/design/modules/prepared-message.md`). The user copies and
sends it; Nabvy never contacts sellers. A module session edits only this folder,
`packages/contracts/src/modules/prepared-message.ts` and
`packages/config/src/modules/prepared-message.ts`: the module owns no tables, views or
migrations.

## Switch and priority

Off by default (rule 11; no seed row, so `switches.state('prepared-message')` reads `off`).
While it is off, and in shadow (the output is user-facing, so shadow shows nothing), `build`
returns null and `buildMany` an empty map: cards show no prepared message. With
listing-assessment off its views are empty, so there is nothing to ask. quote-redaction fails
closed: while it is not `on`, the checklist carries no quote (`quotesShown: false`) and the
questions still show. Priority: first (pipeline stage 14,
`fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:75`); critical-path priority [cp 5].

## Inputs

- Views (listing-assessment, as `nabvy_pipeline`): `listing_assessment.v_assessments` (the latest
  assessed version of each listing and its confirmed parts with their quotes) and
  `listing_assessment.v_unknowns` (the core parts that version does not state; a GPU only while
  `not_stated`, never after a reviewer states it).
- Functions: `redact()` (quote-redaction) on every quote; `isOn()` (switches) for
  `prepared-message` and `quote-redaction`.
- The pack template of pack `gpu-pc`: `src/domain/template.ts`, parsed with
  `PreparedMessageTemplate` (see Decisions).
- No events.

## Outputs

- Functions:
  - `buildMany(q, { listingIds })` (at most 500 IDs): a map from listing ID to `PreparedMessage`
    for each listing with something to ask.
  - `build(q, listingId)`: one listing's `PreparedMessage`, or null.
  - The pure `compose(input, template)` and `showQuote(raw, max)`.
- `PreparedMessage` (`@nabvy/contracts/modules/prepared-message`): `listingId`, `evidenceHash`
  (the version it answers), `templateVersion`, `text` (the message to copy), `checklist` (items
  `{ kind: 'ask' | 'check', partType, text }`), `quotesShown`. No seller field and no recipient:
  the schema is strict.
- Events: none. Views: none. There is no send path (`test/no-send-path.test.ts`).

## Tables

None.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Asks | one per unknown the template has a question for, in part order (GPU, CPU, RAM, storage) | the card: an unstated GPU becomes a question | starting value |
| Checks | one per core part the template asks about that the listing states and is not asked, with the first shown quote of that part | the card's checklist; `web-app.md:30-32` | starting value |
| Quotes | whitespace collapsed, then `redact()`; left out (never cut) when longer than `maxQuoteChars` | quote-redaction README ("quotes therefore stay short") | starting value |
| `maxQuoteChars` | 120 | `packages/config/src/modules/prepared-message.ts` | starting value |
| Batch | 500 listing IDs per `buildMany` | rule 9 | fixed by the rule |

## Fixtures and pass rate

Stage `build` (`test/fixtures/build.fixtures.ts`), 6 of 6 at the last recorded run
(`test/fixtures/pass-rates.json`). Each case seeds assessment rows into
`listing_assessment.assessments` on the real migrations in PGlite and reads them back through the
views; rows are marked synthetic and built from listing-assessment's recorded fixtures.

- `recorded-run`: the six listings of run `2026-09-24-VkryjpwS6U2GBDh3k` whose assessment leaves
  core parts unknown, including the three PCs with the GPU not stated.
- `gpu-not-stated`: the card's test; the GPU becomes a question, stated parts become checks.
- `contact-in-quote`: a phone number, a handle and a phone number split across a line break in
  the quotes are all masked (no seller data).
- `nothing-to-ask`: a placed part, a container that states everything, a GPU a reviewer stated.
- `latest-version`: only the latest assessed version is asked about.
- `long-quote`: a quote over the limit is left out, not cut.

Other tests: `domain.test.ts` (ordering, deduplication, the quote limit's boundary, literal quote
insertion, masking), `switch.test.ts` (off, shadow, on, listing-assessment off, quote-redaction
off and shadow), `idempotency.test.ts` (building twice gives the same message and changes no row
in any table), `contracts.test.ts` and `no-send-path.test.ts` (only builders exported, no
transport dependency, no network, channel or write in the source).

## Decisions

- **2026-09-25: no tables, no views, no migration.** The message is built on request from
  listing-assessment's views; storing it would add a copy that goes stale with every new
  version. So `build` is read-only and there is nothing to replay (rule 8 holds trivially; the
  idempotency test checks that no row changes).
- **2026-09-25: `build(q, listingId)` and `buildMany(q, { listingIds })`.** The card names
  `build(listingId)`; every module function takes the caller's connection, so `q` comes first,
  and the batch form serves a page of cards or a digest in one pair of queries (rule 9). Both
  read internal views granted to `nabvy_pipeline`, so callers run them in `withPipeline`
  (notifier, or the card procedure through the module that assembles the card).
- **2026-09-25: the template lives in this module until the owner's wording goes into the pack.**
  `CategoryPack` has no message template, and `packages/packs` is not this module's file. The
  placeholder template is `src/domain/template.ts`, validated by the `PreparedMessageTemplate`
  contract (`{questions}` once, `{quote}` in the check, no other placeholder), and every message
  carries its `templateVersion` (`placeholder-1`). The switch stays off until the owner sets the
  wording (`docs/questions/prepared-message.md`).
- **2026-09-25: the latest assessed version.** `v_unknowns` lists every version; the message
  answers the version with the latest `assessed_at` in `v_assessments` (then the larger evidence
  hash, for a stable pick), so an old version's unknowns never reach the user.
- **2026-09-25: quotes only in the checklist, never in the message.** The message to the seller
  is questions only; the checklist shows what the listing states, for the user to check in
  person, as redacted quotes. quote-redaction's switch is read once per call and `redact()` is
  applied to each quote; whitespace is collapsed before redaction, never after, so a number
  split across lines is masked.
- **2026-09-25: suppression is the caller's.** `build` does not read listing-suppression: the
  card or notification that shows the message already leaves suppressed listings out (rule 5).

## Open questions

`docs/questions/prepared-message.md`: the message wording, and where the template lives.

## Incidents

None.
