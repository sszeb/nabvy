# @nabvy/waitlist

Takes waitlist sign-ups (email, postcode, wanted products, UTM) before launch and for cells not
yet covered (module card, `docs/backlog.md:14`).

## Switch and priority

Default `off`, like every new module (design rule 11). While off, the form is closed: `submit()`
refuses every submission (`waitlist.closed`) and writes nothing, and the internal view returns no
rows even for entries already stored (module card, "When off"). Priority: BP0 (module card,
`docs/backlog.md:14`).

## Inputs

The waitlist form only (module card). No events consumed. Reads `@nabvy/switches`'s `state()`
indirectly: the caller (an oRPC procedure, not built yet) reads the switch and passes it in as
`ctx.state`; `submit()` does not read `@nabvy/switches` itself, so it has no import to declare
beyond the schema dependency recorded in `packages/db/migrations/waitlist/module.json`
(`dependsOn: ["core", "switches"]`), needed so `v_waitlist` can call `switches.state('waitlist')`.

## Outputs

- **No events** (module card, "Outputs": none beyond its view). `packages/contracts/src/modules/waitlist.ts`
  still declares an empty event registry, so `services/waitlist/test/contracts.test.ts` has
  something to assert against if that ever changes.
- **Internal view** `waitlist.v_waitlist` (id, email, postcode, wanted_products, utm_source,
  utm_medium, utm_campaign, utm_term, utm_content, created_at): granted to `nabvy_pipeline` only
  (rule 5 of `_rules.md`; no module declares waitlist as a dependency yet). Filtered on
  `switches.state('waitlist') <> 'off'` (rule 11).
- **Functions** from `@nabvy/waitlist`: `submit(db, input, ctx)` → `Result<{ entry, created },
  WaitlistError>`; `list(db)` → `WaitlistEntry[]`, the pipeline read of `v_waitlist`.
- **`WaitlistSender`**: an interface (`send(entry): Promise<void>`) and its only implementation,
  `InMemoryWaitlistSender`, which records entries instead of sending anything. No email or DNS
  account exists yet (`docs/secrets.md`), and `submit()` does not call a sender today; this exists
  so a later task can wire in a real one (Resend, say) without changing `submit()`'s signature
  (`docs/questions.md`, "waitlist: sending interface").

## Tables

`waitlist.entries`: `id` (uuid pk), `email` (unique, lower-case, the dedupe key), `postcode`
(nullable, upper-cased with one space), `wanted_products` (nullable text array), five nullable
`utm_*` columns, `created_at`/`updated_at`. `waitlist.submission_attempts`: `key` (pk, the hex
SHA-256 of the caller's IP address, never the address itself), `count`, `window_start` — the
Postgres-backed rate-limit counter for `submit()`, the same pattern as Better Auth's own
`rate_limit` table (`services/auth/src/auth.ts`, `consumeMagicLinkQuota`).

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Submissions per IP | 5 per hour | No number is documented for this endpoint; mirrors `rateLimits.signUpPerIp` from `@nabvy/config`, the closest documented limit for an unauthenticated public endpoint (`docs/engineering.md`, "Rate limits and abuse") | Starting value (`docs/questions.md`, "waitlist: submission rate limit") |
| Required fields | Email only; postcode and wanted products optional | `docs/marketing.md` and the module card list all three as captured together, but do not say postcode or products are mandatory; the conservative option asks for the least data | `docs/questions.md`, "waitlist: which fields are required" |
| Repeat sign-up | The first entry is kept; a later submission's postcode, products and UTM are discarded | Task 0.5a's "Done" only requires one row per address; keeping the first attribution is the conservative option (never silently overwrite stored data) | `docs/questions.md`, "waitlist: repeat sign-ups" |

## Fixtures and pass rate

Stage `submit` (`test/fixtures/submit.fixtures.ts`), 5 synthetic cases (no marketplace run applies
to form input, rule 16): a basic sign-up with UTM (task 0.5a's "Done" wording), a repeat sign-up
that keeps the first entry, every field set at once, an invalid email, and a submission while the
switch is off. Latest pass rate: 5/5. Other tests: `test/domain.test.ts` (pure logic: `checkSwitch`,
`planEntry`, `toEntry`), `test/idempotency.test.ts` (a repeat address writes one row),
`test/switch.test.ts` (off refuses and hides; shadow and on show rows), `test/rate-limit.test.ts`
(the per-IP counter and its window), `test/sender.test.ts` (`InMemoryWaitlistSender` records what
it is asked to send), `test/contracts.test.ts`, and `packages/db/tests/waitlist.test.sql` (grants,
constraints, the view's column list and switch filter, run by `pnpm db:dry-run`).

## Decisions

- 2026-09-24: no email is sent yet (the owner's email and DNS accounts, Resend and Cloudflare, do
  not exist, `docs/secrets.md`). Sending is behind `WaitlistSender`, an interface with only an
  in-memory implementation (`InMemoryWaitlistSender`); `submit()` does not call it, so the module
  has no sending behaviour today, only a shape a later task can fill in
  (`docs/questions.md`, "waitlist: sending interface").
- 2026-09-24: `submit()` takes the switch state as `ctx.state` rather than reading `@nabvy/switches`
  itself, the same shape as `services/cost-meter`'s `CostMeterContext`. The internal view still
  checks `switches.state('waitlist')` independently in SQL (defence in depth), so the two checks
  can never disagree in the database even if a caller passes a stale `ctx.state`.
- 2026-09-24: the unique key is the normalised email (trim, lower case), checked again in the
  database with `waitlist_entries_email_lower` as a backstop against a write that skips
  normalisation.

## Open questions

- `docs/questions.md`, "waitlist: submission rate limit".
- `docs/questions.md`, "waitlist: which fields are required".
- `docs/questions.md`, "waitlist: repeat sign-ups".
- `docs/questions.md`, "waitlist: sending interface".

## Incidents

None.
