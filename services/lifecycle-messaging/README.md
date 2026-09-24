# @nabvy/lifecycle-messaging

Runs behaviour-triggered lifecycle messages through PostHog Workflows and Resend
(`docs/design/modules/lifecycle-messaging.md`).

## Switch and priority

Off by default (rule 11 of `docs/design/modules/_rules.md`; no seed row exists yet, so
`switches.state('lifecycle-messaging')` reads `off` until an admin turns it on). Off: `run()`
returns immediately (module card, "When off": "no lifecycle messages") — nothing is scanned,
nothing is sent, nothing is written, and `v_runs` returns no rows. MVP, BP4, backlog task 4.6b
(kept as the `lifecycle-messaging` atomic module).

`shadow` behaves exactly like `off`: `run()` gates on `isOn()`, which is true only for `on`, so a
`shadow` switch also evaluates nothing and writes nothing (see "Decisions").

## Inputs

- `product_events.v_events` (module: `product-events`), read directly (`@nabvy/db/schema/product-events`):
  every programme's trigger, exit and goal events, and the properties personalising a step's copy.
- `account.v_profiles` (module: `account`), read directly (`@nabvy/db/schema/account`): a user's
  `display_name` for copy personalisation.
- `canMarket(q, { userId, email, category })` (module: `marketing-consent`): the gate every
  marketing-category step checks before sending.
- `switches.isOn(q, 'lifecycle-messaging')` (module: `switches`).
- Consumes `account.deleted` (module: `account`): purges this module's `programme_runs` rows for
  the deleted user (rule 12 of `_rules.md`).

## Outputs

- **Sends** (module card, "Outputs"): a `ResendClient.send()` call per message, and a matching
  `PostHogWorkflowsClient.recordStepRun()` call (`src/send-clients.ts`; both in-memory today, see
  "Decisions").
- **Internal view** `lifecycle_messaging.v_runs` (user_id, programme, step, triggered_at, at):
  every run, while the switch is not off (rule 11).
- **Functions** from `@nabvy/lifecycle-messaging`: `run(q, deps?)` (the scheduled scan and send),
  `purgeUser`, `accountDeletedHandler`, plus the domain catalogue (`PROGRAMMES`, `decideStep`,
  `renderCopy`, `categoryOf`, `isMarketingStep`) and the send-client interfaces and in-memory
  implementations.
- Publishes no domain events (module card, "Outputs": "sends" only).

## Owned tables

Postgres schema `lifecycle_messaging`.

- `programme_runs`: one row per message actually sent. Primary key
  `(user_id, programme, step, triggered_at)` — extended from the card's literal
  `(user_id, programme, step, at)` with `triggered_at` (see "Decisions"). `programme` is checked
  against the seven built programmes (`src/domain/programmes.ts`).

## Views

`lifecycle_messaging.v_runs` (user_id, programme, step, triggered_at, at): internal, granted to
`nabvy_pipeline` only until a module declares `lifecycle-messaging` as a dependency and gets its
own role (`packages/db/README.md`, "One Postgres schema per module"). `security_invoker`; no
seller identity or raw provider row (there is none in this module).

## Events

None published (module card, "Outputs": "sends" only). Consumes `account.deleted` (module:
`account`); `lifecycle-messaging` sits outside the T0–T7 chain (rule 10 of `_rules.md`), so its
handler stamps no T-timestamp.

## When switched off

`run()` returns `{ evaluated: 0, sent: 0, skipped: {} }` without touching the database. No message
is sent, no `programme_runs` row is written, and `v_runs` returns no rows even for a run recorded
earlier while the switch was on.

## Tests

`pnpm --filter @nabvy/lifecycle-messaging test`:

- `test/domain.test.ts`: `decideStep`'s every branch (including the due-time and exit-time
  boundaries), the static programme catalogue, and `renderCopy` for every declared step.
- `test/contracts.test.ts`: `LifecycleMessagingRun` matches `v_runs`'s columns; the module
  publishes no events; every programme's trigger, exit and goal event name is a real
  `ProductEventsName`; the programme catalogue matches the contract's enum exactly.
- `test/switch.test.ts`: off (no writes, empty view even for a row written while on) and on
  (a due, consented step sends and is recorded).
- `test/idempotency.test.ts`: `run()` called twice on the same batch sends once; a later trigger
  occurrence (a new `triggeredAt`) can send again; `purgeUser` is idempotent.
