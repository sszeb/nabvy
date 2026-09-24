# @nabvy/incidents

One atomic module (`docs/decisions.md`, "Atomic modules"). A module session edits only this
folder, `packages/contracts/src/modules/incidents.ts`, `packages/db/src/schema/incidents.ts` and
`packages/db/migrations/incidents/`.

## Job

Keeps every event that failed all its retries, so nothing is lost silently
(`docs/design/modules/incidents.md`). After 3 attempts (5 s, 30 s, 2 min) the task wrapper
records the event and its error with `record()` (`docs/engineering.md`, "Events and tasks"). An
admin can retry one with `retry()`, which reconstructs and returns the original event envelope so
the caller can re-emit it, and marks the incident resolved. incidents never retries on its own.

## Inputs

- `record(db, input)`: called directly by the task wrapper once an event has exhausted its
  retries. Not an event handler — incidents consumes no other module's events ("Depends on:
  none").
- `retry(db, incidentId)`: called by an admin action (through an oRPC procedure).

## Outputs

- Event `incidents.dead-lettered` (`{ incidentIds }`), built and returned by `record()`. This
  module has no transport wiring yet: nothing in the repository publishes an event onto
  Trigger.dev today (no task wrapper, no publisher helper exists), so `record()` returns the
  validated envelope for a future caller to emit once that layer is built. Recorded in
  `docs/questions.md`.
- Internal view `incidents.v_open`: open (unresolved) incidents. No user-facing view.

## Owned tables

Postgres schema `incidents`.

- `incidents`: one row per dead-lettered event, keyed by its idempotency key (`event_key`,
  unique). `payload` holds the *whole* original event envelope (`id`, `type`, `v`, `at`, `key`,
  `payload`), not just its payload field, because `retry()` needs the full envelope to reconstruct
  and re-emit the original event. `error` is the module's `AppError` (`code`, `message`).
  `attempts` and `first_failed_at` describe the failed run; `resolved_at` is set by `retry()` and
  cleared again if the same `event_key` fails once more after being retried (see "Decisions").

## Views

- `incidents.v_open` (internal; readers: `nabvy_app`, `nabvy_pipeline`): `id, event_type,
  event_key, payload, error, attempts, first_failed_at, created_at, updated_at`, filtered to
  `resolved_at is null`. No seller fields ever reach this table, so there is nothing to strip.

## Events

- `incidents.dead-lettered` v1: `{ incidentIds: Uuid[] }` (1–500). Key: the recorded incident's
  own `event_key` (the original event's idempotency key). Stamps no T-timestamp: incidents sits
  outside the T0–T7 pipeline chain (`docs/design/modules/_rules.md`, rule 10) and instead stores
  `first_failed_at` as the input it processed.

## When switched off

Cannot be switched off: the task runner needs it (`docs/design/modules/incidents.md`, "When
off"). incidents has no entry in `switches` and its handlers never consult one; `test/switch.test.ts`
checks both.

## Tests

Unit tests: `pnpm --filter @nabvy/incidents test` — `test/domain.test.ts` (pure logic, boundary:
an incident with `resolvedAt: null` is retryable, any non-null value is not),
`test/contracts.test.ts` (events and rows parse/round-trip, thin-payload and strict-object
rejections), `test/idempotency.test.ts` (`record()` called twice for the same `event_key` writes
one row; a retried incident that fails again is reopened; `retry()` refuses a second call and a
missing incident) and `test/switch.test.ts` (above). `test/domain.test.ts` and
`test/contracts.test.ts` need no database; the rest run against an in-process Postgres (PGlite)
with the `core` and `incidents` migrations applied, the same pattern as
`services/auth/test/support/database.ts`.

Fixture stage `dead-letter` (`test/fixtures/dead-letter.fixtures.ts`, run by `pnpm test:fixtures`):
synthetic envelopes built from the module's card, not a recorded provider run — incidents touches
no marketplace data. Two cases (a single-listing Facebook event, a two-listing eBay batch event),
each checked against the card's "Tests and fixtures" line: one record per envelope key, and a
retry re-emits the same envelope. Latest recorded pass rate: 4/4 (100%).

`packages/db/tests/incidents.test.sql` (run by `pnpm db:dry-run`): only `nabvy_pipeline` can
insert; neither role can delete; the upsert on `event_key` is idempotent; `nabvy_app` can resolve
an incident but not create one; `v_open`'s column list and its exact set of readers
(`nabvy_app`, `nabvy_pipeline`). The global view and Data API checks
(`security_invoker`, no seller-shaped columns, nothing in `public`, no `anon`/`authenticated`
access) run once for every module in `tests/core.test.sql`.

## Decisions

- **2026-09-24: `payload` stores the whole original envelope, not just its `payload` field.** The
  card names the column `payload`, but `retry()` must return the *original event* unchanged
  (`id`, `type`, `v`, `at`, `key` included), so the column holds the full `EventEnvelope`. A
  narrower `payload`-only column would lose the information `retry()` needs to reconstruct it.
- **2026-09-24: `record()` upserts and reopens.** `event_key` is unique. A replay of the exact
  same failure (a handler retried at the transport level, itself idempotent) overwrites the row
  with the same values. A fresh failure of the same event after an admin's `retry()` clears
  `resolved_at`, reopening the incident, rather than creating a second row for the same key.
- **2026-09-24: no transport wiring in this module.** `record()` and `retry()` build and return
  validated event envelopes but do not call Trigger.dev (or any publisher) to actually emit them:
  no such helper exists anywhere in the repository yet (the task-wrapper and event-transport layer
  are later tasks). Recorded in `docs/questions.md` for the coordinator.
- **2026-09-24: no per-module database role.** `docs/design/modules/_rules.md` proposes one
  Postgres role per module; the built foundation (`packages/db/README.md`) still uses the
  two-role model (`nabvy_app`, `nabvy_pipeline`). This module follows what is actually built: the
  task wrapper writes as `nabvy_pipeline`, an admin's retry as `nabvy_app`.
- **2026-09-24: no RLS.** `incidents` carries no `user_id`; it is operational data, not user data,
  so no row-level security policy is attached (`packages/db/README.md`, "Adding tables to a
  module" describes the RLS path for tables that do carry one).
