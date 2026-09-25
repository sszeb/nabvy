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

**Merged modules' event tasks** (handlers exist):

- `listing-ingest-first-seen.ts` — consumers: copy-advert, details-queue, details-selector,
  pickup-location, relist-merge
- `listing-ingest-card-changed.ts` — consumers: copy-advert, listing-lifecycle
- `apify-gateway-run-collected.ts` — consumers: detail-evidence, details-queue, listing-ingest,
  run-coverage
- `detail-evidence-changed.ts` — consumers: copy-advert, parts-rules, pickup-location,
  relist-merge
- `detail-evidence-unresolved.ts` — consumers: listing-lifecycle
- `listing-suppression-changed.ts` — consumers: copy-advert
- `account-deleted.ts` — consumers: copy-advert, lifecycle-messaging, marketing-consent,
  pricing-console, usage-ledger
- `parts-rules-ran.ts` — consumers: parts-ai, parts-record
- `parts-ai-extracted.ts` — consumers: parts-record
- `parts-record-recorded.ts` — consumers: listing-assessment

**Unfilled slots** (no consumer handlers merged yet):

- `city-pages.changed` (producer: city-pages; no consumers merged)
- `copy-advert.clustered` (producer: copy-advert; no consumers merged)
- `details-queue.deferred` (producer: details-queue; no consumers merged)
- `listing-assessment.assessed` (producer: listing-assessment; no consumers merged)
- `listing-feedback.recorded` (producer: listing-feedback; no consumers merged)
- `listing-lifecycle.status-changed` (producer: listing-lifecycle; no consumers merged)
- `pickup-location.resolved` (producer: pickup-location; no consumers merged)
- `pickup-location.changed` (producer: pickup-location; no consumers merged)
- `product-catalogue.updated` (producer: product-catalogue; no consumers merged)
- `relist-merge.merged` (producer: relist-merge; no consumers merged)
- `route-health.route-switched` (producer: route-health; no consumers merged)
- `run-coverage.search-degraded` (producer: run-coverage; no consumers merged)
- `scan-recognition.identified` (producer: scan-recognition; no consumers merged)
- `source-health.alerted` (producer: source-health; no consumers merged)
- `spend-governor.budget-alerted` (producer: spend-governor; no consumers merged)
- `subscriptions.entitlement-changed` (producer: subscriptions; no consumers merged)
- `subscriptions.webhook-failed` (producer: subscriptions; no consumers merged)
- `switches.changed` (producer: switches; no consumers merged)
- `usage-ledger.balance-low` (producer: usage-ledger; no consumers merged)
- `want-manager.changed` (producer: want-manager; no consumers merged)

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
`test/wiring.test.ts` verify that the handler registry can be built. Set those env vars to enable
the local runner: see `docs/secrets.md` for configuration.

No Trigger.dev account exists yet (`docs/questions.md`, "Trigger.dev setup"), so event tasks
are dormant when deployed. Scheduled tasks remain live until the owner disables them.
