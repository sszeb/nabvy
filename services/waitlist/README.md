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
- **Functions** from `@nabvy/waitlist`: `submit(db, input, ctx)` → `Result<{ joined: true },
  WaitlistError>`, the same shape whether the address is new or already on the list, and never the
  stored row (PR #31 review: a public form must not let anyone learn who else signed up, or read
  back their postcode, products or UTM by resubmitting their address); `list(db)` → `WaitlistEntry[]`,
  the pipeline read of `v_waitlist`, the only way to read stored entries.
- **SQL function** `waitlist.join(email, postcode, wanted_products, utm_source, utm_medium,
  utm_campaign, utm_term, utm_content) returns void`: `SECURITY DEFINER`, `EXECUTE` for `nabvy_app`
  only. Inserts with `on conflict (email) do nothing` as the table's owner and returns nothing, so
  `submit()` can write without any direct privilege — not even `SELECT` or `INSERT` — on
  `waitlist.entries` (PR #31 review).
- **`WaitlistSender`**: an interface (`send(entry): Promise<void>`) and its only implementation,
  `InMemoryWaitlistSender`, which records entries instead of sending anything. No email or DNS
  account exists yet (`docs/secrets.md`), and `submit()` does not call a sender today; this exists
  so a later task can wire in a real one (Resend, say) without changing `submit()`'s signature
  (`docs/questions.md`, "waitlist: sending interface").

## Tables

`waitlist.entries`: `id` (uuid pk), `email` (unique, lower-case, the dedupe key), `postcode`
(nullable, upper-cased with one space), `wanted_products` (nullable text array), five nullable
`utm_*` columns, `created_at`/`updated_at`. `nabvy_app` has no privilege on this table at all, not
even `INSERT`: `insert ... on conflict do nothing` still needs `SELECT` to detect the conflict, so
`submit()` writes through `waitlist.join(...)`, a `SECURITY DEFINER` SQL function that runs as the
table's owner and returns nothing (PR #31 review) — a public submission can never learn whether an
address it names is already on the list, or read that address's stored data;
`packages/db/tests/waitlist.test.sql` checks the denial on real Postgres.
`waitlist.submission_attempts`: `key` (pk, the hex SHA-256 of the caller's IP address,
never the address itself), `count`, `window_start` — the Postgres-backed rate-limit counter for
`submit()`, the same pattern as Better Auth's own `rate_limit` table (`services/auth/src/auth.ts`,
`consumeMagicLinkQuota`).

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
switch is off. Each case checks `submit()`'s return (identical for a new or repeat address) and,
separately, the row actually stored (read directly from the table, since `submit()` cannot read it
back). Latest pass rate: 5/5. Other tests: `test/domain.test.ts` (pure logic: `checkSwitch`,
`planEntry`, `toEntry`), `test/idempotency.test.ts` (a repeat address writes one row, keeps the
first entry, and gets the same result as a new one),
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
- 2026-09-24: `submit()` returns `{ joined: true }` only, whether the address is new or already on
  the list, and `nabvy_app` gets no direct privilege on `waitlist.entries` at all: writes go
  through the `SECURITY DEFINER` function `waitlist.join(...)`, because `insert ... on conflict do
  nothing` still needs `SELECT` on the table to detect the conflict (review of PR #31, both
  blockers). A public form must not tell one visitor that another's address is already on the list,
  or hand back that address's postcode, wanted products or UTM by resubmitting it.
- 2026-09-24: `wanted_products` may later feed demand counts, but only with consent (module card);
  no consent is captured by this task, so `waitlist.v_waitlist`'s only reader must not aggregate it
  into a demand count yet (review of PR #31, non-blocking).
- 2026-09-24: `submission_attempts` has no pruning yet; the table grows by one row per distinct IP
  that has ever submitted (review of PR #31, non-blocking; `docs/questions.md`, "waitlist:
  submission-attempts pruning").
- 2026-09-24: the rate-limit key is an unsalted SHA-256 of the IP address (review of PR #31,
  non-blocking: key it with an HMAC secret, as `SELLER_HASH_SALT` salts seller IDs). No such secret
  is listed in `docs/secrets.md` for this purpose, so none is invented here (`CLAUDE.md`, "No
  secrets in the repo"); `docs/questions.md`, "waitlist: IP hash secret" records the gap.

## Open questions

- `docs/questions.md`, "waitlist: submission rate limit".
- `docs/questions.md`, "waitlist: which fields are required".
- `docs/questions.md`, "waitlist: repeat sign-ups".
- `docs/questions.md`, "waitlist: sending interface".
- `docs/questions.md`, "waitlist: submission-attempts pruning".
- `docs/questions.md`, "waitlist: IP hash secret".

## Incidents

None.
