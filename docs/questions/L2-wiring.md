# L2 Pipeline Wiring Questions (backlog L2)

## Task, Ambiguity, Conservative Option Taken

### 1. Event Task Triggering Pattern - Fan-out dispatch model

**Task:** Wire event handlers for merged modules so events flow from publishers through all consumers.

**Ambiguity:** When an event type has multiple consumers (e.g., `listing-ingest.first-seen` has 5 consumers), should:
- (A) One trigger task dispatches to all handlers serially, or
- (B) Trigger.dev publishes to one task per consumer (N separate tasks), or
- (C) One task per event type dispatches in parallel batches?

**Conservative option taken:** (A) One task per event type, runs all handlers serially in a loop. This is simplest to test and debug. Parallel dispatch can be added later. Pattern documented in `trigger/event-tasks-wiring.ts::runAllHandlers()`.

### 2. Handler Factory Pattern - Dependency Injection

**Task:** Each module's handler is a factory that takes `{ transaction }` and returns an `EventHandler`. Task files must instantiate these.

**Ambiguity:** How should database transactions be passed to handler factories? Options:
- (A) Each task creates `withPipeline` once and passes its transaction capability to all handlers, or
- (B) Each handler gets its own `withPipeline` transaction, or
- (C) Handlers share a single database connection across all consumers?

**Conservative option taken:** (A) Each event task wraps handler instantiation in one `withPipeline`, so all consumers of that event share the same database transaction. This ensures atomicity (all succeed together or all fail together). Implementation is in task files (example in `trigger/event-tasks-wiring.ts`, to be applied to actual task files).

### 3. Error Aggregation - Per-consumer failure handling

**Task:** When one handler fails, should others still run?

**Ambiguity:** Options:
- (A) Run all handlers regardless of failure, return list of outcomes, or
- (B) Fail fast on first error, don't run remaining handlers, or
- (C) Run all, but dead-letter the whole event if any handler failed?

**Conservative option taken:** (A) Run all handlers regardless of failure. Each handler's own exception handling (retry, dead-letter) is independent. Task returns aggregated list of outcomes. This allows observability: which consumers succeeded and which failed.

### 4. Event Task Naming - Kebab-case task IDs

**Task:** Task IDs must match Trigger.dev event routing (`listing.new` → `listing-new`).

**Ambiguity:** Event type `detail-evidence.changed` becomes task ID `detail-evidence-changed` (dots to hyphens). Is this always correct?

**Conservative option taken:** Yes. The `taskIdFor()` function in `@nabvy/contracts` does this: replace `.` with `-` and lowercase. Applied consistently in task file names.

### 5. Publisher Setup - Circular dependency

**Task:** Tasks need a `Publisher` instance to pass to handlers. But who creates it?

**Ambiguity:** Options:
- (A) Each task creates `createTriggerPublisher()` with a Trigger.dev client, or
- (B) A singleton publisher is created once at startup, or
- (C) Publisher is injected as an environment dependency?

**Conservative option taken:** (C) Placeholder in `event-tasks-wiring.ts`. Actual implementation deferred to when Trigger.dev client setup is complete. Task files will receive publisher from context or instantiate it locally. Documented in `trigger/README.md` under "Local testing".

### 6. Scheduled Tasks Publishing - Deferred

**Task:** Three scheduled tasks exist (spend-governor-recompute, account-purge-schedule, copy-advert-expire, lifecycle-messaging-run). They return events but don't publish them.

**Ambiguity:** These should publish their output events once tasks are wired, but there are no consumers merged yet.

**Conservative option taken:** Leave as-is. Scheduled tasks do not publish their events yet. When consumer tasks are built (e.g., for `spend-governor.budget-alerted`), add the publisher and update task files. Documented in `trigger/README.md`.

### 7. Handler Registry Format - What gets exported?

**Task:** Modules export handler factories like `firstSeenHandler` from `src/handlers/index.ts`. Registry needs to reference these.

**Ambiguity:** How should the registry refer to handlers? Options:
- (A) Direct imports of factories (current in `event-tasks-wiring.ts`), or
- (B) String mapping (module name → handler name), or
- (C) A registry object built per-module that lists its handlers?

**Conservative option taken:** (A) Direct imports. Each event in `event-tasks-wiring.ts` lists handlers by module and import name. Typed by `EventHandlers` interface. If a module is removed or a handler is renamed, TypeScript will catch it at build time.

### 8. Task Idempotency - Event key lifecycle

**Task:** Handlers are idempotent by event key (unique on `source + sourceListingId + contentHash` or module-specific key). Replays of the same key must write nothing.

**Ambiguity:** The event key is set by the producer (the module that emits the event), not the trigger task. How does the task ensure idempotency?

**Conservative option taken:** The task does not manage idempotency. The handler itself (each consumer) is idempotent by design: it upserts on the key, so a replay writes nothing. Idempotency lives in the handler, not the transport layer, per `packages/transport/README.md`, "Idempotency lives in the handler".

## Unfilled Slots (No Consumers Merged Yet)

20 events are produced by modules whose consumers are not yet merged. They need trigger task slots:

- city-pages.changed
- copy-advert.clustered
- details-queue.deferred
- listing-assessment.assessed
- listing-feedback.recorded
- listing-lifecycle.status-changed
- pickup-location.resolved
- pickup-location.changed
- product-catalogue.updated
- relist-merge.merged
- route-health.route-switched
- run-coverage.search-degraded
- scan-recognition.identified
- source-health.alerted
- spend-governor.budget-alerted
- subscriptions.entitlement-changed
- subscriptions.webhook-failed
- switches.changed
- usage-ledger.balance-low
- want-manager.changed

These are marked in `trigger/event-tasks-wiring.ts` and listed in `trigger/README.md`. The next wiring pass fills them when those modules merge.

## No Migrations From This Task

L2 is pipeline wiring only. No database changes. The event envelope format, handler protocol, and dispatch mechanism are already in place from 0.9 and 0.9a.
