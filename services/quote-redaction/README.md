# @nabvy/quote-redaction

Masks identifying text (phone numbers, emails, social handles, links and the inward half of full
postcodes) in any quote shown to users and in the copy of listing text sent to a model, and
reports what it masked. It never changes stored text (`docs/decisions.md`, "Actor data kept in
full").

## Switch and priority

Default `off`, like every new module (design rule 11). This module fails closed: while it is not
`on` (including `shadow`, or a switch that cannot be read), callers show **no quote at all** and
send **no listing text to a model**; other facts still show. Priority: Launch (module card).

## Inputs

Calls only. No events consumed, no views read. The SQL entry point `quote_redaction.quote` reads
`switches.is_on('quote-redaction')` when that function exists (see "Decisions").

## Outputs

No events, no views, no tables. Functions:

| Function | Where | Returns |
| --- | --- | --- |
| `redact(text)` | `@nabvy/quote-redaction` | `QuoteRedactionResult`: `{ text, masked: { email, link, handle, phone, postcode } }` (counts) |
| `quoteFor(text, switchState)` | `@nabvy/quote-redaction` | `redact(text)` when the state is `'on'`, otherwise `null` (fail closed) |
| `quote_redaction.redact_result(text)` | SQL | the same result as `jsonb` |
| `quote_redaction.redact(text)` | SQL | the masked text only, for `app.` views (for example on listing titles); `null` in, `null` out |
| `quote_redaction.quote(text)` | SQL | the masked text while the switch is on, otherwise `null` |
| `quote_redaction.switch_on()` | SQL | whether the switch reads on (stub, see "Decisions") |

The SQL functions are granted to `nabvy_app` and `nabvy_pipeline` and revoked from `public`, so
Supabase's Data API roles cannot call them. Contracts: `@nabvy/contracts/modules/quote-redaction`
(`QuoteRedactionResult`, `QuoteRedactionMasked`, `QuoteRedactionKind`, `QuoteRedactionSwitchState`).

## Tables

None. The Postgres schema `quote_redaction` holds functions only (the SQL test checks it owns no
relations).

## Rules and thresholds

Detectors run in this order; each masks its whole match unless stated. Sources are in
`src/domain/patterns.ts` and, verbatim, in the SQL migration.

| Kind | Rule | Mask | Basis | Status |
| --- | --- | --- | --- | --- |
| email | `local@domain.tld`, any case | `[email redacted]` | card; detector of the recorded-run fixture test | starting value |
| link | `http(s)://…` or `www.…`; bare domains ending `.com`, `.co.uk`, `.org.uk`, `.uk`, `.net`, `.org`, `.io`, `.me`, `.shop`, `.store`, `.biz`, `.info` (so `wa.me/…`, `instagram.com/…`). Trailing punctuation stays outside | `[link redacted]` | card; `apify_gateway.redact_text` | starting value |
| handle | `@name` (1–30 characters, not part of an email); `insta:`, `instagram:`, `snap:`, `snapchat:`, `tiktok:`, `telegram:` followed by a name (the label stays) | `[handle redacted]` | card | starting value |
| phone | UK numbers: leading `0`, `+44` or `0044` (optionally `(0)`), then 7–13 more digits with single spaces, dots or dashes; brackets round an area code allowed. Wider than the numbering plan on purpose | `[phone redacted]` | card; detector of the recorded-run fixture test | starting value |
| postcode | Full UK postcodes starting with a real postcode area, any case; the outward code stays | `<outward> [redacted]` | card; recorded run `2026-09-24-VkryjpwS6U2GBDh3k` README | starting value |

## Fixtures and pass rate

`test/fixtures/cases.json` holds 32 cases, shared by the TypeScript (`test/domain.test.ts` and
stage `redact`, `test/fixtures/redact.fixtures.ts`) and the SQL (`packages/db/tests/quote-redaction.test.sql`,
run by `pnpm db:dry-run`, which reads the same file). Cases cover each kind, separators, several
matches, multi-line text, PC specifications that must stay (`i7 9th gen`, `L2 5MB`, `RTX 2070`,
`M.2`, dates) and one known false positive (`M2 2TB`, a real postcode shape). The recorded run's
business postcode, masked at export (`fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/README.md:35-37`),
is the synthetic case `postcode-recorded-run` with a made-up inward half. The checks the
source-adapters fixture test runs on the recorded dataset are run on `redact()` output too.
Latest pass rate: stage `redact` 32/32.

Other tests: `test/switch.test.ts` (fail closed), `test/idempotency.test.ts` (a second pass masks
nothing), `test/contracts.test.ts`, `test/sql-parity.test.ts` (every TypeScript detector appears
in the migration verbatim, in order, with the same flags and mask, and no extra one).

## Decisions

- **2026-09-24: one set of patterns, two engines.** The patterns use only syntax that JavaScript
  and PostgreSQL's advanced regular expressions read the same way: no `\b`/`\w`/`\d` (in
  PostgreSQL `\b` is a backspace), explicit lookarounds for boundaries, greedy quantifiers only,
  so PostgreSQL's longest match and JavaScript's backtracking pick the same span. A test pins the
  migration to the TypeScript sources, and both engines run the same cases.
- **2026-09-24: counts, not positions.** The result reports how many of each kind were masked,
  never the masked strings or their positions, so the report itself leaks nothing.
- **2026-09-24: masking too much is the safe side.** Phone and link rules are wider than strictly
  needed, and a postcode-shaped model name (`M2 2TB`) is masked. Only postcodes that start with a
  real UK postcode area are masked, which keeps `i7 9th` and `L2 5MB` intact.
- **2026-09-24: placeholders.** The masks are the ones `apify_gateway.redact_text` already uses
  for fixtures. The wording users see is the owner's to set (`docs/questions.md`).
- **2026-09-24: switch stubs.** The `switches` module is not built yet. `quoteFor` takes the
  state the caller read, typed by a stub `QuoteRedactionSwitchState` (`off`, `shadow`, `on`), and
  returns `null` unless it is `on`. `quote_redaction.switch_on()` calls
  `switches.is_on('quote-redaction')` if that function exists and otherwise answers `false`, so
  every quote stays hidden until `switches` is built and this module is switched on. Replace both
  with the `switches` contract when it lands.
- **2026-09-24: not detected.** Names, shop names, logos and faces (the brief lists them;
  `fb-scrap-engine/docs/design/SELLER_DATA.md:296-298`), spelled-out or obfuscated contact details
  ("seven seven zero…", "jo at gmail dot com") and non-UK numbers. Quotes therefore stay short;
  choosing the quote is the caller's job.

## Open questions

- Card questions 11 (contact details in text sent to a model) and 13 (what listing content users
  see).
- `docs/questions.md`, "quote-redaction: mask wording shown to users".

## Incidents

None.
