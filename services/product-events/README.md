# @nabvy/product-events

Records first-party product events through one `track()`, and forwards them to PostHog only when
the user has consented (`docs/design/modules/product-events.md`).

## Switch and priority

Off by default (rule 11 of `docs/design/modules/_rules.md`). `track()` never refuses while off: it
silently records and forwards nothing (module card, "When off": "nothing recorded; features
unaffected"), because an instrumentation call must never fail the action it is timing. Group
Operations, BP1 (`docs/backlog.md:31`, task 1.9d). Depends on: `switches`, `account`.

## Inputs

- `track(db, userId, input, ctx)` calls from procedures (inside `withUser(userId)`) and pipeline
  tasks (inside `withPipeline`).
- `@nabvy/account`'s `getProfile()` for consent (module card, "Inputs": `v_profiles`). A user with
  no profile row yet is treated as not consented, the conservative default.
- `@nabvy/switches`' `isOn`/`state('product-events')`, read by the caller and passed in as
  `ctx.state` (this module does not call `@nabvy/switches` itself, the same shape `@nabvy/waitlist`
  uses for `ctx.state`).

## Outputs

- **Owned table:** `product_events.events`, monthly range-partitioned on `at`
  (`docs/contracts.md:185`). Append-only, the `audit_log.entries` pattern: no `updated_at`, and no
  role is granted update, delete or truncate.
- **Internal view:** `product_events.v_events` (id, userId, event, properties, sessionId, at).
  Returns no rows while the switch is off (rule 11). No user-facing view (module card, "Views").
- **Events:** none; this module publishes no domain events (module card, "Outputs": "none beyond
  its view").
- **Functions** from `@nabvy/product-events`: `track()`; `NoopProductEventsForwarder` and
  `InMemoryProductEventsForwarder` (the injectable PostHog seam, below).

## Tables

Postgres schema `product_events`.

- `events`: `id` (uuid, default `nabvy_core.uuidv7()`), `user_id`, `event`, `properties` (jsonb),
  `session_id` (nullable), `at`. Primary key `(id, at)` -- Postgres requires the partition key in
  every unique index of a partitioned table. Indexes `(event, at desc)` and `(user_id, at desc)`
  (`docs/contracts.md:190`).

## Rules and thresholds

No numeric thresholds: `track()`'s only gates are the switch state and consent, both read from
elsewhere. The property allowlist (`ProductEventsEvent`, `packages/contracts/src/modules/product-events.ts`)
predates this task (0.10) and is unchanged here.

## Fixtures and pass rate

Stage `track` (`test/fixtures/track.fixtures.ts`), 6 synthetic cases against the real migrations
(PGlite), covering the two things the module card's "Tests and fixtures" line names:

- **Property allowlist:** a valid event is recorded; an event name `docs/analytics.md` does not
  list is refused; a known event carrying a property it does not declare (`postcode`) is refused.
- **Consent gate:** a consenting user's event is recorded and forwarded; a non-consenting user's is
  recorded but not forwarded; a user with no profile row at all defaults to not forwarded.
- **Switch:** off records and forwards nothing, without refusing.

Pass rate 6/6. `test/domain.test.ts` covers `planTrack`/`isRecording` directly (no I/O).
`test/contracts.test.ts` checks `ProductEventsEvent`/`ProductEventsRecord` and that the module
publishes no events. `test/switch.test.ts` covers off (no writes, empty view even for rows written
while on) and shadow (records and forwards the same as on, see "Decisions"). "At least one reader's
fixtures still pass with this module off" (rule 16) does not apply yet: no module declares
product-events as a dependency. `test/idempotency.test.ts` documents and proves the narrower
guarantee that applies here (see "Decisions"). `packages/db/tests/product-events.test.sql` covers
RLS isolation, append-only enforcement, the partition default backstop, the view's column allowlist
and switch filter, and its reader grants on real Postgres (`pnpm db:dry-run`).

## Decisions

- 2026-09-24: `track()` never refuses on switch state, only on `product-events.invalid_input`
  (an event name or property outside the allowlist). An instrumentation call sits inline in the
  action it is recording (a sign-up, an alert delivery); refusing it for the module being off
  would make analytics coupling break product features, which "features unaffected" (module card)
  rules out.
- 2026-09-24: `shadow` and `on` behave identically here -- both record and both forward to PostHog
  with consent. Rule 11 of `_rules.md` only says shadow suppresses *user-facing* rows, and this
  module has none (module card, "Views": "internal v_events. User-facing: none"), so there is
  nothing for shadow to hide.
- 2026-09-24: CLAUDE.md's idempotency key (`source + sourceListingId + contentHash`) is for event
  handlers replaying pipeline events. `track()` has no handlers and no natural idempotency key: two
  calls for the same user and event name are two real occurrences (a user opening two alerts is two
  `alert_opened` events), not a replay to collapse. `test/idempotency.test.ts` proves the narrower
  guarantee this module does owe -- calling `track()` twice is safe and never corrupts state --
  rather than a dedupe this module does not attempt.
- 2026-09-24: `track()` reads consent itself, through `@nabvy/account`'s `getProfile()`, rather
  than asking every caller to look it up and pass it in. This matches the module card's own
  "Inputs" line (`v_profiles`) and keeps consent's source of truth in one place.
- 2026-09-24: this module does not depend on `@nabvy/telemetry` (not listed in the module card's
  "Depends on": switches, account only). `track()` takes an optional `ctx.forwarder` matching
  `@nabvy/telemetry`'s `createPostHogServer().capture(userId, hasConsent, event)` signature
  structurally, defaulting to a no-op; the web app or a task passes the real client in. This keeps
  the module graph as the card states it, while still letting `track()` do the forwarding the
  module card describes ("Does / does not": "forwards to PostHog only with consent") rather than
  splitting that behaviour into a second function callers must remember to invoke.
- 2026-09-24: the table's very first migration is Drizzle-generated (a plain, unpartitioned
  `CREATE TABLE`), immediately dropped and replaced by a hand-written partitioned one in the next
  migration (`packages/db/src/schema/product-events.ts`, top comment). This keeps the Drizzle
  snapshot in step with `schema.ts`, so a later plain column change and `pnpm db:generate
  product-events` produce an ordinary `ALTER TABLE`, which Postgres applies to a partitioned table
  like any other.

## Not yet: partition rotation

The access migration creates monthly partitions for one month back through three months ahead of
whenever it is applied, plus a default partition that catches anything outside that window so a
write is never refused for lack of a partition. Keeping `product_events.ensure_month_partition()`
called ahead of `now()` on an ongoing basis (a scheduled job) is not wired up: this task's scope is
the consent gate and the property allowlist (`docs/backlog.md:118`, task 1.9d "Done"), and no
`pg_cron` job exists anywhere in this repository yet to follow a precedent from. See
`docs/questions/product-events.md`.

## Open questions

- `docs/questions/product-events.md`, "product-events: monthly partition rotation".

## Incidents

None.
