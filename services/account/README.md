# @nabvy/account

The account's life: profile, Telegram links, push subscriptions, deletion requests, API keys and
the record of its standing (`docs/design/modules/account.md`).

## Switch and priority

Off by default (rule 11 of `docs/design/modules/_rules.md`; no seed row exists yet, so
`switches.state('account')` reads `off` until an admin turns it on). Off: profile, channel and
deletion writes are refused (`account.module_off`); `setStanding()` also refuses, so no new
suspension or ban is recorded. **Exceptions**: `isActive()`/`assertActive()` are unaffected either
way, because they read `better_auth.user` directly through `@nabvy/auth`, never this module's
switch — "if account is off, suspensions and bans already recorded still apply" (rule 11) —  and
`v_channels`/`v_standing` always return their rows (rule 11's named exemption), so
`account-integrity`'s reads and `want-manager`/`alert-router`'s fair-use limits keep working. MVP,
wave 2, backlog task 4.3a.

## Standing: which function owns what

`docs/questions/account.md` records an open ownership point: PR #9 (task 4.0) built an account standing
check inside `auth` — `better_auth.user`'s `banned`/`ban_expires`/`restriction_policy` columns, the
audited `restrictAccount`/`liftRestriction` functions, and the SQL functions
`better_auth.account_active`/`account_restriction` that `nabvy_app` and `nabvy_pipeline` may call
directly — while the module catalogue's card gives the `account` module the `standing` table,
`setStanding()` and `isActive()`. Building a second, competing notion of "suspended until when" in
this module would let the two drift. The split below keeps exactly one implementation of each
piece:

| Piece | Owned by | This module's part |
| --- | --- | --- |
| Whether an account may be acted for right now | `auth`, `better_auth.account_active(user_id)` | `isActive(q, userId)` is a one-line call to `@nabvy/auth`'s `isAccountActive(q, userId)`, which itself is a direct call to that SQL function on the caller's own connection. No lookup here to keep in step. |
| The notice a restricted user may see (step and policy only) | `auth`, `accountRestrictedNotice()` | `assertActive(q, userId)` calls `@nabvy/auth`'s `assertAccountActive(q, userId)` and lets `AccountRestrictedError` propagate; this module builds no wording of its own. |
| Flipping the ban, revoking sessions, that action's own audit row | `auth`, `restrictAccount()` / `liftRestriction()` | `setStanding()` parses its input, then calls these (their own connection, as `nabvy_auth`; not part of this module's transaction) before writing anything of its own. The dependency seam a test needs to inject a fake or the real functions (`src/standing.ts`, `setStandingWith`) is never part of the exported `setStanding()`'s signature, so no caller can skip this call. |
| Fair-use limits, and this module's own audit trail of who changed standing and why | `account`, the `standing` table | `setStandingWith()` writes `account.standing` (`status`, `until`, `limits`, `action_id`, `at`) after the `auth` call succeeds, recording its own `account.standing-changed` audit-log row and using that row's ID as `action_id`. `getStanding()` and `v_standing` read it back. |

`setStanding()` is called only by `account-integrity` (automated) or an audited admin override,
both inside `withPipeline` — the database has no admin check for `nabvy_app` yet, the same gap
`docs/questions.md` records for `switches` ("w1 switches: who may write a switch"), so this module
follows the same convention rather than inventing a different one.

## Inputs

- Web forms: profile updates, Telegram link-code requests, push subscribe/unsubscribe, export and
  deletion requests — all through a future oRPC procedure calling this module's functions inside
  `withUser`.
- The Telegram bot's link callback: `confirmTelegramLink()`, with no user session, runs inside
  `withPipeline`.
- `setStanding()` calls from `account-integrity` (soft dependency) or an audited admin override.
- Reads: `@nabvy/switches`' `isOn(q, 'account')` and `isOn(q, 'account-integrity')`; `@nabvy/auth`'s
  `isAccountActive`, `assertAccountActive`, `restrictAccount`, `liftRestriction`; `@nabvy/audit-log`'s
  `record()`.

## Outputs

- **Events**: `account.deleted` v1 `{ userId }`; `account.standing-changed` v1 `{ userId }`;
  `account.channel-linked` / `account.channel-unlinked` v1 `{ userId }` (naming note below).
- **Internal views** (`nabvy_pipeline` only, no per-module roles yet):
  - `account.v_profiles` (user_id, display_name, analytics_consent, design_partner, created_at).
  - `account.v_channels` (user_id, kind, device_id, session_id, bound_at, revoked_at) — Telegram and
    push together, for `account-integrity`'s `checkChannelBinding()`. Exempt from the switch filter.
  - `account.v_standing` (user_id, status, until, limits) — for `want-manager` and `alert-router`.
    Exempt from the switch filter. No `action_id`: that is this module's own audit trail.
- **Functions** from `@nabvy/account`: `getProfile`, `updateProfile`, `createTelegramLinkCode`,
  `confirmTelegramLink`, `unlinkTelegram`, `subscribePush`, `unsubscribePush`, `exportAccount`,
  `requestDeletion`, `accountDeletedEvent`, `purgeDueDeletions`, `getStanding`, `setStanding`,
  `isActive`, `assertActive`.

