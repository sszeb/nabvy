# trigger

Trigger.dev task definitions (backlog L2 wiring): thin wrappers around service functions
(`docs/engineering.md`, "Events and tasks"). Event task files are thin: each receives an
EventEnvelope, creates handler instances with database transaction capabilities, runs all
registered handlers, and returns results. The wrapper (`defineHandler` from `@nabvy/transport`)
does validation, stamps, retries and dead-lettering. Scheduled tasks call module functions
directly with `schedules.task({ id, cron, run })`.

## Event tasks

**Wiring map** (`event-tasks-wiring.ts`): 10 merged event types with stubbed handler factories
(`() => null as any` pending implementation). Each export (`ACCOUNT_DELETED`, `APIFY_GATEWAY_RUN_COLLECTED`, etc.)
documents the event type and its consumer modules. Task files do not yet exist; when they do, the pattern
is: one task per event type with ID format `event-type-becomes-kebab-case` (e.g. `listing-ingest-first-seen`),
receiving `EventEnvelope` from Trigger.dev's batchTrigger, retry policy `eventRetry` from `@nabvy/config`.

**Merged modules** (10 event types, consumer handlers exist but not yet dispatched):

- `account.deleted` — producers: account; consumers: copy-advert, lifecycle-messaging,
  marketing-consent, pricing-console, usage-ledger
- `apify-gateway.run-collected` — producers: apify-gateway; consumers: detail-evidence,
  details-queue, listing-ingest, run-coverage
- `detail-evidence.changed` — producers: detail-evidence; consumers: copy-advert, parts-rules,
  pickup-location, relist-merge
- `detail-evidence.unresolved` — producers: detail-evidence; consumers: listing-lifecycle
- `listing-ingest.card-changed` — producers: listing-ingest; consumers: copy-advert,
  listing-lifecycle
- `listing-ingest.first-seen` — producers: listing-ingest; consumers: copy-advert, details-queue,
  details-selector, pickup-location, relist-merge
- `listing-suppression.changed` — producers: listing-suppression; consumers: copy-advert
- `parts-ai.extracted` — producers: parts-ai; consumers: parts-record
- `parts-record.recorded` — producers: parts-record; consumers: listing-assessment
- `parts-rules.ran` — producers: parts-rules; consumers: parts-ai, parts-record

**Unfilled slots** (19 event types, no consumer handlers merged yet):

- `city-pages.changed`, `copy-advert.clustered`, `details-queue.deferred`,
  `listing-assessment.assessed`, `listing-feedback.recorded`, `listing-lifecycle.status-changed`,
  `pickup-location.resolved`, `pickup-location.changed`, `product-catalogue.updated`,
  `relist-merge.merged`, `route-health.route-switched`, `scan-recognition.identified`,
  `source-health.alerted`, `spend-governor.budget-alerted`, `subscriptions.entitlement-changed`,
  `subscriptions.webhook-failed`, `switches.changed`, `usage-ledger.balance-low`, `want-manager.changed`

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
does not start the local runner. The task module loads cleanly; `test/wiring.test.ts` runs fixture
tests that verify event idempotency through `createMemoryPublisher`, confirm the 10 merged event
types are documented in the wiring map with expected consumer counts, and check that unfilled slots
are listed. Set those env vars to enable the local runner: see `docs/secrets.md` for configuration.

No Trigger.dev account exists yet (`docs/questions.md`, "Trigger.dev setup"), so event tasks
are dormant when deployed. Scheduled tasks remain live until the owner disables them.
