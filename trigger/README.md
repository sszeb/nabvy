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
directly with `schedules.task({ id, cron, run })`. Two exist so far:

- `spend-governor-recompute.ts` (backlog 1.2m) — `recompute` every 15 minutes, keeping
  `spend_governor.throttle` from going stale.
- `lifecycle-messaging-run.ts` (backlog 4.6b) — `run` every 5 minutes, sending each programme's
  due steps (`services/lifecycle-messaging/README.md`, "Outputs"). A no-op in practice today: no
  PostHog Workflows or Resend account exists yet, so every send goes through the module's in-memory
  clients (`services/lifecycle-messaging/README.md`, "Decisions").

It does not publish the `budget-alerted` events `recompute` returns: no task consumes them yet,
and the `TriggerClient` publisher adapter (`packages/transport/src/trigger.ts`) is task 1.2's to
build (`docs/questions/schedules.md`). This folder is a pnpm workspace package (`@nabvy/trigger`,
`pnpm-workspace.yaml`) depending on `@trigger.dev/sdk` (MIT) and the modules its tasks call.