### Naming note

The module catalogue's card names the channel events `channel.linked`/`channel.unlinked`, but rule
7 of `docs/design/modules/_rules.md` fixes the event format as `<module>.<what happened>` and says
only the emitting module's own name is used. Kept here as `account.channel-linked` /
`account.channel-unlinked` to follow the rule; recorded in `docs/questions/account.md`.

## Tables

All in the `account` Postgres schema.

- `user_profiles`: `user_id` (primary key), `display_name`, `analytics_consent`, `design_partner`,
  `created_at`, `updated_at`.
- `telegram_links`: `user_id` (primary key — one chat per user), `chat_id` (one active link per
  chat: a partial *unique* index over non-revoked rows), `linked_at`, `revoked_at`.
- `telegram_link_codes`: `code_hash` (primary key, `sha256` of the 8-char code, 64 hex chars — the
  plain code is never stored, the same reason `api_keys` stores `hashed_key`), `user_id`,
  `session_id` (the device the request came from), `created_at`, `expires_at`, `used_at`.
- `push_subscriptions`: `id` (primary key), `user_id` + `device_id` (unique), `session_id`,
  `endpoint`, `keys` (jsonb), `paused_at`, `revoked_at`, `created_at`, `updated_at`.
- `deletion_requests`: `user_id` (primary key), `requested_at`, `purge_by`, `purged_at`.
- `api_keys`: `id` (primary key), `user_id`, `hashed_key`, `label`, `created_at`, `last_used_at`,
  `revoked_at`. Scaffolded for task 5.4a (after the MVP); not wired to any procedure yet.
- `standing`: `user_id` (primary key), `status` (`active | suspended | banned`), `until`, `limits`
  (jsonb), `action_id` (the `audit_log` entry `setStanding()` wrote), `at`. Check constraints tie
  `until` to `suspended` only. Written only by `nabvy_pipeline` (see "Standing" above); never read
  by `isActive()`.

## Rules and thresholds

| Rule | Value | Basis | Status |
| --- | --- | --- | --- |
| Telegram link code TTL | 10 minutes | Module card: "single-use 10-minute link codes" | Fixed by the card |
| Telegram re-link window | 30 days | `packages/config/src/modules/account.ts` | Starting value |
| Telegram re-link cap per plan | `default`/`free`: 1, `standard`: 3, `business`: 10 completed links per window | Card: "re-links capped per plan"; plan names from `docs/billing.md`, not yet built by `subscriptions` | Starting value; product decision needed (`docs/questions/account.md`) |
| Telegram link code issuance limit | 5 codes per hour, any outcome | Separate from the re-link cap above (which counts only completed links); stops a script requesting codes | Starting value, pending abuse data |
| Deletion purge delay | 24 hours | `docs/security.md:11` | Fixed |
| "Established device" gate on a new Telegram link or push subscription | Allowed whenever `account-integrity` is off | Card: `checkChannelBinding()` is a soft dependency, "allows when off"; `account-integrity` is not built yet, so `switches.state('account-integrity')` has no row and fails closed to `off` | Placeholder pending `account-integrity`; recorded in `docs/questions/account.md` |

## Fixtures and pass rate

Three stages, each built from the backlog's "Done: Playwright covers link, export and delete"
(`docs/backlog.md:72`), as synthetic cases (there is no recorded Facebook run to build account
fixtures from):

