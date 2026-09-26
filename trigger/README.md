# trigger

Trigger.dev task definitions (backlog L2 wiring): thin wrappers around service functions
(`docs/engineering.md`, "Events and tasks"). Event task files are thin: each receives an
EventEnvelope, creates handler instances with database transaction capabilities, runs all
registered handlers, and returns results. The wrapper (`defineHandler` from `@nabvy/transport`)
does validation, stamps, retries and dead-lettering. Scheduled tasks call module functions
directly with `schedules.task({ id, cron, run })`.

## Event tasks

One task per event type. ID format: `event-type-becomes-kebab-case` (e.g. `listing-ingest-first-seen`).
Payload is `EventEnvelope` from Trigger.dev's batchTrigger. Retry policy is `eventRetry` from
`@nabvy/config`.

**Event type wiring** (handler stubs exist; task files created on demand):

Stub handler factories are defined in `event-tasks-wiring.ts` for these 10 event types.
Individual task files (`event-type.ts`) will be created as needed. Each task receives an
EventEnvelope and calls `runAllHandlers()` with the registered handlers for its event type.

- `listing-ingest.first-seen` — handlers: copy-advert, details-queue, details-selector,
  pickup-location, relist-merge
- `listing-ingest.card-changed` — handlers: copy-advert, listing-lifecycle
- `apify-gateway.run-collected` — handlers: detail-evidence, details-queue, listing-ingest,
  run-coverage
- `detail-evidence.changed` — handlers: copy-advert, parts-rules, pickup-location,
  relist-merge
- `detail-evidence.unresolved` — handlers: listing-lifecycle
- `listing-suppression.changed` — handlers: copy-advert
- `account.deleted` — handlers: copy-advert, lifecycle-messaging, marketing-consent,
  pricing-console, usage-ledger
- `parts-rules.ran` — handlers: parts-ai, parts-record
- `parts-ai.extracted` — handlers: parts-record
- `parts-record.recorded` — handlers: listing-assessment

**Unfilled slots** (events from not-yet-merged modules with no consumer handlers yet):

- `city-pages.changed` (from city-pages)
- `copy-advert.clustered` (from copy-advert)
- `details-queue.deferred` (from details-queue)
- `listing-assessment.assessed` (from listing-assessment)
- `listing-feedback.recorded` (from listing-feedback)
- `listing-lifecycle.status-changed` (from listing-lifecycle)
- `pickup-location.resolved` (from pickup-location)
- `pickup-location.changed` (from pickup-location)
- `product-catalogue.updated` (from product-catalogue)
- `relist-merge.merged` (from relist-merge)
- `route-health.route-switched` (from route-health)
- `scan-recognition.identified` (from scan-recognition)
- `source-health.alerted` (from source-health)
- `spend-governor.budget-alerted` (from spend-governor)
- `subscriptions.entitlement-changed` (from subscriptions)
- `subscriptions.webhook-failed` (from subscriptions)
- `switches.changed` (from switches)
- `usage-ledger.balance-low` (from usage-ledger)
- `want-manager.changed` (from want-manager)

## Scheduled tasks

Three exist; none publishes their output events yet (`budget-alerted`, `account.deleted`, etc.):
the consumer tasks are not merged, and the `TriggerClient` publisher adapter
(`packages/transport/src/trigger.ts`) is task 1.2's to build.

- `spend-governor-recompute.ts` (backlog 1.2m) — `recompute` every 15 minutes, keeping
  `spend_governor.throttle` fresh.
- `account-purge-schedule.ts` (backlog 4.3r) — `purgeDueDeletions` every 15 minutes.
- `copy-advert-expire.ts` (backlog 1.2n) — `expireWindow` daily at 03:17 UTC.
- `lifecycle-messaging-run.ts` (backlog 4.6b) — `run` every 5 minutes.

This folder is a pnpm workspace package (`@nabvy/trigger`, `pnpm-workspace.yaml`) depending on
`@trigger.dev/sdk` (MIT) and the modules its tasks call.

## Local testing

Without `TRIGGER_SECRET_KEY` and `TRIGGER_PROJECT_ID` environment variables, `pnpm trigger:dev`
does not start the local runner. The task module loads cleanly, and the fixture tests in
`test/wiring.test.ts` verify the event publisher's idempotency and the structure of exported
handler registries from `event-tasks-wiring.ts`. Set those env vars to enable the local runner:
see `docs/secrets.md` for configuration.

No Trigger.dev account exists yet (`docs/questions.md`, "Trigger.dev setup"), so event tasks
are dormant when deployed. Scheduled tasks remain live until the owner disables them.
