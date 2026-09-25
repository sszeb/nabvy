# trigger

Trigger.dev task definitions, thin wrappers around service functions (`docs/engineering.md`,
"Events and tasks"). The pipeline's event tasks (queues, retries, `defineHandler` wiring) arrive
with 1.2. The owner chose Trigger.dev as the pipeline runtime (`docs/questions.md`); no Trigger.dev
account exists yet, so nothing here runs live — schedules and event triggers are dormant until the
owner's project exists and is deployed to.

An event task parses nothing itself: it calls the consuming module's handler, wrapped with
`defineHandler` from `@nabvy/transport`, passing the attempt number and the publisher and
dead-letter sink, with `retry: eventRetry` from `@nabvy/config`. The wrapper does validation,
stamps, retries and dead-lettering (`packages/transport/README.md`, "Wiring").

A scheduled task is thinner still: no event to validate, so it calls its module's function
directly with `schedules.task({ id, cron, run })`. Two exist so far, both `*/15 * * * *`:

- `spend-governor-recompute.ts` (backlog 1.2m) — `recompute`, keeping `spend_governor.throttle`
  from going stale.
- `account-purge-schedule.ts` (backlog 4.3r) — `purgeDueDeletions`, the 24-hour deletion sweep.

Neither publishes the events its function returns (`budget-alerted`, `account.deleted`): no task
consumes them yet, and the `TriggerClient` publisher adapter (`packages/transport/src/trigger.ts`)
is task 1.2's to build (`docs/questions/schedules.md`). This folder is a pnpm workspace package
(`@nabvy/trigger`, `pnpm-workspace.yaml`) depending on `@trigger.dev/sdk` (MIT) and the modules its
tasks call.
