# @nabvy/audit-log

Records every human and admin action, one append-only row each: who, what, on what, before and
after, why, when.

## Switch and priority

No switch: the audit log cannot be switched off (card; `_rules.md` rule 11). An action that
needs an audit row is refused when the row cannot be written: `record()` throws
`AuditLogRefused` inside the caller's transaction, which rolls the action back. Priority P0
(`docs/security.md`: "every role change and admin action writes `audit_log`").

## Inputs

- `record(q, input)` calls from modules and admin procedures, with the transaction that performs
  the action (`withUser(actorUserId, …)` from the web app, `withPipeline` from tasks).
- `recordRestrictedRead(q, { actorUserId, view, reason })` for developers' read sessions of a
  restricted view (question 10).
- No events consumed, no other module's views read. Depends on no module.

## Outputs

- Exported functions: `record`, `recordRestrictedRead`, `listEntries` (admin screen; newest
  first by `(at, id)`, filter by actor and target, page with `before: { at, id }` of the last
  entry seen), `AuditLogRefused`.
- Internal view `audit_log.v_entries` (admin only): `id, actor_user_id, action, target, before,
  after, reason, at`. `security_invoker`. Granted to no application role yet (Open questions).
- No restricted or user-facing views. No events.
- Contracts (`@nabvy/contracts/modules/audit-log`): `AuditLogRecordInput`, `AuditLogEntry`,
  `AuditLogListInput`, `AuditLogAction` (`<module>.<what-happened>`), `AuditLogTarget`
  (`<kind>:<id>`), `AuditLogErrorCode` (`audit-log.invalid_entry`, `audit-log.unavailable`),
  `AUDIT_LOG_RESTRICTED_READ`.

## Tables

`audit_log.entries`: `id` (uuid v7, made in code so writers need no select), `actor_user_id`,
`action`, `target`, `before` and `after` (jsonb, nullable), `reason`, `at` (set by the database).
Indexes on `at`, `(actor_user_id, at)`, `(target, at)`. No unique key besides `id`: every call is
its own row.

Access (`packages/db/migrations/audit-log/*_audit_log_access.sql`):

| Role | Grant | Policy |
| --- | --- | --- |
| `nabvy_app` | insert | only rows whose `actor_user_id` is the `withUser` user |
| `nabvy_pipeline` | insert | any row: the pipeline is trusted to name the real actor |
| `nabvy_auth` | insert | only rows whose `actor_user_id` is an existing account (task 4.0b, `better-auth/20260924143843_better_auth_audit_access.sql`) |
| anyone | no select, update, delete or truncate | triggers refuse update, delete and truncate even for the owner |

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Action format | `<module>.<what-happened>`, kebab case, ≤ 100 chars | Event naming (`_rules.md` rule 7) | Fixed |
| Target format | `<kind>:<id>`, no spaces, ≤ 300 chars | So an admin can filter by target | Fixed |
| Reason | 1–1000 chars after trimming; required for `audit-log.restricted-read` | Card, question 10 | Starting value |
| Before/after size | ≤ 64 KiB of JSON each | Stops a caller dumping a whole record set into the log | Starting value |

The formats and the restricted-read reason are checked both in Zod and as table constraints.

RLS is on with insert policies only. Granting `v_entries` (a `security_invoker` view) to
`nabvy_app` later would return no rows until a select policy for admins is added as well.

## Fixtures and pass rate

Stage `record` (`test/fixtures/record.fixtures.ts`): seven synthetic cases in
`test/fixtures/cases/` (role change, suspension with a reason, restricted read with and without
a reason, a forged actor, no session, a bad action), each one `record()` call against the real
migrations in PGlite. Latest: 7/7.

Other tests: `domain.test.ts` (validation, boundary values of each limit), `record.test.ts`
(one row per call; no read, update, delete or truncate for either role; owner refused too; a
failed write rolls the caller's action back), `contracts.test.ts` (`AuditLogEntry` matches the
view's columns and types), and `packages/db/tests/audit-log.test.sql` in `pnpm db:dry-run`.
There is no `switch.test.ts` (no switch; the refusal test in `record.test.ts` covers "when
off") and no `idempotency.test.ts` (no handlers; one row per call is the contract).

## Decisions

- 2026-09-24: `record()` writes in the caller's transaction instead of emitting an event, so
  "an action that needs an audit row is refused" holds by rollback, with no outbox.
- 2026-09-24: `at` is set by the database (`now()`, the transaction's start), never by the
  caller. No `updated_at`: rows never change.
- 2026-09-24: the web app may record only as its signed-in user (RLS), so a procedure cannot
  attribute an action to someone else.
- 2026-09-24: `AuditLogEntry` is written in Zod, not derived with `drizzle-zod`. This departs
  from `_rules.md` rule 3: that package is not in the repo, and contracts cannot import
  `@nabvy/db` (db depends on contracts). `test/contracts.test.ts` compares its keys and types
  with the Drizzle view declaration, so drift fails the build.
- 2026-09-24: `at` is `timestamptz(3)` and pages resume from `(at, id)`. Rows written in one
  transaction share one `at`, and millisecond precision is what an ISO timestamp carries, so the
  cursor round-trips exactly and no row is skipped or repeated (review of PR #15).
- 2026-09-24: `nabvy_pipeline` may record any actor; the web app only its signed-in user.
- 2026-09-24: before and after states are stored as given, including any seller fields an
  internal action touches; the view is admin only and never reaches end users.

## Open questions

- Who may read `v_entries` (`docs/questions.md`, "w1 audit-log: who may read `v_entries`").
- How append-only rows fit erasure and the account-deletion purge (`docs/questions.md`, "w1
  audit-log: append-only and erasure").
- How developers' restricted reads are enforced (`docs/questions.md`, "w1 audit-log: how
  developers' restricted reads are recorded").

## Incidents

None.
