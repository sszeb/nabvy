# Questions from the schedules session (1.2m, 4.3r)

- **2026-09-24, 1.2m schedules: no Trigger.dev account or workspace package existed yet.**
  `trigger/README.md` says "no Trigger.dev account exists yet, so nothing here runs live", and
  `trigger/` was not a pnpm workspace member; `pnpm-workspace.yaml` had no entry for it. `docs/backlog.md`'s
  guidance was "pg_cron only if the repository already uses it for another module (grep
  `cron.schedule` under `packages/db/migrations`); otherwise a thin Trigger.dev scheduled task" —
  no `cron.schedule` use exists anywhere in `packages/db/migrations`. Option taken: added `trigger`
  to `pnpm-workspace.yaml`, a minimal `trigger/package.json` (`@nabvy/trigger`) depending on
  `@trigger.dev/sdk` (MIT, 4.6.4) plus the service package its task calls, and the scheduled task
  file as `schedules.task({ id, cron: '*/15 * * * *', run })`. Conservative because it is the
  smallest change that satisfies the explicit "otherwise a Trigger.dev task" instruction without
  inventing the queue/retry/publisher machinery `docs/engineering.md` describes for event tasks —
  that stays task 1.2's job (`trigger/README.md`, `packages/transport/README.md`). The task does
  not run live until the owner's Trigger.dev project exists and is deployed to (task 1.2).
- **2026-09-24, 1.2m schedules: the task does not publish the events `recompute` returns.**
  `recompute`'s `budget-alerted` events are documented as "for the caller to publish", but no
  consumer task exists yet, and `packages/transport/src/trigger.ts` explicitly earmarks the
  `TriggerClient` adapter (`tasks.batchTrigger` plus `idempotencyKeys.create`) as "task 1.2 wires
  it". Option taken: the scheduled task calls `recompute` and returns its report (`written`/`alerts`
  counts) for the Trigger.dev dashboard, but does not attempt to publish the returned events.
  Conservative because Trigger.dev refuses a trigger to a task id that does not exist, so building
  the publisher now, before any consumer task or the real `TriggerClient` adapter exists, would
  either be dead code or fail at runtime; it also avoids duplicating the adapter task 1.2 is
  already scoped to build. Follow-up: once a consumer for `spend-governor.budget-alerted` exists,
  wire `createTriggerPublisher` into this task file (or a thin wrapper) and publish after
  `withPipeline` commits. The same gap is expected for `account.deleted` when 4.3r's scheduled
  purge task is built.