- `link` (`test/fixtures/link.fixtures.ts`), 3/3: a code confirmed once; an expired code refused;
  a code confirmed twice (the Telegram callback's at-least-once delivery) refused the second time
  with exactly one link row.
- `export` (`test/fixtures/export.fixtures.ts`), 2/2: a profile with one linked channel; an empty
  account. Both check the export carries no enforcement wording.
- `delete` (`test/fixtures/delete.fixtures.ts`), 2/2: a request sets `purge_by` 24 hours out; a
  second request for the same account is refused.

`test/domain.test.ts` covers the pure link-code, re-link cap, issuance cap, code hashing,
standing-transition and idempotency key logic. `test/idempotency.test.ts` runs `setStandingWith`
and `confirmTelegramLink` twice each, and checks a suspension refuses until its `until` date and
allows again after. `test/switch.test.ts` covers off/on and the two switch-filter exemptions.
`test/relink.test.ts` covers the plan re-link cap: an expired, never-confirmed code does not use it
up, and a second completed link inside the window is refused. `test/standing.test.ts` runs
`setStandingWith` through the *real* `@nabvy/auth` `restrictAccount`/`liftRestriction` (never a
fake), proving a non-admin actor is refused by auth's own admin-role check and nothing is written.
`test/purge.test.ts` covers `purgeDueDeletions`: a batch of due users erased, an un-due one left
alone, and a repeat call finding nothing left to purge (idempotent). `test/contracts.test.ts`
checks the events and `AccountSetStandingInput`'s transition rules. `packages/db/tests/account.test.sql`
covers grants (including the purge sweep's delete grants), RLS isolation (including WITH CHECK on
`telegram_links`, `push_subscriptions` and `deletion_requests`) and the `standing` check
constraints on real Postgres (`pnpm db:dry-run`).

**Auth is not stood up in this module's own suite.** `restrictAccount`/`liftRestriction` need a
running Better Auth instance (their own `nabvy_auth` connection); PGlite serves one connection, so
a second one open at the same time as this module's own transaction would deadlock. Tests inject a
fake for those two functions instead (`test/idempotency.test.ts`, `test/switch.test.ts`); the read
side (`isActive`/`assertActive`) runs the real `better_auth.account_active`/`account_restriction`
SQL functions against the real migrations, and the write side is `auth`'s own to test
(`services/auth/test/auth.test.ts`).

## Decisions

- 2026-09-24 (review of PR #33): Telegram link codes are generated with `node:crypto`'s
  `randomInt` (never `Math.random`, which is predictable) and stored as `sha256(code)`, never the
  plain code. `createTelegramLinkCode()` no longer takes a `random` parameter; `domain.generateLinkCode`
  keeps its injectable seam for `domain.test.ts`'s deterministic cases only.
- 2026-09-24 (review of PR #33): the plan re-link cap counts *completed* confirmations in the
  window (`repo.countCompletedLinksInWindow`), never issued codes, so an expired or mistyped code
  never locks a user out of their own device. A separate, short-window issuance limit (5 codes per
  hour, independent of plan) stops a script from hammering the endpoint.
- 2026-09-24 (review of PR #33): `setStanding()`'s dependency seam (which lets a test inject a fake
  `restrictAccount`/`liftRestriction`) moved out of the public export into an internal
  `setStandingWith()` (`src/standing.ts`). The exported `setStanding()` parses its input with
  `AccountSetStandingInput.parse()` first and always calls the real `@nabvy/auth` functions: no
  caller can skip the parse or auth's own admin-role check.
- 2026-09-24 (review of PR #33): `purgeDueDeletions(q, now)` ships the 24-hour purge sweep this
  module's part of backlog 4.3a needed: a batch, idempotent function that erases every row this
  module holds (including the `deletion_requests` row itself) for a user whose `purge_by` is due,
  and returns one `account.deleted` envelope per user for the sweep task to publish. Not gated by
  the module switch (a retention deadline, not a toggled feature). The grants it needs
  (`nabvy_pipeline` delete on `telegram_link_codes`, `deletion_requests`, `api_keys`, `standing`)
  are their own migration, `20260924163054_account_purge_grants.sql`, for the coordinator to apply
  alongside the rest of this module's migrations.
- 2026-09-24 (backlog 4.3r): the sweep task is `trigger/account-purge-schedule.ts`, a thin
  Trigger.dev scheduled task (every 15 minutes) that calls `purgeDueDeletions` directly. It does
  not publish the `account.deleted` events the function returns: no task consumes them yet, and the
  `TriggerClient` publisher adapter (`packages/transport/src/trigger.ts`) is task 1.2's to build
  (`docs/questions/schedules.md`, which also covers this and `pg_cron`'s task 0.12 as the
  alternative the backlog named).
- 2026-09-24: `isActive()`/`setStanding()` delegate to `@nabvy/auth` rather than re-deriving the
  suspended-until-date logic (see "Standing" above). This resolves the ownership overlap
  `docs/questions/account.md` records between this module's card and PR #9.
- 2026-09-24: the channel events are `account.channel-linked`/`account.channel-unlinked`, not the
  card's `channel.linked`/`channel.unlinked`, to follow rule 7's naming format.
- 2026-09-24: `account-integrity`'s `checkChannelBinding()` is resolved locally as "allowed unless
  `account-integrity` is on" (rule 11's fail-closed default), since that module does not exist yet;
  replace with a real call once it ships.
- 2026-09-24: `standing` is written only by `nabvy_pipeline`, matching the convention
  `docs/questions.md` records for `switches` ("who may write a switch"): no admin check exists yet
  for `nabvy_app`, so a signed-in session can never flip standing directly.
- 2026-09-24: no `app.*` user-facing view is added by this module. No module has created the `app`
  schema yet (the web app's oRPC layer is a separate, not-yet-built pull request); when it is
  built, its procedures call this module's exported functions inside `withUser`, per rule 12,
  rather than this module inventing the first `app.*` view ahead of that work.

## Open questions

- `docs/questions/account.md`, "w1 account: standing ownership (auth vs. account)".
- `docs/questions/account.md`, "w1 account: Telegram re-link plan names and caps".
- `docs/questions/account.md`, "w1 account: checkChannelBinding() has no account-integrity to call yet".
- `docs/questions/account.md`, "w1 account: setStanding() writes in two transactions".
- `docs/questions/account.md`, "w1 account: refusing new bans while account is off goes beyond the card".
- `docs/questions/account.md`, "w1 account: grants could be narrower".
- `docs/questions/account.md`, "w1 account: exportAccount() covers only this module's rows".

## Incidents

None.