- `test/handlers.test.ts`: `accountDeletedHandler` purges a deleted user's rows and is idempotent
  on replay.
- `test/re-engagement.test.ts`: the one inactivity-triggered programme, including the 14-day
  boundary and that it does not resend for the same inactivity anchor.
- `test/fixtures/run.fixtures.ts` (stage `run`, 7/7): the module's own acceptance test, "programmes
  fire from test events; suppressed addresses skipped" (module card, "Tests and fixtures";
  `docs/backlog.md:70`) — golden path, a suppressed address, the module off, an exit before the
  due time, not yet due, the daily marketing cap, and a service step ignoring consent. All
  synthetic (there is no recorded Facebook run to build lifecycle-messaging fixtures from; these
  are behaviour events, not listings).
- `packages/db/tests/lifecycle-messaging.test.sql` (in `pnpm db:dry-run`): `nabvy_app` holds
  nothing on the schema; `nabvy_pipeline` may select, insert and delete but never update; the
  primary key rejects a duplicate `(user_id, programme, step, triggered_at)`; the `programme` check
  constraint; the `v_runs` column list, switch filter and reader grants.

## Decisions

- 2026-09-24: **scope is the programmes whose trigger, exit and goal events already exist in
  `ProductEventsName`** (`packages/contracts/src/modules/product-events.ts`), not the full table at
  `docs/marketing.md:18-35` the module card's "Sources" line cites. This module never adds an event
  to another module's own contract file (rule 2 of `_rules.md`: a module session touches only its
  own files). Built: `abandoned-onboarding`, `channel-not-linked`, `activation`, `cap-reached`,
  `trial`, `win-back`, `re-engagement` (7 of the table's 12 rows). Not built, and recorded in
  `docs/questions/lifecycle-messaging.md`: "Abandoned checkout" (needs a `checkout_started` event),
  "Failed payment" (needs a Stripe `invoice.payment_failed`/`invoice.paid` event) and "Affiliate
  onboarding" (needs a Dub webhook event). "Nabvy Daily" and "Weekly review" are not this module's
  job at all: `docs/backlog.md` keeps them as the separate `daily-brief` module (task 4.6c).
- 2026-09-24: **`programme_runs`'s primary key adds `triggered_at`** to the card's literal
  `(user_id, programme, step, at)`, the same kind of documented, justified deviation
  `services/marketing-consent/README.md` makes for `canMarket()`'s signature. Without it, a
  recurring programme (`cap-reached`, `win-back`, `re-engagement`) could only ever message a user
  once in the table's lifetime, not once per real occurrence of its trigger.
- 2026-09-24: **service vs. marketing categorisation** follows `docs/marketing.md`, "Consent and
  the law" literally: `trial`'s three steps are billing/trial notices (category `null`, never
  gated by `canMarket()`, never counted toward the daily cap); every other programme's steps are
  marketing (`tips` or `offers`), gated and capped. `cap-reached`'s "trial offer with a bonus
  credit" is a sales offer, not a neutral notice, so it stays marketing despite the word "trial" in
  its name.
- 2026-09-24: **the daily marketing cap is global across programmes**, not per programme
  (`docs/marketing.md`: "a cap of one marketing message per user per day", no programme
  qualifier). `run()` tracks it per user for the duration of one call (seeded from
  `programme_runs`, incremented after each send in that call), so two programmes wanting to
  message the same user in one tick do not both send.
- 2026-09-24: **no skip is ever persisted.** `already-sent` and `exited` are recomputed from real
  `programme_runs`/`product_events` rows on every run; `wait`, `not-consented` and `daily-cap` are
  never written anywhere, so a step blocked today is retried automatically on a later run once the
  blocking condition changes.
- 2026-09-24: **`re-engagement`'s exit ("any activity") is never stored**: its `exitEvents` is
  empty, which `selectEarliestEventAfter` (`src/repo`) reads as "match any event, not a
  specific list" — a fresh `alert_opened`/`scan_started` moves the inactivity anchor itself and the
  14-day condition stops being true on its own, and any other event after that anchor still counts
  as the "any activity" exit `docs/marketing.md` names.
