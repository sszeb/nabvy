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
`switches.is_on('quote-redaction')` directly (task 0.11: the `switches` module now exists, so the
stub existence check is gone). `quoteFor` reads the same switch through `@nabvy/switches`.

## Outputs

No events, no views, no tables. Functions:

| Function | Where | Returns |
| --- | --- | --- |
| `redact(text)` | `@nabvy/quote-redaction` | `QuoteRedactionResult`: `{ text, masked: { email, link, handle, phone, postcode } }` (counts) |
| `quoteFor(q, text)` | `@nabvy/quote-redaction` | `redact(text)` while `isOn(q, 'quote-redaction')` (`@nabvy/switches`), otherwise `null` (fail closed) |
| `quote_redaction.redact_result(text)` | SQL | the same result as `jsonb` |
| `quote_redaction.redact(text)` | SQL | the masked text only, for `app.` views (for example on listing titles); `null` in, `null` out |
| `quote_redaction.quote(text)` | SQL | the masked text while the switch is on, otherwise `null` |
| `quote_redaction.switch_on()` | SQL | whether the switch reads on (`switches.is_on('quote-redaction')`) |

The SQL functions are granted to `nabvy_app` and `nabvy_pipeline` and revoked from `public`, so
Supabase's Data API roles cannot call them. Contracts: `@nabvy/contracts/modules/quote-redaction`
(`QuoteRedactionResult`, `QuoteRedactionMasked`, `QuoteRedactionKind`).

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

`test/fixtures/cases.json` holds 38 cases, shared by the TypeScript (`test/domain.test.ts` and
stage `redact`, `test/fixtures/redact.fixtures.ts`) and the SQL (`packages/db/tests/quote-redaction.test.sql`,
run by `pnpm db:dry-run`, which reads the same file). Cases cover each kind, separators, several
matches, multi-line text, no-break, figure and narrow no-break spaces (U+00A0, U+2007, U+202F), PC specifications that must stay (`i7 9th gen`, `L2 5MB`, `RTX 2070`,
`M.2`, dates) and one known false positive (`M2 2TB`, a real postcode shape). The recorded run's
business postcode, masked at export (`fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k/README.md:35-37`),
is the synthetic case `postcode-recorded-run` with a made-up inward half. The checks the
source-adapters fixture test runs on the recorded dataset are run on `redact()` output too.
Latest pass rate: stage `redact` 38/38.

Other tests: `test/switch.test.ts` (fail closed, against a real `switches` seed through PGlite),
`test/idempotency.test.ts` (a second pass masks
nothing), `test/contracts.test.ts`, `test/sql-parity.test.ts` (every TypeScript detector appears
in the migration verbatim, in order, with the same flags and mask, and no extra one). The parity
test compares pattern text only: it cannot tell whether the two engines read the same text the
same way. That is what the shared cases in both engines are for, so a case goes into
`cases.json` for every input where the engines might differ.

## Decisions

- **2026-09-24: one set of patterns, two engines.** The patterns use only syntax that JavaScript
  and PostgreSQL's advanced regular expressions read the same way: no `\b`/`\w`/`\d` (in
  PostgreSQL `\b` is a backspace), explicit lookarounds for boundaries, greedy quantifiers only,
  so PostgreSQL's longest match and JavaScript's backtracking pick the same span. A test pins the
  migration to the TypeScript sources, and both engines run the same cases.
- **2026-09-24: whitespace spelled out (review of PR #17).** JavaScript's `\s` matches no-break
  and other Unicode spaces (U+00A0, U+2007, U+202F…) and PostgreSQL's does not, so a number or
  postcode written with a no-break space was masked in TypeScript and passed through the SQL
  unmasked. No pattern uses `\s` now: both engines use one explicit class, the JavaScript `\s`
  set written with `\t`, `\uXXXX` and similar escapes, which both read the same way. A test
  refuses `\s` in any detector.
- **2026-09-24: counts, not positions.** The result reports how many of each kind were masked,
  never the masked strings or their positions, so the report itself leaks nothing.
- **2026-09-24: masking too much is the safe side.** Phone and link rules are wider than strictly
  needed, and a postcode-shaped model name (`M2 2TB`) is masked. Only postcodes that start with a
  real UK postcode area are masked, which keeps `i7 9th` and `L2 5MB` intact.
- **2026-09-24: placeholders.** The masks are the ones `apify_gateway.redact_text` already uses
  for fixtures. The wording users see is the owner's to set (`docs/questions.md`).
- **2026-09-24: switch stubs, replaced (task 0.11).** Until the `switches` module existed,
  `quoteFor` took the state the caller had already read, typed by a stub `QuoteRedactionSwitchState`,
  and `quote_redaction.switch_on()` checked whether `switches.is_on` existed before calling it. Now
  that `switches` is built, `quoteFor(q, text)` reads the live switch itself through
  `isOn(q, 'quote-redaction')` (`@nabvy/switches`), the stub type is gone, and
  `quote_redaction.switch_on()` calls `switches.is_on('quote-redaction')` directly (a new migration,
  `packages/db/migrations/quote-redaction/20260924180000_quote_redaction_switch.sql`; grants are
  unchanged since the signature didn't change). `quote-redaction` now depends on `switches`
  (`packages/db/migrations/quote-redaction/module.json`, `package.json`): its own SQL function is a
  plain `language sql` call into `switches.is_on`, which Postgres validates against the real
  function at creation time, so the migration order requires it.
- **2026-09-24: not detected (known limits).** Quotes therefore stay short; choosing the quote
  is the caller's job.
  - Names, shop names, logos and faces (the brief lists them;
    `fb-scrap-engine/docs/design/SELLER_DATA.md:296-298`).
  - Spelled-out or obfuscated contact details ("seven seven zero…", "jo at gmail dot com").
  - Phone numbers with two spaces in a row (`07700  900123`), `447700900123` with no plus
    sign, `0 1243 555 0199` (a space after the leading 0), full-width digits, and non-UK numbers.
  - Links on shorteners or top-level domains outside the list (`bit.ly/abc`, `example.co`).
  - The labels `ig:` and `whatsapp:` (only `insta:`, `instagram:`, `snap:`, `snapchat:`,
    `tiktok:` and `telegram:` are recognised).
  - Email addresses with non-ASCII local parts: in `café@exämple.com` the part before the
    `@` is not masked, so part of the address leaks.
- **2026-09-24: masked on the safe side (known over-masking).** `serial 0123456789` is masked
  as a phone number, `ASP.NET` as a link and `M2 2TB` as a postcode.
- **2026-09-24: `immutable` depends on the locale.** The SQL functions are `immutable`, but case-insensitive
  matching follows the database's character-type locale, so a locale change could change results.
  That is fine while they back no index or generated column; do not use
  them in one.

## Open questions

- Card questions 11 (contact details in text sent to a model) and 13 (what listing content users
  see).
- `docs/questions.md`, "quote-redaction: mask wording shown to users".

## Incidents

None.