- 2026-09-24: **`selectEarliestEventAfter` and `selectDisplayNames` are called once per programme,
  not once per user** (review of PR #65, item 3; rule 9). Occurrences in one programme have
  different trigger times, so `selectEarliestEventAfter` takes a `userId → triggeredAt` map, fetches
  every candidate exit event since the earliest anchor in the batch in one query (ordered by `at`),
  and picks each user's own first match above their own anchor in memory, rather than reusing a
  single cutoff across users.
- 2026-09-24: **`run()` gates shadow the same as off** (review of PR #65, item 1, option (b)): the
  switch check is `isOn()` (true only for `on`), not `state() !== 'off'`, so `shadow` evaluates
  nothing and writes nothing, same as `off`. This module's only table, `programme_runs`, doubles as
  its send record and the `alreadySent` check that makes `run()` idempotent; a `shadow` run that
  evaluated and wrote a row without sending would make a later `on` run treat that step as
  already sent and skip the real send. Recording a run without treating it as sent would need a
  `sent`/`outcome` column this table does not have. Because the module's only output is a send
  (module card, "Outputs": "sends"), and it publishes no user-facing view for shadow rows to inform
  without sending, the smaller change is to keep `shadow` equal to `off` rather than add that
  column; `test/switch.test.ts` covers the `shadow` case (no send, no row, `v_runs` empty).
- 2026-09-24: **the daily marketing cap counts Europe/London calendar days**, not UTC days (review
  of PR #65, item 2; `docs/marketing.md`: "a cap of one marketing message per user per day" is a UK
  calendar day, and UTC is an hour off during BST). `startOfLondonDay` (`src/index.ts`) follows the
  same instant-adjustment approach as `services/spend-governor/src/domain/index.ts`'s
  `londonMonthStartOf`, at day granularity instead of month.
- 2026-09-24: **a trigger that recurs inside its own window supersedes the earlier occurrence**
  (review of PR #65, item 4). `selectRecentTriggerOccurrences` keeps only the latest occurrence per
  user, so two `hunt_created` events inside `channel-not-linked`'s window leave only the later one
  as a candidate; the earlier occurrence's still-due steps are never separately evaluated again.
  This matches "no skip is ever persisted" above in spirit (nothing about the earlier occurrence is
  recorded as skipped or lost — a fresh occurrence simply replaces it as the thing being evaluated),
  and is the same trade-off the primary key's `triggered_at` (above) already accepts: one open
  occurrence per user per programme at a time.
- 2026-09-24: **email resolution is an open gap, not invented.** No module this card depends on
  (`switches`, `product-events`, `marketing-consent`, `account`) exposes a user's email — the same
  gap `services/marketing-consent/README.md` already records for `canMarket()`. `EmailResolver`
  (`src/send-clients.ts`) is the seam; a user with no resolvable email is skipped (no row written,
  so it is retried once a real resolver exists) rather than guessed at.
- 2026-09-24: **PostHog Workflows and Resend are both injected clients, in-memory only today**
  (this session's brief: no accounts exist yet). This module owns the trigger/wait/exit decision
  itself (`src/domain/decide.ts`) rather than delegating it to PostHog Workflows, because the
  latter cannot be configured or tested without an account; `PostHogWorkflowsClient` is the seam a
  later session wires to report each step's run to PostHog once one exists.
- 2026-09-24: **"the user's real numbers" (module card) are limited to what this module can
  actually read**: counts of the user's own `v_events` rows and the properties already recorded on
  the triggering event. A real deal card with margins (`docs/marketing.md`'s own wording for
  "Activation" and "Abandoned onboarding") needs `alerts`/`valuations`, outside this module's
  declared dependencies; those steps' placeholder copy names what a real card would show without
  inventing one (`src/domain/copy.ts`).
- 2026-09-24: copy is placeholder, kept in the one file `src/domain/copy.ts` (this session's
  brief: "wording shown to users is placeholder copy the owner will replace").
- 2026-09-24: **`run()` sees no trigger events at all while `product-events`'s own switch is
  off** — `product_events.v_events` (the view this module reads) already filters on
  `switches.state('product-events') <> 'off'` (rule 11, enforced in `product-events`'s own access
  migration), so this module's tests turn that switch on too, not only their own. Not a gap this
  module can or should work around: a reader always sees "no data" from an off module (rule 11),
  never a false negative it needs to special-case.

## Open questions

- `docs/questions/lifecycle-messaging.md`, "abandoned checkout, failed payment and affiliate
  onboarding need events that do not exist yet".
- `docs/questions/lifecycle-messaging.md`, "email resolution has no source".
- `docs/questions/lifecycle-messaging.md`, "a real deal card needs alerts/valuations".

## Incidents

None.
